import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeElectronTestApplication } from '../e2e/electron-cleanup.js';
import { waitForUpdateShell } from './update-shell.js';

const execute = promisify(execFile);
const sourceExecutable = requiredEnvironment('DSH_AUTOMATIC_UPDATE_SOURCE_EXECUTABLE_PATH');
const relaunchExecutable = requiredEnvironment('DSH_AUTOMATIC_UPDATE_RELAUNCH_PATH');
const expectedUpdateVersion = requiredEnvironment('DSH_AUTOMATIC_UPDATE_EXPECTED_VERSION');
const expectedInstalledVersion =
  process.env.DSH_AUTOMATIC_UPDATE_INSTALLED_VERSION?.trim() || expectedUpdateVersion;
const expectedWindowsInstallMode = process.platform === 'win32'
  ? requiredEnvironment('DSH_AUTOMATIC_UPDATE_EXPECTED_INSTALL_MODE')
  : undefined;
const downloadTimeoutMs = 2 * 60_000;
const oldProcessExitTimeoutMs = 60_000;
// The bundled Runtime contains roughly 55k files. A healthy NSIS repair can
// take more than three minutes on the physical Windows runner. The production
// helper bounds NSIS at ten minutes, so the gate waits slightly beyond that
// boundary and judges the recorded installer exit code.
const relaunchTimeoutMs = 11 * 60_000;

