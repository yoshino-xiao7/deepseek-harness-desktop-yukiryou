import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { pathToFileURL } from 'node:url';
import { resolveBundledRuntimePlatform } from './runtime-platform.js';

type RecoveryState = {
  schemaVersion: 1;
  appVersion: string;
  attemptId: string;
  mode: 'normal' | 'safe';
  phase: 'prepared' | 'launching' | 'healthy' | 'failed';
  attempts: number;
  failureCode?: string;
  isolated?: readonly IsolatedPlugin[];
};

export type PluginStartupRecovery = Awaited<ReturnType<typeof createPluginStartupRecovery>>;

/** Host-owned record, deliberately separate from plugin enable preferences. */
export async function createPluginStartupRecovery(runtimeHome: string, appVersion: string) {
  const root = join(runtimeHome, 'plugin-management');
  const file = join(root, 'startup-recovery.json');
  await mkdir(root, { recursive: true, mode: 0o700 });
  let state: RecoveryState = { schemaVersion: 1, appVersion, attemptId: randomUUID(), mode: 'normal', phase: 'prepared', attempts: 0 };
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.length > 8192) throw new Error('Oversized startup recovery state');
    const value = JSON.parse(raw) as RecoveryState;
    if (value.schemaVersion !== 1 || !['normal', 'safe'].includes(value.mode) ||
      !['prepared', 'launching', 'healthy', 'failed'].includes(value.phase) ||
      !Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 2 ||
      typeof value.appVersion !== 'string' || typeof value.attemptId !== 'string') {
      throw new Error('Invalid startup recovery state');
    }
    state = { schemaVersion: 1, appVersion, attemptId: value.attemptId,
      mode: value.mode, phase: value.phase, attempts: value.attempts,
      isolated: validIsolated(value.isolated ?? []) };
    // An interrupted safe launch never gets an automatic retry on relaunch.
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Preserve malformed state and fail into safe mode, never reset to an
      // unrestricted startup which could repeat the same crashing plugin.
      if (error instanceof SyntaxError || (error instanceof Error && /^(Invalid|Oversized)/.test(error.message))) {
        await rename(file, `${file}.corrupt-${randomUUID()}`);
        state = { ...state, mode: 'safe', attempts: 1 };
      } else throw error;
    }
  }
  const save = async (next: RecoveryState) => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await rename(temporary, file);
    state = next;
  };
  return {
    snapshot: (): Readonly<RecoveryState> => structuredClone(state),
    async isolationPatches(): Promise<readonly string[]> {
      if (!state.isolated?.length) return [];
      const overlay = join(root, 'startup-isolation.patch.yml');
      const temporary = `${overlay}.${randomUUID()}.tmp`;
      await writeFile(temporary, stringify(state.isolated.flatMap(item => item.entryIds.map(id => ({ id, disabled: true })))), { mode: 0o600 });
      await rename(temporary, overlay);
      return [overlay];
    },
    async isolate(plugins: readonly IsolatedPlugin[]) {
      if (state.mode === 'safe' || state.attempts !== 0 || plugins.length === 0) return false;
      const combined = new Map([...(state.isolated ?? []), ...validIsolated(plugins)].map(item => [item.packageName, item]));
      await save({ ...state, isolated: validIsolated([...combined.values()]), attempts: 1, phase: 'prepared' });
      return true;
    },
    async tryPlugin(packageName: string) {
      await save({ ...state, isolated: (state.isolated ?? []).filter(item => item.packageName !== packageName), phase: 'prepared', attempts: 0 });
    },
    async reserveTrialRecovery() {
      if (state.attempts !== 0) return false;
      await save({ ...state, attempts: 1 });
      return true;
    },
    async begin() { await save({ ...state, attemptId: randomUUID(), phase: 'launching' }); },
    async healthy() { await save({ ...state, phase: 'healthy', attempts: state.mode === 'normal' && !state.isolated?.length ? 0 : state.attempts }); },
    async failed() { await save({ ...state, phase: 'failed' }); },
    async enterSafeMode(failureCode: string, manual = false) {
      if (!manual && (state.mode === 'safe' || state.attempts >= 2)) return false;
      await save({ ...state, mode: 'safe', phase: 'prepared', attempts: Math.min(2, state.attempts + 1),
        failureCode: /^[a-z-]{1,64}$/.test(failureCode) ? failureCode : 'unknown' });
      return true;
    },
    async tryNormal() { await save({ ...state, mode: 'normal', phase: 'prepared', attempts: 0, isolated: [] }); },
  };
}

