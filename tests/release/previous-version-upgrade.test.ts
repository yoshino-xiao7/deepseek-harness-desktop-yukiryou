import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from '../e2e/executable-path.js';

const defaultPreviousExecutable = join(
  process.cwd(),
  'out',
  'release',
  'zip-verification-second',
  'DeepSeek YukiRyou.app',
  'Contents',
  'MacOS',
  'DeepSeek YukiRyou',
);
const previousExecutable =
  process.env.DSH_PREVIOUS_EXECUTABLE_PATH?.trim() || defaultPreviousExecutable;

describe('previous-version upgrade', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it('preserves the 0.1.0 Runtime Home layout when the current app starts', async () => {
    if (!existsSync(previousExecutable)) {
      throw new Error(
        `Previous-version application is required at ${previousExecutable}; set DSH_PREVIOUS_EXECUTABLE_PATH to an extracted 0.1.0 executable`,
      );
    }
    const previousInfoPlist = join(
      dirname(dirname(previousExecutable)),
      'Info.plist',
    );
    expect(
      execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleShortVersionString', previousInfoPlist],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe('0.1.0');

    userData = await mkdtemp(join(tmpdir(), 'dsh-upgrade-e2e-'));
    const runtimeHome = join(userData, 'runtime');
    const preservedDirectory = join(runtimeHome, 'upgrade-preserved');
    const sentinelPath = join(preservedDirectory, 'sentinel.txt');
    const settingsPath = join(runtimeHome, 'settings.yaml');
    await mkdir(preservedDirectory, { recursive: true });
    await writeFile(sentinelPath, 'created-by-0.1.0\n');
    await writeFile(settingsPath, 'appearance:\n  theme: dark\n');

    electronApp = await launchAndWait(resolveE2eExecutablePath(), userData);

    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('created-by-0.1.0\n');
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(
      'appearance:\n  theme: dark\n',
    );
    await expect(readFile(join(userData, 'logs', 'desktop.log'), 'utf8')).resolves.toContain(
      'runtime.state',
    );
  }, 120_000);
});

async function launchAndWait(
  executablePath: string,
  userData: string,
): Promise<ElectronApplication> {
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, DSH_DESKTOP_E2E: '1' },
  });
  await application.firstWindow();
  await expect
    .poll(
      () =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((contents) => contents.getURL().startsWith('http://127.0.0.1:')),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  return application;
}
