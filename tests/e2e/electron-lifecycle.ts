import type { ChildProcess } from 'node:child_process';
import type { ElectronApplication } from 'playwright';

export async function closeE2eElectronApplication(
  electronApp: ElectronApplication | undefined,
  timeoutMs = 10_000,
): Promise<void> {
  if (electronApp === undefined) return;
  const child = electronApp.process();
  if (hasExited(child)) return;
  void electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
  if (await waitForExit(child, timeoutMs)) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, 3_000)) return;
  child.kill('SIGKILL');
  await waitForExit(child, 2_000);
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}