/**
 * Boot only shipped bundles through the public app-boot API. In particular, do
 * not call loadProfile/loadLayeredEnv or parse a user's patch in recovery: even
 * evaluating !!js or resolving a malformed bundle may be the startup failure.
 * DSH_HOME stays unchanged, so session and account storage keep their identity.
 */
export async function createSafeRuntimeCommand(runtimeHome: string, runtimeRoot: string) {
  const root = join(runtimeHome, 'plugin-management', 'safe-start');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const moduleRoot = join(runtimeRoot, 'dsh', 'node_modules');
  const link = join(root, 'node_modules');
  try { await symlink(moduleRoot, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!(await lstat(link)).isSymbolicLink()) throw new Error('Safe startup module path is not a link');
    if (await readlink(link) !== moduleRoot) {
      // Portable upgrades can move the bundled Runtime. Replace only our link,
      // never the previous target directory or any user plugin files.
      await unlink(link);
      await symlink(moduleRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  const script = join(root, 'launch.mjs');
  const config = join(root, 'cordis.yml');
  await writeFile(config, '[]\n', { mode: 0o600 });
  const moduleUrl = (name: string) => pathToFileURL(join(moduleRoot, '@deepseek-ai', name, 'lib', 'index.js')).href;
  const source = `
import { boot, loadOverlayPatches, installFailLoud } from ${JSON.stringify(moduleUrl('dsh-app-boot'))};
import { provideCmdline } from ${JSON.stringify(moduleUrl('dsh-cmdline'))};
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from ${JSON.stringify(moduleUrl('dsh-launch-environment'))};
let ctx;
let stopping = false;
const shutdown = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(code), 5000);
  try { await ctx?.fiber.dispose(); } finally { clearTimeout(timer); process.exit(code); }
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown(130));
installFailLoud('dsh-safe', process, () => ctx?.fiber.dispose());
const readyCallbacks = [];
let ready = false;
const patches = ${JSON.stringify([
    join(moduleRoot, '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'),
    join(moduleRoot, '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'),
    join(runtimeRoot, 'desktop-extensions.patch.yml'),
  ])}.flatMap(file => loadOverlayPatches('dsh-safe', file));
ctx = await boot('dsh-safe', ${JSON.stringify(config)}, patches, host => {
  ctx = host;
  host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]));
  provideCmdline(host, { args: ['--no-open', ...process.argv.slice(2)], exit: code => void shutdown(code),
    ready: { onReady(callback) { if (ready) callback(); else readyCallbacks.push(callback); return () => { const i = readyCallbacks.indexOf(callback); if (i >= 0) readyCallbacks.splice(i, 1); }; } } });
}, ${JSON.stringify(pathToFileURL(join(runtimeRoot, 'dsh', 'package.json')).href)});
ready = true;
for (const callback of readyCallbacks.splice(0)) callback();
`;
  await writeFile(script, source, { mode: 0o600 });
  return { command: join(runtimeRoot, resolveBundledRuntimePlatform(process.platform, process.arch).nodeExecutable), args: [script] };
}

export interface IsolatedPlugin {
  readonly packageName: string;
  readonly version: string;
  readonly entryIds: readonly string[];
}

/** Only a loader-labelled entry AND an inventory-owned module identify a suspect. */
export function identifyStartupPluginFailures(lines: readonly string[], candidates: readonly IsolatedPlugin[]): readonly IsolatedPlugin[] {
  const matches = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/failed to (?:import|apply) loader entry ([a-zA-Z0-9._:-]+) \(([^)\s]+)\):/g)) {
      for (const candidate of candidates) {
        if (candidate.entryIds.includes(match[1]!) &&
          (match[2] === candidate.packageName || match[2]!.startsWith(`${candidate.packageName}/`))) matches.add(candidate.packageName);
      }
    }
  }
  return candidates.filter(candidate => matches.has(candidate.packageName));
}

function validIsolated(value: unknown): readonly IsolatedPlugin[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid plugin isolation state');
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid isolated plugin');
    const entry = item as IsolatedPlugin;
    if (typeof entry.packageName !== 'string' || !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/.test(entry.packageName) ||
      typeof entry.version !== 'string' || entry.version.length > 100 ||
      !Array.isArray(entry.entryIds) || entry.entryIds.length === 0 || entry.entryIds.length > 200 ||
      !entry.entryIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id))) throw new Error('Invalid isolated plugin');
    return { packageName: entry.packageName, version: entry.version, entryIds: [...entry.entryIds] };
  });
}
