import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeElectronTestApplication } from '../e2e/electron-cleanup.js';
import { waitForUpdateShell } from './update-shell.js';

const execute = promisify(execFile);
const previousExecutable = requiredEnvironment('DSH_PREVIOUS_EXECUTABLE_PATH');
const relaunchExecutable = requiredEnvironment('DSH_AUTOMATIC_UPDATE_RELAUNCH_PATH');
const expectedVersion = requiredEnvironment('DSH_AUTOMATIC_UPDATE_EXPECTED_VERSION');

describe('previous public release automatic update', () => {
  let application: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await closeElectronTestApplication(application);
    await preserveInstalledApplicationDiagnostics(relaunchExecutable);
    if (userData !== undefined) {
      await preserveDiagnostics(userData);
      await rm(userData, {
        recursive: true,
        force: true,
        maxRetries: process.platform === 'win32' ? 20 : 0,
        retryDelay: 100,
      });
    }
  }, 30_000);

  it('downloads, installs, relaunches, and replaces the old public application', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-real-update-gate-'));
    const mirrorHost = process.env.DSH_AUTOMATIC_UPDATE_MIRROR_HOST?.trim();
    const certificateSpkiPin =
      process.env.DSH_AUTOMATIC_UPDATE_CERTIFICATE_SPKI_PIN?.trim();
    application = await electron.launch({
      executablePath: previousExecutable,
      // The release gate serves the exact candidate from a loopback HTTPS
      // mirror. Ignore runner-level proxies so the test exercises the updater
      // rather than an unrelated corporate proxy or PAC configuration.
      args: [
        `--user-data-dir=${userData}`,
        '--no-proxy-server',
        ...(mirrorHost === undefined || mirrorHost === ''
          ? []
          : [`--host-resolver-rules=MAP ${mirrorHost} 127.0.0.1`]),
        ...(certificateSpkiPin === undefined || certificateSpkiPin === ''
          ? []
          : [`--ignore-certificate-errors-spki-list=${certificateSpkiPin}`]),
      ],
      env: {
        ...process.env,
        DSH_DESKTOP_DISTRIBUTION_REGION: 'china',
      },
    });
    await application.firstWindow();
    const shell = await waitForUpdateShell(application);

    await invokeUpdate(shell, 'check');
    await waitForDownloaded(shell);
    await waitForPreviousMacUpdaterReadiness(expectedVersion);

    const closed = new Promise<void>((resolve) => application?.once('close', () => resolve()));
    await invokeUpdate(shell, 'install');
    await expect(closed).resolves.toBeUndefined();
    application = undefined;

    await preserveProcessSnapshot('after-old-process-exit');

    // This is intentionally an OS-process assertion, not a second Playwright
    // launch. It proves the updater itself requested a real post-install relaunch.
    await expect.poll(() => isRelaunched(relaunchExecutable), {
      timeout: 3 * 60_000,
      interval: 1_000,
    }).toBe(true);

    await stopRelaunched(relaunchExecutable);
    const smoke = await execute(relaunchExecutable, ['--release-smoke-test'], {
      timeout: 30_000,
    });
    expect(smoke.stdout).toContain('DEEPSEEK_YUKIRYOU_RELEASE_SMOKE_OK');
    expect(JSON.parse(smoke.stdout.slice(smoke.stdout.indexOf('{')))).toMatchObject({
      version: expectedVersion,
      packaged: true,
    });

    const log = await readFile(join(userData, 'logs', 'desktop.log'), 'utf8');
    expect(log).toContain('"status":"downloaded"');
  }, 20 * 60_000);
});

async function waitForPreviousMacUpdaterReadiness(version: string): Promise<void> {
  if (process.platform !== 'darwin') return;

  // v1.0.3 exposed electron-updater's public download event before the
  // Squirrel.Mac bridge had finished staging the same ZIP. That released
  // version cannot be changed retroactively. Wait for its native staging
  // process here; v1.0.4 and later already keep the restart action hidden
  // until Electron's native update-downloaded event arrives.
  await expect.poll(() => hasStagedMacUpdate(version), {
    timeout: 10 * 60_000,
    interval: 1_000,
  }).toBe(true);
  await expect.poll(() => isMacShipItRunning(), {
    timeout: 2 * 60_000,
    interval: 500,
  }).toBe(false);
}

async function hasStagedMacUpdate(version: string): Promise<boolean> {
  const shipItCache = join(
    homedir(),
    'Library',
    'Caches',
    'com.yukiryou.deepseek.yukiryou.ShipIt',
  );
  const result = await execute('/usr/bin/find', [
    shipItCache,
    '-path',
    '*/DeepSeek YukiRyou.app/Contents/Info.plist',
    '-print',
  ]).catch(() => undefined);
  if (result === undefined) return false;
  for (const infoPlist of result.stdout.split('\n').filter(Boolean)) {
    const stagedVersion = await execute('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      infoPlist,
    ]).then((value) => value.stdout.trim(), () => '');
    if (stagedVersion === version) return true;
  }
  return false;
}

