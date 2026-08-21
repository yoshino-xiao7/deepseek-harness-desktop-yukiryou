import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from './executable-path.js';

describe.skipIf(process.platform !== 'darwin')('Integrated desktop prototype', () => {
  let application: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await application?.close();
    if (userData !== undefined) await rm(userData, { recursive: true, force: true });
  }, 30_000);

  it('keeps the transport prototype isolated from production Workspace UI', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-integrated-carrier-e2e-'));
    application = await electron.launch({
      executablePath: resolveE2eExecutablePath(),
      args: [`--user-data-dir=${userData}`],
      env: {
        ...process.env,
        DSH_DESKTOP_CARRIER_MODE: 'integrated',
        DSH_DESKTOP_INTEGRATED_PROTOTYPE: '1',
        DSH_DESKTOP_E2E: '1',
      },
    });
    await application.firstWindow();

    await expect
      .poll(() => readWindowState(application!), { timeout: 30_000 })
      .toMatchObject({
        harnessContents: 1,
        productVisible: true,
        recoveryVisible: false,
      });

    const product = application
      .windows()
      .find((page) => page.url().startsWith('http://127.0.0.1:'));
    expect(product).toBeDefined();
    await expect
      .poll(() => product!.locator('[data-desktop-frame="prototype"]').count())
      .toBe(1);
    expect(await product!.locator('[data-testid="integrated-workspace-panel"]').count()).toBe(0);
    expect(await product!.locator('[data-testid="integrated-workspace-toggle"]').count()).toBe(0);
  }, 45_000);
});

async function readWindowState(application: ElectronApplication): Promise<{
  readonly harnessContents: number;
  readonly productVisible: boolean;
  readonly recoveryVisible: boolean;
}> {
  return application.evaluate(({ BrowserWindow, webContents }) => {
    const windows = BrowserWindow.getAllWindows();
    const product = windows.find((window) =>
      window.webContents.getURL().startsWith('http://127.0.0.1:'),
    );
    const recovery = windows.find((window) => window.webContents.getURL().startsWith('file:'));
    return {
      harnessContents: webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('http://127.0.0.1:'))
        .length,
      productVisible: product?.isVisible() === true,
      recoveryVisible: recovery?.isVisible() === true,
    };
  });
}
