import { spawnSync } from 'node:child_process';
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
  if (applicationProcess.pid === undefined || applicationProcess.exitCode !== null) {
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
}
