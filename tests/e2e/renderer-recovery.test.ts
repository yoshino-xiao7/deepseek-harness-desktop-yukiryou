import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

const targetArchitecture = process.env.DSH_E2E_ARCH ?? process.arch;
const executablePath = join(
  process.cwd(),
  'out',
  `DeepSeek YukiRyou-darwin-${targetArchitecture}`,
  'DeepSeek YukiRyou.app',
  'Contents',
  'MacOS',
  'DeepSeek YukiRyou',
);

describe('renderer recovery', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it(
    'recovers Harness and toolbar renderers without restarting the other',
    async () => {
      userData = await mkdtemp(join(tmpdir(), 'dsh-renderer-recovery-'));
      electronApp = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userData}`],
      });
      await withTimeout(electronApp.firstWindow(), 'open first window', 10_000);

      await expect
        .poll(
          () =>
            withTimeout(
              rendererReadiness(electronApp!),
              'read renderer readiness',
              1_000,
            ).catch(() => ({ harness: false, toolbar: false })),
          { timeout: 20_000 },
        )
        .toEqual({ harness: true, toolbar: true });

      await withTimeout(
        electronApp.evaluate(async ({ webContents }) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          await harness?.executeJavaScript(
            'globalThis.__desktopRecoveryMarker = "before-crash"',
          );
          harness?.forcefullyCrashRenderer();
        }),
        'crash Harness renderer',
        5_000,
      );
      await expect
        .poll(
          () =>
            withTimeout(
              harnessRecovered(electronApp!),
              'read Harness recovery',
              1_000,
            ).catch(() => false),
          { timeout: 10_000 },
        )
        .toBe(true);

      await withTimeout(
        electronApp.evaluate(async ({ webContents }) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          await harness?.executeJavaScript(
            'globalThis.__harnessSurvivesToolbarCrash = "yes"',
          );
          const toolbar = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith('file:'));
          toolbar?.forcefullyCrashRenderer();
        }),
        'crash toolbar renderer',
        5_000,
      );
      await expect
        .poll(
          () =>
            withTimeout(
              toolbarRecovered(electronApp!),
              'read toolbar recovery',
              1_000,
            ).catch(() => false),
          { timeout: 10_000 },
        )
        .toBe(true);
      await expect(
        electronApp.evaluate(async ({ webContents }) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          return harness?.executeJavaScript(
            'globalThis.__harnessSurvivesToolbarCrash',
          );
        }),
      ).resolves.toBe('yes');
    },
    60_000,
  );
});

async function rendererReadiness(
  electronApp: ElectronApplication,
): Promise<{ harness: boolean; toolbar: boolean }> {
  return electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents();
    const harness = contents.find((item) =>
      item.getURL().startsWith('http://127.0.0.1:'),
    );
    const toolbar = contents.find((item) => item.getURL().startsWith('file:'));
    return {
      harness: await isReady(harness),
      toolbar: await isReady(toolbar),
    };
    async function isReady(item: Electron.WebContents | undefined) {
      try {
        return (await item?.executeJavaScript('document.readyState')) === 'complete';
      } catch {
        return false;
      }
    }
  });
}

async function harnessRecovered(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(async ({ webContents }) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) =>
        contents.getURL().startsWith('http://127.0.0.1:'),
      );
    try {
      return Boolean(
        await harness?.executeJavaScript(
          'document.readyState === "complete" && globalThis.__desktopRecoveryMarker === undefined',
        ),
      );
    } catch {
      return false;
    }
  });
}

async function toolbarRecovered(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(async ({ webContents }) => {
    const toolbar = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('file:'));
    try {
      return (await toolbar?.executeJavaScript('document.readyState')) === 'complete';
    } catch {
      return false;
    }
  });
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
        timeoutMs,
      );
    }),
  ]);
}
