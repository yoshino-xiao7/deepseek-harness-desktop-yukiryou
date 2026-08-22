import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeElectronTestApplication } from './electron-cleanup.js';
import { resolveE2eExecutablePath } from './executable-path.js';

describe('packaged Runtime startup', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await closeElectronTestApplication(electronApp);
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true });
    }
  }, 30_000);

  it('starts the exact packaged application and reaches the Harness UI', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-startup-e2e-'));
    electronApp = await electron.launch({
      executablePath: resolveE2eExecutablePath(),
      args: [`--user-data-dir=${userData}`],
      env: { ...process.env, DSH_DESKTOP_E2E: '1' },
    });
    await electronApp.firstWindow();

    await expect
      .poll(
        () =>
          electronApp?.evaluate(async ({ webContents }) => {
            const harness = webContents
              .getAllWebContents()
              .find((contents) =>
                contents.getURL().startsWith('http://127.0.0.1:'),
              );
            if (harness === undefined) return undefined;
            try {
              return await harness.executeJavaScript(`({
                  readyState: document.readyState,
                  electronPrivilegesExposed:
                    typeof window.require !== "undefined" ||
                    typeof window.process !== "undefined"
                })`);
            } catch {
              return undefined;
            }
          }),
        { timeout: 30_000 },
      )
      .toEqual({
        readyState: 'complete',
        electronPrivilegesExposed: false,
      });
  }, 45_000);
});