async function isMacShipItRunning(): Promise<boolean> {
  const result = await execute('/bin/ps', ['-ww', '-axo', 'command=']);
  return result.stdout.includes('com.yukiryou.deepseek.yukiryou.ShipIt');
}

async function invokeUpdate(page: Page, command: 'check' | 'install'): Promise<void> {
  await page.evaluate((value) => {
    const updates = (window as unknown as {
      deepSeekYukiRyouUpdates?: { check(): void; install(): void };
    }).deepSeekYukiRyouUpdates;
    if (updates === undefined) throw new Error('Desktop update bridge is unavailable');
    updates[value]();
  }, command);
}

async function readUpdateStatus(page: Page): Promise<string | undefined> {
  try {
    return await page.evaluate(() => (window as unknown as {
      deepSeekYukiRyouUpdates?: { getSnapshot(): { status?: string } };
    }).deepSeekYukiRyouUpdates?.getSnapshot().status);
  } catch {
    return undefined;
  }
}

async function waitForDownloaded(page: Page): Promise<void> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const status = await readUpdateStatus(page);
    if (status === 'downloaded') return;
    if (status === 'latest' || status === 'manual' || status === 'error' || status === 'disabled') {
      throw new Error(`Updater reached terminal status before download: ${status}`);
    }
    await delay(1_000);
  }
  throw new Error(`Updater did not download within 15 minutes; last status: ${await readUpdateStatus(page)}`);
}

async function isRelaunched(executable: string): Promise<boolean> {
  if (process.platform === 'win32') {
    const script = `$p=${powerShellLiteral(executable)}; [bool](Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $p })`;
    const result = await execute('powershell.exe', ['-NoProfile', '-Command', script]);
    return result.stdout.trim().toLowerCase() === 'true';
  }
  const result = await execute('/bin/ps', ['-axo', 'command=']);
  return result.stdout.split('\n').some((line) => line === executable || line.startsWith(`${executable} `));
}

async function stopRelaunched(executable: string): Promise<void> {
  if (process.platform === 'win32') {
    const script = `$p=${powerShellLiteral(executable)}; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $p } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    await execute('powershell.exe', ['-NoProfile', '-Command', script]);
    return;
  }
  const result = await execute('/bin/ps', ['-axo', 'pid=,command=']);
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (match !== null && (match[2] === executable || match[2]?.startsWith(`${executable} `))) {
      process.kill(Number(match[1]), 'SIGTERM');
    }
  }
}

async function preserveInstalledApplicationDiagnostics(executable: string): Promise<void> {
  const diagnostics = process.env.DSH_AUTOMATIC_UPDATE_DIAGNOSTICS;
  if (diagnostics === undefined || diagnostics === '' || process.platform !== 'darwin') return;
  await mkdir(diagnostics, { recursive: true });
  const infoPlist = join(executable, '..', '..', 'Info.plist');
  const installedVersion = await execute('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    infoPlist,
  ]).then((result) => result.stdout.trim(), (error: unknown) => String(error));
  await writeFile(join(diagnostics, 'installed-version.txt'), `${installedVersion}\n`, 'utf8');
  await copyFile(
    join(
      homedir(),
      'Library',
      'Application Support',
      'DeepSeek YukiRyou',
      'logs',
      'desktop.log',
    ),
    join(diagnostics, 'relaunched-desktop.log'),
  ).catch(() => undefined);
}

async function preserveDiagnostics(userDataDirectory: string): Promise<void> {
  const diagnostics = process.env.DSH_AUTOMATIC_UPDATE_DIAGNOSTICS;
  if (diagnostics === undefined || diagnostics === '') return;
  await mkdir(diagnostics, { recursive: true });
  await copyFile(
    join(userDataDirectory, 'logs', 'desktop.log'),
    join(diagnostics, 'desktop.log'),
  ).catch(() => undefined);
  await preserveProcessSnapshot('test-cleanup');
}

async function preserveProcessSnapshot(stage: string): Promise<void> {
  const diagnostics = process.env.DSH_AUTOMATIC_UPDATE_DIAGNOSTICS;
  if (diagnostics === undefined || diagnostics === '') return;
  await mkdir(diagnostics, { recursive: true });
  const snapshot = process.platform === 'win32'
    ? await execute('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | Format-List',
      ])
    : await execute('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,command=']);
  await writeFile(join(diagnostics, `processes-${stage}.log`), snapshot.stdout, 'utf8');
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}