describe('release candidate automatic update', () => {
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

  it('downloads, installs, exits, and relaunches the release candidate', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-real-update-gate-'));
    const certificateSpkiPin =
      process.env.DSH_AUTOMATIC_UPDATE_CERTIFICATE_SPKI_PIN?.trim();
    application = await electron.launch({
      executablePath: sourceExecutable,
      // The release gate serves the exact candidate from a loopback HTTPS
      // mirror. Ignore runner-level proxies so the test exercises the updater
      // rather than an unrelated corporate proxy or PAC configuration.
      args: [
        `--user-data-dir=${userData}`,
        '--no-proxy-server',
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
    await configureUpdaterGateSession(application, expectedUpdateVersion);
    const shell = await waitForUpdateShell(application);

    await invokeUpdate(shell, 'check');
    await waitForDownloaded(shell);
    await waitForPreviousMacUpdaterReadiness(expectedInstalledVersion);

    const previousWindowsHandoffs = await listWindowsHandoffDirectories();
    const previousWindowsProcessIds = await windowsInstallDirectoryProcessIds(
      dirname(relaunchExecutable),
    );
    if (process.platform === 'win32' && previousWindowsProcessIds.size === 0) {
      throw new Error('Release gate could not identify the installed Windows application process');
    }
    const closed = new Promise<void>((resolve) => application?.once('close', () => resolve()));
    await invokeUpdate(shell, 'install');
    await waitForApplicationClose(application, closed, previousWindowsProcessIds);
    application = undefined;

    await preserveProcessSnapshot('after-old-process-exit');

    // This is intentionally an OS-process assertion, not a second Playwright
    // launch. It proves the updater itself requested a real post-install relaunch.
    try {
      await verifyWindowsUpdateHandoff(previousWindowsHandoffs, previousWindowsProcessIds);
      await expect.poll(() => isRelaunched(relaunchExecutable, previousWindowsProcessIds), {
        timeout: process.platform === 'win32' ? 30_000 : relaunchTimeoutMs,
        interval: 1_000,
      }).toBe(true);
    } catch (error) {
      await preserveProcessSnapshot('relaunch-timeout');
      throw error;
    }

    await stopRelaunched(relaunchExecutable);
    const smoke = await execute(relaunchExecutable, ['--release-smoke-test'], {
      timeout: 30_000,
    });
    expect(smoke.stdout).toContain('DEEPSEEK_YUKIRYOU_RELEASE_SMOKE_OK');
    expect(JSON.parse(smoke.stdout.slice(smoke.stdout.indexOf('{')))).toMatchObject({
      version: expectedInstalledVersion,
      packaged: true,
    });

    const log = await readFile(join(userData, 'logs', 'desktop.log'), 'utf8');
    expect(log).toContain('"status":"downloaded"');
  }, 16 * 60_000);
});

async function waitForApplicationClose(
  application: ElectronApplication,
  closed: Promise<void>,
  previousWindowsProcessIds: ReadonlySet<number>,
): Promise<void> {
  const launcherPid = application.process().pid;
  if (launcherPid === undefined) {
    throw new Error('Release candidate source process did not expose a PID');
  }
  const deadline = Date.now() + oldProcessExitTimeoutMs;
  let driverClosed = false;
  void closed.then(() => {
    driverClosed = true;
  });
  while (Date.now() < deadline) {
    // Playwright exposes its Windows launcher PID, while the installed
    // Electron main process is a child. Wait for every pre-update process
    // whose executable lives under the installation directory, including the
    // bundled runtime/provider processes, instead of trusting transport close.
    if (process.platform === 'win32') {
      if ([...previousWindowsProcessIds].every((pid) => !isProcessRunning(pid))) return;
    } else if (driverClosed || !isProcessRunning(launcherPid)) {
      return;
    }
    await delay(250);
  }
  await preserveProcessSnapshot('old-process-exit-timeout');
  await preserveApplicationSnapshot(application, 'old-process-exit-timeout');
  throw new Error(
    `Release candidate did not exit within ${String(oldProcessExitTimeoutMs)}ms ` +
    'after requesting update installation',
  );
}

async function listWindowsHandoffDirectories(): Promise<ReadonlySet<string>> {
  if (process.platform !== 'win32') return new Set();
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  return new Set(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('dsh-yukiryou-update-'))
    .map((entry) => entry.name));
}

async function verifyWindowsUpdateHandoff(
  previousDirectories: ReadonlySet<string>,
  previousProcessIds: ReadonlySet<number>,
): Promise<void> {
  if (process.platform !== 'win32') return;
  let handoff: WindowsHandoffLog | undefined;
  await expect.poll(async () => {
    handoff = await findWindowsHandoffLog(previousDirectories, previousProcessIds);
    return handoff?.log.includes('event=completed') ?? false;
  }, {
    timeout: relaunchTimeoutMs,
    interval: 250,
  }).toBe(true);

  if (handoff === undefined || expectedWindowsInstallMode === undefined) {
    throw new Error('Completed Windows update handoff log is missing');
  }
  const handoffLog = handoff.log;
  const parentExited = handoffLog.indexOf(
    `event=parent-exited parent=${String(handoff.parentProcessId)}`,
  );
  const applicationExited = handoffLog.indexOf('event=application-exited');
  const installerStarted = handoffLog.indexOf('event=installer-started');
  const installerExited = handoffLog.indexOf('event=installer-exited code=0');
  const relaunchStarted = handoffLog.indexOf('event=relaunch-started');
  const completed = handoffLog.indexOf('event=completed');
  expect(parentExited).toBeGreaterThan(-1);
  expect(applicationExited).toBeGreaterThan(parentExited);
  expect(installerStarted).toBeGreaterThan(applicationExited);
  expect(installerExited).toBeGreaterThan(installerStarted);
  expect(relaunchStarted).toBeGreaterThan(installerExited);
  expect(completed).toBeGreaterThan(relaunchStarted);

  const installerLine = handoffLog.slice(installerStarted, handoffLog.indexOf('\n', installerStarted));
  expect(installerLine).toContain(expectedWindowsInstallMode);
  expect(installerLine).toContain(`/D=${dirname(relaunchExecutable)}`);
  expect(installerLine).not.toContain('--force-run');
  const relaunchLine = handoffLog.slice(relaunchStarted, handoffLog.indexOf('\n', relaunchStarted));
  expect(relaunchLine).toContain(`executable=${relaunchExecutable}`);
}

interface WindowsHandoffLog {
  readonly log: string;
  readonly parentProcessId: number;
}

async function findWindowsHandoffLog(
  previousDirectories: ReadonlySet<string>,
  previousProcessIds: ReadonlySet<number>,
): Promise<WindowsHandoffLog | undefined> {
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith('dsh-yukiryou-update-') ||
      previousDirectories.has(entry.name)
    ) continue;
    const handoffLog = await readFile(join(tmpdir(), entry.name, 'handoff.log'), 'utf8')
      .catch(() => undefined);
    if (handoffLog === undefined) continue;
    const parentMatch = /event=armed parent=(\d+)/u.exec(handoffLog);
    if (parentMatch?.[1] === undefined) continue;
    const parentProcessId = Number(parentMatch[1]);
    if (previousProcessIds.has(parentProcessId)) {
      return { log: handoffLog, parentProcessId };
    }
  }
  return undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code !== 'ESRCH';
  }
}

async function configureUpdaterGateSession(
  application: ElectronApplication,
  version: string,
): Promise<void> {
  const metadataUrl = process.env.DSH_AUTOMATIC_UPDATE_MIRROR_METADATA_URL?.trim();
  if (metadataUrl === undefined || metadataUrl === '') return;
  const result = await application.evaluate(async ({ session }, url) => {
    const updaterSession = session.fromPartition('electron-updater', { cache: false });
    await updaterSession.setProxy({ mode: 'direct' });
    await updaterSession.clearHostResolverCache();
    const response = await updaterSession.fetch(url, { cache: 'no-store' });
    return {
      status: response.status,
      body: await response.text(),
      region: process.env.DSH_DESKTOP_DISTRIBUTION_REGION,
    };
  }, metadataUrl);
  expect(result.region).toBe('china');
  if (result.status !== 200 || !result.body.includes(`version: ${version}`)) {
    throw new Error(
      `Updater mirror preflight did not expose the expected version ${version}: ` +
      `status=${String(result.status)} body=${result.body.slice(0, 200)}`,
    );
  }
}

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
  const deadline = Date.now() + downloadTimeoutMs;
  while (Date.now() < deadline) {
    const status = await readUpdateStatus(page);
    if (status === 'downloaded') return;
    if (status === 'latest' || status === 'manual' || status === 'error' || status === 'disabled') {
      throw new Error(`Updater reached terminal status before download: ${status}`);
    }
    await delay(1_000);
  }
  throw new Error(
    `Updater did not download within ${String(downloadTimeoutMs)}ms; ` +
    `last status: ${await readUpdateStatus(page)}`,
  );
}

