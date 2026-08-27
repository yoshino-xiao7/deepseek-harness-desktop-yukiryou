import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeElectronTestApplication } from './electron-cleanup.js';
import { resolveE2eExecutablePath } from './executable-path.js';

describe('desktop window state persistence', () => {
  let application: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await closeElectronTestApplication(application);
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 30_000);

  it('restores the last normal window bounds after a full application restart', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-window-state-e2e-'));
    application = await launch(userData);
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.unmaximize();
    });
    await expect.poll(() => application!.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized(),
    )).toBe(false);
    const expected = await application.evaluate(({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().workArea;
      const bounds = {
        x: area.x + 80,
        y: area.y + 60,
        width: Math.max(820, Math.min(1060, area.width - 160)),
        height: Math.max(600, Math.min(720, area.height - 120)),
      };
      const window = BrowserWindow.getAllWindows()[0];
      window?.setBounds(bounds);
      return bounds;
    });
    await expect.poll(() => readBounds(application!)).toEqual(expected);
    await expect.poll(async () => JSON.parse(
      await readFile(join(userData!, 'window-state.json'), 'utf8'),
    )).toMatchObject({ bounds: expected, maximized: false });
    await quitGracefully(application);
    application = undefined;
    await expect.poll(async () => JSON.parse(
      await readFile(join(userData!, 'window-state.json'), 'utf8'),
    )).toMatchObject({ bounds: expected, maximized: false });

    application = await launch(userData);
    await expect.poll(() => readBounds(application!)).toEqual(expected);
  }, 75_000);
});

async function launch(userData: string): Promise<ElectronApplication> {
  const application = await electron.launch({
    executablePath: resolveE2eExecutablePath(),
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, DSH_DESKTOP_E2E: '1', DSH_DESKTOP_CARRIER_MODE: 'legacy' },
  });
  await application.firstWindow();
  await expect.poll(
    () => application.windows().some((page) => page.url().startsWith('file:')),
    { timeout: 20_000 },
  ).toBe(true);
  return application;
}

async function readBounds(application: ElectronApplication) {
  return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
}

async function quitGracefully(application: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((resolve) => application.once('close', resolve));
  await application.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await closed;
}
