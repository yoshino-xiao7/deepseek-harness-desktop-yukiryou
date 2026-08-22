import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import type { ElectronApplication } from 'playwright';

export async function closeElectronTestApplication(
  application: ElectronApplication | undefined,
): Promise<void> {
  if (application === undefined) return;
  if (process.platform !== 'win32') {
    await application.close();
    return;
  }

  const applicationProcess = application.process();
  if (
    applicationProcess.pid === undefined ||
    applicationProcess.exitCode !== null ||
    applicationProcess.signalCode !== null
  ) {
    return;
  }
  const result = spawnSync(
    'taskkill.exe',
    ['/pid', String(applicationProcess.pid), '/t', '/f'],
    { encoding: 'utf8', shell: false },
  );
  if (result.error !== undefined) throw result.error;
  // taskkill returns 128 when Playwright won the shutdown race first.
  if (result.status !== 0 && result.status !== 128) {
    throw new Error(
      `taskkill failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      applicationProcess.exitCode !== null ||
      applicationProcess.signalCode !== null
    ) {
      return;
    }
    await setTimeout(100);
  }
  throw new Error('Electron process tree did not exit after taskkill');
}