async function preserveApplicationSnapshot(
  application: ElectronApplication,
  stage: string,
): Promise<void> {
  const diagnostics = process.env.DSH_AUTOMATIC_UPDATE_DIAGNOSTICS;
  if (diagnostics === undefined || diagnostics === '') return;
  await mkdir(diagnostics, { recursive: true });
  const windows = application.windows().map((page) => ({
    url: page.url(),
    closed: page.isClosed(),
  }));
  await writeFile(
    join(diagnostics, `application-${stage}.json`),
    `${JSON.stringify({ pid: application.process().pid, windows }, null, 2)}\n`,
    'utf8',
  );
}

async function windowsExecutableProcessIds(executable: string): Promise<ReadonlySet<number>> {
  if (process.platform !== 'win32') return new Set();
  const script = `$p=${powerShellLiteral(executable)}; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $p } | ForEach-Object { $_.ProcessId }`;
  const result = await execute('powershell.exe', ['-NoProfile', '-Command', script]);
  return new Set(result.stdout
    .split(/\r?\n/u)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0));
}

async function windowsInstallDirectoryProcessIds(
  installDirectory: string,
): Promise<ReadonlySet<number>> {
  if (process.platform !== 'win32') return new Set();
  const script = [
    `$root=${powerShellLiteral(installDirectory)}.TrimEnd('\\')`,
    `$prefix="$root\\"`,
    'Get-CimInstance Win32_Process -ErrorAction Stop',
    '| Where-Object {',
    '$_.ExecutablePath -and',
    '$_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)',
    '} | ForEach-Object { $_.ProcessId }',
  ].join(' ');
  const result = await execute('powershell.exe', ['-NoProfile', '-Command', script]);
  return new Set(result.stdout
    .split(/\r?\n/u)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0));
}

async function isRelaunched(
  executable: string,
  previousWindowsProcessIds: ReadonlySet<number>,
): Promise<boolean> {
  if (process.platform === 'win32') {
    const processIds = await windowsExecutableProcessIds(executable);
    return [...processIds].some((processId) => !previousWindowsProcessIds.has(processId));
  }
  const result = await execute('/bin/ps', ['-axo', 'command=']);
  return result.stdout.split('\n').some((line) => line === executable || line.startsWith(`${executable} `));
}

async function stopRelaunched(executable: string): Promise<void> {
  if (process.platform === 'win32') {
    const installDirectory = dirname(executable);
    const script = [
      `$root=${powerShellLiteral(installDirectory)}.TrimEnd('\\')`,
      `$prefix="$root\\"`,
      'Get-CimInstance Win32_Process -ErrorAction Stop',
      '| Where-Object {',
      '$_.ExecutablePath -and',
      '$_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)',
      '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    ].join(' ');
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
  if (diagnostics === undefined || diagnostics === '') return;
  await mkdir(diagnostics, { recursive: true });
  if (process.platform === 'win32') {
    const smoke = await execute(executable, ['--release-smoke-test'], {
      timeout: 30_000,
    }).then((result) => result.stdout.trim(), (error: unknown) => String(error));
    await writeFile(join(diagnostics, 'installed-version.txt'), `${smoke}\n`, 'utf8');
    return;
  }
  if (process.platform !== 'darwin') return;
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
  if (process.platform === 'win32') {
    const handoffDirectories = await readdir(tmpdir(), { withFileTypes: true })
      .then((entries) => entries.filter(
        (entry) => entry.isDirectory() && entry.name.startsWith('dsh-yukiryou-update-'),
      ));
    for (const directory of handoffDirectories) {
      for (const file of ['handoff.log', 'handoff.ps1', 'handoff.cjs', 'ready']) {
        await copyFile(
          join(tmpdir(), directory.name, file),
          join(diagnostics, `${directory.name}-${file}`),
        ).catch(() => undefined);
      }
    }
  }
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
        [
          '$installRoot =', `${powerShellLiteral(dirname(relaunchExecutable))};`,
          'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
          'Where-Object {',
          '($_.Name -like "*DeepSeek*") -or ($_.Name -like "*Setup*") -or',
          '($_.Name -like "*nsis*") -or',
          '($_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)) -or',
          '($_.CommandLine -and $_.CommandLine.Contains($installRoot, [System.StringComparison]::OrdinalIgnoreCase))',
          '} | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate |',
          'ConvertTo-Json -Depth 3',
        ].join(' '),
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
