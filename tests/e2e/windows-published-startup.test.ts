import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeElectronTestApplication } from './electron-cleanup.js';
import { resolveE2eExecutablePath } from './executable-path.js';

const diagnosticsDirectory = join(
  process.cwd(),
  'out',
  'windows-live-diagnostics',
);

describe.skipIf(process.platform !== 'win32')(
  'published Windows application on the real user profile',
  () => {
    let electronApp: ElectronApplication | undefined;
    let shellPage: Page | undefined;

    afterEach(async () => {
      await captureDiagnostics(electronApp, shellPage);
      await closeElectronTestApplication(electronApp);
    }, 30_000);

    it('leaves the wake screen and reaches an interactive Harness UI', async () => {
      electronApp = await electron.launch({
        executablePath: resolveE2eExecutablePath(),
        env: { ...process.env, DSH_DESKTOP_E2E: '1' },
      });
      shellPage = await electronApp.firstWindow();

      await shellPage.emulateMedia({ reducedMotion: 'reduce' });
      const motionSamples = await shellPage.evaluate(async () => {
        const shell = document.querySelector<HTMLElement>('.loading-shell');
        const progress = document.querySelector<HTMLElement>('.progress-track span');
        if (shell === null || progress === null) return [];
        const previousDisplay = shell.style.display;
        shell.style.display = 'block';
        const samples: string[] = [];
        for (let index = 0; index < 8; index += 1) {
          samples.push(window.getComputedStyle(progress).opacity);
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        shell.style.display = previousDisplay;
        return samples;
      });
      expect(new Set(motionSamples).size).toBeGreaterThan(2);
      await shellPage.emulateMedia({ reducedMotion: 'no-preference' });

      await expect
        .poll(() => readPublishedStartupState(electronApp), {
          interval: 500,
          timeout: 45_000,
        })
        .toMatchObject({
          harnessReadyState: 'complete',
          hasInteractiveComposer: true,
        });
    }, 90_000);
  },
);

async function readPublishedStartupState(
  application: ElectronApplication | undefined,
): Promise<{
  readonly harnessReadyState?: string;
  readonly hasInteractiveComposer: boolean;
}> {
  if (application === undefined) {
    return { hasInteractiveComposer: false };
  }
  return application.evaluate(async ({ webContents }) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) {
      return { hasInteractiveComposer: false };
    }
    try {
      return await harness.executeJavaScript(`({
        harnessReadyState: document.readyState,
        hasInteractiveComposer:
          document.querySelector('textarea, [contenteditable="true"]') !== null
      })`);
    } catch {
      return { hasInteractiveComposer: false };
    }
  });
}

async function captureDiagnostics(
  application: ElectronApplication | undefined,
  page: Page | undefined,
): Promise<void> {
  await mkdir(diagnosticsDirectory, { recursive: true });
  if (page !== undefined && !page.isClosed()) {
    await page
      .screenshot({ path: join(diagnosticsDirectory, 'application-window.png') })
      .catch(() => undefined);
  }
  const snapshot =
    application === undefined
      ? { launched: false }
      : await application
          .evaluate(async ({ webContents }) => {
            const entries = webContents.getAllWebContents().map((contents) => ({
              type: contents.getType(),
              url: contents.getURL(),
            }));
            const shell = webContents
              .getAllWebContents()
              .find((contents) => contents.getURL().startsWith('file:'));
            let shellCopy: unknown;
            try {
              shellCopy = await shell?.executeJavaScript(`({
                heading: document.querySelector('h1')?.textContent?.trim(),
                status: document.querySelector('[data-testid="startup-status"]')?.textContent?.trim()
              })`);
            } catch {
              shellCopy = undefined;
            }
            return { launched: true, entries, shell: shellCopy };
          })
          .catch((error: unknown) => ({
            launched: true,
            captureError: error instanceof Error ? error.message : String(error),
          }));
  await writeFile(
    join(diagnosticsDirectory, 'startup-state.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
}
