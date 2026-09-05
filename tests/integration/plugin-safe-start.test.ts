import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSafeRuntimeCommand, createPluginStartupRecovery, identifyStartupPluginFailures } from '../../src/main/runtime/plugin-startup-recovery.js';
import { createHarnessRuntimeCommand } from '../../src/main/runtime/runtime-command.js';
import { ensureBundledRuntimeExtensions } from '../../src/main/runtime/runtime-extension.js';
import { createRuntimeSupervisor } from '../../src/main/runtime/runtime-supervisor.js';
import { runtimeStartupTimeoutMs } from '../../src/main/runtime/runtime-startup-policy.js';

const startupTimeoutMs = runtimeStartupTimeoutMs();

describe('bundled recovery boot', () => {
  it('isolates a loader-identified crashing plugin before its next import', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-isolate-'));
    const profile = join(home, 'profiles', 'web');
    const plugin = join(profile, 'node_modules', 'dsh-crashing-fixture');
    await mkdir(plugin, { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-crashing-fixture': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-crashing-fixture'], patchReload: 'startup' } },
    }));
    await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-crashing-fixture', version: '1.0.0', type: 'module', main: 'index.js', dsh: { bundle: { patch: 'cordis.patch.yml' } } }));
    await writeFile(join(plugin, 'index.js'), 'throw new Error("FIXTURE_IMPORT_FAILED");');
    await writeFile(join(plugin, 'cordis.patch.yml'), '- insert:\n    - id: crashing-fixture\n      name: dsh-crashing-fixture\n');
    const root = resolve('resources/runtime');
    await ensureBundledRuntimeExtensions(home, root);
    const errors: string[] = [];
    const runtime = createRuntimeSupervisor({ ...createHarnessRuntimeCommand(root), runtimeHome: home, workspaceRoot: home,
      version: '0.1.2-rc.1', startupTimeoutMs, shutdownTimeoutMs: 5000,
      createCompanionToken: () => 'b'.repeat(64), onOutput: (stream, chunk) => { if (stream === 'stderr') errors.push(chunk); },
    });
    try {
      await expect(runtime.start()).rejects.toThrow();
      const candidate = { packageName: 'dsh-crashing-fixture', version: '1.0.0', entryIds: ['crashing-fixture'] };
      const failures = identifyStartupPluginFailures(errors.join('').split('\n'), [candidate]);
      expect(failures, errors.join('').slice(-2500)).toEqual([candidate]);
      const recovery = await createPluginStartupRecovery(home, '1.0.9');
      expect(await recovery.isolate(failures)).toBe(true);
      const command = createHarnessRuntimeCommand(root, 'legacy', await recovery.isolationPatches());
      await runtime.stop('restart');
      runtime.configureLaunch(command.command, command.args);
      errors.length = 0;
      await runtime.start();
      expect(errors.join('')).not.toContain('FIXTURE_IMPORT_FAILED');
      expect(await readFile(join(plugin, 'index.js'), 'utf8')).toContain('FIXTURE_IMPORT_FAILED');
    } finally { await runtime.stop('quit'); }
  }, startupTimeoutMs * 2 + 15000);

  it('opens the same data home without evaluating broken user bundles or home patches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-safe-'));
    await mkdir(join(home, 'profiles', 'web'), { recursive: true });
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['missing-crashing-plugin'] } } }));
    const patch = '- insert: !!js (() => { throw new Error("USER_PATCH_EXECUTED"); })()\n';
    await writeFile(join(home, 'cordis.patch.yml'), patch);
    await writeFile(join(home, 'sessions-sentinel'), 'unchanged');
    const command = await createSafeRuntimeCommand(home, resolve('resources/runtime'));
    const errors: string[] = [];
    const runtime = createRuntimeSupervisor({ ...command, runtimeHome: home, workspaceRoot: home,
      version: '0.1.2-rc.1', startupTimeoutMs, shutdownTimeoutMs: 5000,
      createCompanionToken: () => 'a'.repeat(64),
      onOutput: (stream, chunk) => { if (stream === 'stderr') errors.push(chunk); },
    });
    try {
      const ready = await runtime.start();
      expect(ready.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch);
      expect(await readFile(join(home, 'sessions-sentinel'), 'utf8')).toBe('unchanged');
    } catch (error) {
      throw new Error(`${String(error)}\n${errors.join('').slice(-4000)}`, { cause: error });
    } finally { await runtime.stop('quit'); }
  }, startupTimeoutMs + 15000);
});
