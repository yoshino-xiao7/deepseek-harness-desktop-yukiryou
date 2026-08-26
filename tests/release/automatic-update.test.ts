import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const previousExecutable = requiredEnvironment('DSH_PREVIOUS_EXECUTABLE_PATH');
const relaunchExecutable = requiredEnvironment('DSH_AUTOMATIC_UPDATE_RELAUNCH_PATH');
const expectedVersion = requiredEnvironment('DSH_AUTOMATIC_UPDATE_EXPECTED_VERSION');

describe('previous public release automatic update', () => {
  let application: ElectronApplication | undefined;

  afterEach(async () => {
    if (application !== undefined) {
      try { await application.close(); } catch { /* updater may already own shutdown */ }
    }
  });

  it('downloads, installs, relaunches, and replaces the old public application', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'dsh-real-update-gate-'));
    application = await electron.launch({
      executablePath: previousExecutable,
      args: [`--user-data-dir=${userData}`],
      env: {
        ...process.env,
        DSH_DESKTOP_DISTRIBUTION_REGION: 'china',
      },
    });
    const shell = await application.firstWindow();

    await invokeUpdate(shell, 'check');
    await expect.poll(() => readUpdateStatus(shell), {
      timeout: 15 * 60_000,
      interval: 1_000,
    }).toBe('downloaded');

    const closed = new Promise<void>((resolve) => application?.once('close', () => resolve()));
    await invokeUpdate(shell, 'install');
    await expect(closed).resolves.toBeUndefined();
    application = undefined;

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

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}
