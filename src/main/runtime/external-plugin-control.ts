import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { promisify } from 'node:util';

import { parse, stringify } from 'yaml';

import { resolveBundledRuntimePlatform } from './runtime-platform.js';

const execFile = promisify(execFileCallback);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const ENTRY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u;

export interface ExternalPluginInventoryEntry {
  readonly packageName: string;
  readonly version: string;
  readonly entryIds: readonly string[];
  readonly enabled: boolean;
  readonly allowedActions: readonly ('enable' | 'disable' | 'uninstall')[];
}

export interface ExternalPluginIdentity {
  readonly packageName: string;
  readonly version: string;
  readonly entryId: string;
}

export interface ExternalPluginControl {
  readonly overlayPath: string;
  inventory(): Promise<readonly ExternalPluginInventoryEntry[]>;
  patchPaths(): Promise<readonly string[]>;
  setEnabled(identity: ExternalPluginIdentity & { readonly enabled: boolean }): Promise<{ status: 'prepared' }>;
  remove(identity: ExternalPluginIdentity): Promise<{ status: 'prepared' }>;
}

interface ExternalPluginControlOptions {
  readonly runtimeHome: string;
  readonly runtimeRoot: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly execute?: (
    command: string,
    args: readonly string[],
    options: { readonly runtimeHome: string; readonly env: NodeJS.ProcessEnv },
  ) => Promise<void>;
}

interface ProfileManifest {
  readonly dependencies?: Record<string, unknown>;
  readonly dsh?: { readonly profile?: { readonly bundles?: unknown } };
}

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dsh?: { readonly bundle?: { readonly patch?: unknown } };
}

export function createExternalPluginControl(
  options: ExternalPluginControlOptions,
): ExternalPluginControl {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const joinTarget = platform === 'win32' ? win32.join : posix.join;
  const dirnameTarget = platform === 'win32' ? win32.dirname : posix.dirname;
  const profileRoot = join(options.runtimeHome, 'profiles', 'web');
  const overlayPath = join(
    options.runtimeHome,
    'desktop-plugin-controls',
    'external-disabled.patch.yml',
  );

  const inventory = async (): Promise<readonly ExternalPluginInventoryEntry[]> => {
    const profile = await readJson<ProfileManifest>(join(profileRoot, 'package.json'));
    const bundles = Array.isArray(profile.dsh?.profile?.bundles)
      ? profile.dsh.profile.bundles.filter(validPackageName)
      : [];
    const disabled = new Set(await readDisabledEntryIds(overlayPath));
    const entries: ExternalPluginInventoryEntry[] = [];
    for (const packageName of bundles) {
      if (packageName.startsWith('@deepseek-ai/')) continue;
      if (!validPackageName(packageName) || profile.dependencies?.[packageName] === undefined) continue;
      const manifestPath = join(profileRoot, 'node_modules', ...packageName.split('/'), 'package.json');
      let manifest: PackageManifest;
      try {
        manifest = await readJson<PackageManifest>(manifestPath);
      } catch {
        continue;
      }
      if (manifest.name !== packageName || typeof manifest.version !== 'string' ||
        manifest.version.length === 0 || manifest.version.length > 100) continue;
      const patch = manifest.dsh?.bundle?.patch;
      if (typeof patch !== 'string' || patch.length === 0) continue;
      let entryIds: readonly string[];
      try {
        const packageRoot = await realpath(dirname(manifestPath));
        const patchPath = await realpath(resolve(packageRoot, patch));
        const relativePatch = relative(packageRoot, patchPath);
        if (relativePatch === '..' || relativePatch.startsWith(`..${sep}`) ||
          isAbsolute(relativePatch)) continue;
        entryIds = collectOwnedEntryIds(parse(await readFile(patchPath, 'utf8')), packageName);
      } catch {
        continue;
      }
      if (entryIds.length === 0) continue;
      const enabled = entryIds.every((entryId) => !disabled.has(entryId));
      entries.push({
        packageName,
        version: manifest.version,
        entryIds,
        enabled,
        allowedActions: enabled ? ['disable', 'uninstall'] : ['enable', 'uninstall'],
      });
    }
    return entries.sort((left, right) => left.packageName.localeCompare(right.packageName));
  };

  const resolveIdentity = async (identity: ExternalPluginIdentity) => {
    if (!validPackageName(identity.packageName) || !validEntryId(identity.entryId)) {
      throw new Error('external-plugin:invalid-identity');
    }
    const candidate = (await inventory()).find(
      (entry) => entry.packageName === identity.packageName &&
        entry.version === identity.version && entry.entryIds.includes(identity.entryId),
    );
    if (candidate === undefined) throw new Error('external-plugin:identity-mismatch');
    return candidate;
  };

  return {
    overlayPath,
    inventory,
    async patchPaths() {
      try {
        await access(overlayPath);
        return [overlayPath];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    async setEnabled(identity) {
      const candidate = await resolveIdentity(identity);
      const disabled = new Set(await readDisabledEntryIds(overlayPath));
      for (const entryId of candidate.entryIds) {
        if (identity.enabled) disabled.delete(entryId);
        else disabled.add(entryId);
      }
      await writeDisabledOverlay(overlayPath, [...disabled].sort());
      return { status: 'prepared' };
    },
    async remove(identity) {
      const candidate = await resolveIdentity(identity);
      const layout = resolveBundledRuntimePlatform(platform, architecture);
      const command = joinTarget(options.runtimeRoot, layout.nodeExecutable);
      const args = [
        joinTarget(
          options.runtimeRoot,
          'dsh',
          'node_modules',
          '@deepseek-ai',
          'dsh',
          'lib',
          'bin.js',
        ),
        'plugin', '--profile', 'web', 'remove', candidate.packageName,
      ];
      const environment = {
        ...process.env,
        DSH_HOME: options.runtimeHome,
        PATH: [
          joinTarget(options.runtimeRoot, 'dsh', 'node_modules', '.bin'),
          joinTarget(options.runtimeRoot, dirnameTarget(layout.nodeExecutable)),
          process.env.PATH ?? '',
        ].join(platform === 'win32' ? ';' : ':'),
      };
      if (options.execute !== undefined) {
        await options.execute(command, args, { runtimeHome: options.runtimeHome, env: environment });
      } else {
        await execFile(command, args, { env: environment, timeout: 5 * 60_000 });
      }
      const disabled = new Set(await readDisabledEntryIds(overlayPath));
      for (const entryId of candidate.entryIds) disabled.delete(entryId);
      await writeDisabledOverlay(overlayPath, [...disabled].sort());
      return { status: 'prepared' };
    },
  };
}

async function readDisabledEntryIds(path: string): Promise<readonly string[]> {
  try {
    const value = parse(await readFile(path, 'utf8'));
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => isRecord(item) && item.disabled === true && validEntryId(item.id)
      ? [item.id]
      : []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeDisabledOverlay(path: string, entryIds: readonly string[]): Promise<void> {
  if (entryIds.length === 0) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    stringify(entryIds.map((id) => ({ id, disabled: true }))),
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

function collectOwnedEntryIds(value: unknown, packageName: string): readonly string[] {
  const entries = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    if (validEntryId(item.id) && item.name === packageName) entries.add(item.id);
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return [...entries].sort();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function validPackageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 214 && PACKAGE_NAME.test(value);
}

function validEntryId(value: unknown): value is string {
  return typeof value === 'string' && ENTRY_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
