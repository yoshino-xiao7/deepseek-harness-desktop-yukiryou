import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  cleanupStaleWindowsUpdateHandoffs,
  createWindowsUpdateHandoffCommand,
  createWindowsUpdateHandoffScript,
  createWindowsUpdateLauncherScript,
  spawnDetachedUpdateHelper,
  windowsUpdateHandoffArguments,
} from './windows-nsis-updater.js';

describe('reliable Windows NSIS update handoff', () => {
  it('cleans finished helper runtimes without touching a recent or active handoff', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-helper-cleanup-test-'));
    const now = Date.now();
    const finished = join(root, 'dsh-yukiryou-update-finished');
    const recent = join(root, 'dsh-yukiryou-update-recent');
    const active = join(root, 'dsh-yukiryou-update-active');
    const abandoned = join(root, 'dsh-yukiryou-update-abandoned');
    try {
      for (const directory of [finished, recent, active, abandoned]) mkdirSync(directory);
      writeFileSync(join(finished, 'handoff.log'), 'event=completed\n');
      writeFileSync(join(recent, 'handoff.log'), 'event=failed\n');
      writeFileSync(join(active, 'handoff.log'), 'event=armed\n');
      const tenMinutesAgo = new Date(now - 10 * 60_000);
      const twoMinutesAgo = new Date(now - 2 * 60_000);
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60_000);
      for (const path of [finished, join(finished, 'handoff.log'), active, join(active, 'handoff.log')]) {
        utimesSync(path, tenMinutesAgo, tenMinutesAgo);
      }
      for (const path of [recent, join(recent, 'handoff.log')]) {
        utimesSync(path, twoMinutesAgo, twoMinutesAgo);
      }
      utimesSync(abandoned, twoDaysAgo, twoDaysAgo);

      cleanupStaleWindowsUpdateHandoffs(root, now);

      expect(existsSync(finished)).toBe(false);
      expect(existsSync(abandoned)).toBe(false);
      expect(existsSync(recent)).toBe(true);
      expect(existsSync(active)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the parent alive through the helper ownership window', async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
      child.unref = vi.fn().mockReturnValue(child);
      const spawnProcess = vi.fn().mockReturnValue(child);
      let ready = false;
      let confirmed = false;
      const handoff = spawnDetachedUpdateHelper(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-File', 'C:\\Temp\\handoff.ps1'],
        'C:\\Temp\\ready',
        {
          spawnProcess,
          workingDirectory: 'C:\\Temp',
          readyFileExists: () => ready,
          readyTimeoutMs: 200,
          readyPollIntervalMs: 25,
        },
      ).then(() => { confirmed = true; });

      expect(child.unref).toHaveBeenCalledOnce();
      expect(spawnProcess).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-File', 'C:\\Temp\\handoff.ps1'],
        'C:\\Temp',
      );
      await vi.advanceTimersByTimeAsync(199);
      expect(confirmed).toBe(false);
      ready = true;
      await vi.advanceTimersByTimeAsync(1);
      await handoff;
      expect(confirmed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an asynchronous spawn error before the app is allowed to quit', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
    child.unref = vi.fn().mockReturnValue(child);
    const failure = Object.assign(new Error('access denied'), { code: 'EACCES' });
    const terminateProcessTree = vi.fn();
    const handoff = spawnDetachedUpdateHelper(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-File', 'C:\\Temp\\handoff.ps1'],
      'C:\\Temp\\ready',
      { spawnProcess: () => child, terminateProcessTree },
    );
    child.emit('error', failure);
    await expect(handoff).rejects.toBe(failure);
    expect(terminateProcessTree).toHaveBeenCalledWith(child);
  });

  it('rejects a helper that exits before taking ownership', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
    child.unref = vi.fn().mockReturnValue(child);
    const terminateProcessTree = vi.fn();
    const handoff = spawnDetachedUpdateHelper(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-File', 'C:\\Temp\\handoff.ps1'],
      'C:\\Temp\\ready',
      { spawnProcess: () => child, terminateProcessTree },
    );
    child.emit('exit', 1, null);
    await expect(handoff).rejects.toThrow('exited before taking ownership');
    expect(terminateProcessTree).toHaveBeenCalledWith(child);
  });

  it('does not let the app quit without the helper ready handshake', async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
      child.unref = vi.fn().mockReturnValue(child);
      child.kill = vi.fn().mockReturnValue(true);
      const terminateProcessTree = vi.fn((target: ChildProcess) => target.kill());
      const handoff = spawnDetachedUpdateHelper(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-File', 'C:\\Temp\\handoff.ps1'],
        'C:\\Temp\\ready',
        {
          spawnProcess: () => child,
          terminateProcessTree,
          readyFileExists: () => false,
          readyTimeoutMs: 200,
          readyPollIntervalMs: 25,
        },
      );
      const rejected = expect(handoff).rejects.toThrow('did not become ready within 200ms');
      await vi.advanceTimersByTimeAsync(200);
      await rejected;
      expect(terminateProcessTree).toHaveBeenCalledWith(child);
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the exact update lifecycle paths to the detached helper', () => {
    const options = {
      parentProcessId: 4242,
      installerPath: 'C:\\Cache\\Update Setup.exe',
      installDirectory: 'C:\\Apps\\DeepSeek YukiRyou',
      executablePath: 'C:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe',
      logPath: 'C:\\Temp\\handoff.log',
      readyPath: 'C:\\Temp\\ready',
    } as const;
    const helperPath = 'C:\\Temp\\handoff.ps1';
    const args = windowsUpdateHandoffArguments(helperPath);
    expect(args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
    ]);
    const command = createWindowsUpdateHandoffCommand(options);
    expect(command).toContain('$ParentProcessId = 4242');
    expect(command).toContain("$InstallerPath = 'C:\\Cache\\Update Setup.exe'");
    expect(command).toContain("$InstallDirectory = 'C:\\Apps\\DeepSeek YukiRyou'");
    expect(command).toContain("$ExecutablePath = 'C:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe'");
    expect(command).toContain("$LogPath = 'C:\\Temp\\handoff.log'");
    expect(command).toContain("$ReadyPath = 'C:\\Temp\\ready'");
    const launcher = createWindowsUpdateLauncherScript({
      powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      powershellArguments: args,
      workingDirectory: 'C:\\Temp',
      logPath: options.logPath,
      readyPath: options.readyPath,
    });
    expect(launcher).toContain('detached: false');
    expect(launcher).toContain('cwd: options.workingDirectory');
    expect(launcher).toContain(JSON.stringify(helperPath));
    expect(launcher).toContain('PowerShell exited before ready');
  });

  it.runIf(process.platform === 'win32')(
    'receives a ready handshake from the real system PowerShell',
    async () => {
      const handoffDirectory = mkdtempSync(join(tmpdir(), 'dsh-helper-contract-'));
      const readyPath = join(handoffDirectory, 'ready');
      const logPath = join(handoffDirectory, 'handoff.log');
      const helperPath = join(handoffDirectory, 'handoff.ps1');
      const launcherPath = join(handoffDirectory, 'handoff.cjs');
      const helperNodePath = join(handoffDirectory, 'node.exe');
      let child: ChildProcess | undefined;
      try {
        const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
        const powershell = join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        );
        const handoffOptions = {
          parentProcessId: process.pid,
          installerPath: join(handoffDirectory, 'unused-installer.exe'),
          installDirectory: handoffDirectory,
          executablePath: join(handoffDirectory, 'unused-app.exe'),
          logPath,
          readyPath,
        } as const;
        writeFileSync(
          helperPath,
          `\uFEFF${createWindowsUpdateHandoffCommand(handoffOptions)}`,
          'utf8',
        );
        const powershellArguments = windowsUpdateHandoffArguments(helperPath);
        writeFileSync(launcherPath, createWindowsUpdateLauncherScript({
          powershellPath: powershell,
          powershellArguments,
          workingDirectory: handoffDirectory,
          logPath,
          readyPath,
        }), 'utf8');
        copyFileSync(process.execPath, helperNodePath);
        try {
          await spawnDetachedUpdateHelper(helperNodePath, [launcherPath], readyPath, {
            workingDirectory: handoffDirectory,
            spawnProcess: (command, commandArgs, workingDirectory) => {
              child = spawn(command, [...commandArgs], {
                cwd: workingDirectory,
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
              });
              return child;
            },
          });
        } catch (error) {
          await delay(100);
          const handoffLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '<missing>';
          throw new Error(
            [
              error instanceof Error ? error.message : String(error),
              `powershell=${powershell}`,
              `helperNode=${helperNodePath}`,
              `handoffLog=${handoffLog}`,
            ].join('\n'),
            { cause: error },
          );
        }
        expect(existsSync(readyPath)).toBe(true);
      } finally {
        if (child?.pid !== undefined) {
          await stopWindowsTestProcessTree(child.pid);
        }
        rmSync(handoffDirectory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
    20_000,
  );

  it.runIf(process.platform === 'win32')(
    'keeps the Node-to-PowerShell bridge alive after its parent exits',
    async () => {
      const handoffDirectory = mkdtempSync(join(tmpdir(), 'dsh-helper-survival-'));
      const readyPath = join(handoffDirectory, 'ready');
      const completedPath = join(handoffDirectory, 'post-parent');
      const parentPidPath = join(handoffDirectory, 'parent.pid');
      const helperPidPath = join(handoffDirectory, 'helper.pid');
      const logPath = join(handoffDirectory, 'handoff.log');
      const helperPath = join(handoffDirectory, 'handoff.ps1');
      const launcherPath = join(handoffDirectory, 'handoff.cjs');
      const driverPath = join(handoffDirectory, 'driver.cjs');
      const helperNodePath = join(handoffDirectory, 'node.exe');
      let helperPid: number | undefined;
      try {
        const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
        const powershell = join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        );
        writeFileSync(helperPath, `\uFEFF${[
          "$ErrorActionPreference = 'Stop'",
          `$driverPid = [int](Get-Content -LiteralPath ${testPowerShellLiteral(parentPidPath)})`,
          `Set-Content -LiteralPath ${testPowerShellLiteral(readyPath)} -Value 'ready'`,
          'while (Get-Process -Id $driverPid -ErrorAction SilentlyContinue) {',
          '  Start-Sleep -Milliseconds 50',
          '}',
          `Set-Content -LiteralPath ${testPowerShellLiteral(completedPath)} -Value 'survived'`,
        ].join('\n')}`, 'utf8');
        writeFileSync(launcherPath, createWindowsUpdateLauncherScript({
          powershellPath: powershell,
          powershellArguments: windowsUpdateHandoffArguments(helperPath),
          workingDirectory: handoffDirectory,
          logPath,
          readyPath,
        }), 'utf8');
        copyFileSync(process.execPath, helperNodePath);
        writeFileSync(driverPath, String.raw`'use strict';
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid), 'utf8');
const helper = spawn(${JSON.stringify(helperNodePath)}, [${JSON.stringify(launcherPath)}], {
  cwd: ${JSON.stringify(handoffDirectory)},
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
if (helper.pid === undefined) process.exit(1);
writeFileSync(${JSON.stringify(helperPidPath)}, String(helper.pid), 'utf8');
helper.unref();
`, 'utf8');

        const driver = spawnSync(process.execPath, [driverPath], {
          cwd: handoffDirectory,
          encoding: 'utf8',
          timeout: 10_000,
          windowsHide: true,
        });
        expect(driver.error).toBeUndefined();
        expect(driver.status).toBe(0);
        helperPid = Number(readFileSync(helperPidPath, 'utf8'));
        await expect.poll(() => existsSync(completedPath), {
          timeout: 10_000,
          interval: 50,
        }).toBe(true);
        expect(existsSync(readyPath)).toBe(true);
      } finally {
        if (Number.isInteger(helperPid) && helperPid !== undefined) {
          await stopWindowsTestProcessTree(helperPid);
        }
        rmSync(handoffDirectory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
    20_000,
  );

  it('waits for the old app, preserves install mode, installs, then relaunches', () => {
    const script = createWindowsUpdateHandoffScript();
    const signalReady = script.indexOf('Set-Content -LiteralPath $ReadyPath');
    const waitForOldApp = script.indexOf('Get-Process -Id $ParentProcessId');
    const waitForOldProcessTree = script.indexOf('Get-CimInstance Win32_Process');
    const startInstaller = script.indexOf('$installer = Start-Process -FilePath');
    const verifyInstaller = script.indexOf('if ($installerExitCode -ne 0)');
    const relaunchUpdatedApp = script.indexOf('Start-Process -FilePath $ExecutablePath');

    expect(signalReady).toBeGreaterThan(-1);
    expect(waitForOldApp).toBeGreaterThan(signalReady);
    expect(waitForOldProcessTree).toBeGreaterThan(waitForOldApp);
    expect(startInstaller).toBeGreaterThan(waitForOldProcessTree);
    expect(verifyInstaller).toBeGreaterThan(startInstaller);
    expect(relaunchUpdatedApp).toBeGreaterThan(verifyInstaller);
    expect(script).toContain("{ '/allusers' } else { '/currentuser' }");
    expect(script).toContain('-Wait -PassThru');
    expect(script).toContain('$installerWaiter.WaitForExit(600000)');
    expect(script).toContain("'System32\\taskkill.exe'");
    expect(script).toContain('event=installer-kill-exited');
    expect(script).toContain("@('--updated', '/S', $installModeArgument, \"/D=$InstallDirectory\")");
    expect(script).not.toContain('--force-run');
    expect(script).toContain('Get-CimInstance Win32_Process -ErrorAction Stop');
    expect(script).toContain('StartsWith(\n            $installDirectoryPrefix');
    expect(script).toContain('event=parent-exited');
    expect(script).toContain('event=application-exited');
    expect(script).toContain("-ArgumentList '--updated' -WorkingDirectory $InstallDirectory");
    expect(script).toContain('event=completed');
  });
});

function testPowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function stopWindowsTestProcessTree(pid: number): Promise<void> {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const taskkill = join(systemRoot, 'System32', 'taskkill.exe');
  const result = spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isTestProcessRunning(pid)) await delay(50);
  if (isTestProcessRunning(pid)) {
    throw new Error(
      `Windows helper process tree ${String(pid)} remained after taskkill ` +
      `(status=${String(result.status)})`,
    );
  }
  // Windows can briefly retain image/cwd handles after the process disappears.
  await delay(250);
}

function isTestProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code !== 'ESRCH';
  }
}
