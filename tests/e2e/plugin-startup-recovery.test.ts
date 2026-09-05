import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import { describe, expect, it } from 'vitest';
import { closeElectronTestApplication } from './electron-cleanup.js';
import { resolveE2eExecutablePath } from './executable-path.js';
import { runtimeStartupTimeoutMs } from '../../src/main/runtime/runtime-startup-policy.js';

const recoveryTimeoutMs = runtimeStartupTimeoutMs() * 3 + 30000;
const expectedVersion = (JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

describe('desktop startup recovery', () => {
  it.each(['missing-bundle', 'import-failure'] as const)('recovers %s without changing the original user data', async (fault) => {
    const userData = await mkdtemp(join(tmpdir(), 'dsh-recovery-e2e-'));
    const home = join(userData, 'runtime');
    const profile = join(home, 'profiles', 'web');
    await mkdir(profile, { recursive: true });
    await writeFile(join(home, 'data-sentinel'), 'keep');
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-crashing-fixture': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-crashing-fixture'], patchReload: 'startup' } },
    }));
    if (fault === 'import-failure') {
      const plugin = join(profile, 'node_modules', 'dsh-crashing-fixture');
      await mkdir(plugin, { recursive: true });
      await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-crashing-fixture', version: '1.0.0', type: 'module', main: 'index.js',
        repository: 'https://github.com/example/dsh-crashing-fixture', dsh: { bundle: { patch: 'cordis.patch.yml' } } }));
      await writeFile(join(plugin, 'cordis.patch.yml'), '- insert:\n    - id: crashing-fixture\n      name: dsh-crashing-fixture\n');
      await writeFile(join(plugin, 'index.js'), 'throw new Error("FIXTURE_IMPORT_FAILED");');
    }
    const application = await electron.launch({ executablePath: resolveE2eExecutablePath(), args: [...(process.env.DSH_E2E_APP_PATH ? [process.env.DSH_E2E_APP_PATH] : []), `--user-data-dir=${userData}`], env: { ...process.env, DSH_DESKTOP_E2E: '1' } });
    try {
      await application.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      });
      const stateFile = join(home, 'plugin-management', 'startup-recovery.json');
      await expect.poll(async () => {
        try { return (JSON.parse(await readFile(stateFile, 'utf8')) as { phase: string }).phase; }
        catch { return 'not-written'; }
      }, { timeout: recoveryTimeoutMs }).toBe('healthy');
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      if (fault === 'missing-bundle') expect(state.mode).toBe('safe');
      else expect(state.isolated).toEqual([{ packageName: 'dsh-crashing-fixture', version: '1.0.0', entryIds: ['crashing-fixture'] }]);
      expect(await readFile(join(home, 'data-sentinel'), 'utf8')).toBe('keep');
      expect(await application.evaluate(({ app }) => app.getVersion())).toBe(expectedVersion);
      expect(await application.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('http://127.0.0.1:')))).toBe(true);
    } finally {
      // A failed startup must not leave the isolated test app running even if
      // the debugger's app.quit() evaluation cannot settle.
      const shutdownDeadline = setTimeout(() => application.process().kill('SIGTERM'), 15000);
      try { await closeElectronTestApplication(application); }
      finally { clearTimeout(shutdownDeadline); }
    }
  }, recoveryTimeoutMs + 60000);
});
