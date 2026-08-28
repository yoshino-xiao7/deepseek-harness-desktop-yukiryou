import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  createWindowsUpdateHandoffScript,
  spawnDetachedUpdateHelper,
  windowsUpdateHandoffArguments,
} from './windows-nsis-updater.js';

describe('reliable Windows NSIS update handoff', () => {
  it('keeps the parent alive through the helper ownership window', async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
      child.unref = vi.fn().mockReturnValue(child);
      let ready = false;
      let confirmed = false;
      const handoff = spawnDetachedUpdateHelper(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-File', 'C:\\Temp\\handoff.ps1'],
        'C:\\Temp\\ready',
        {
          spawnProcess: vi.fn().mockReturnValue(child),
          readyFileExists: () => ready,
          readyTimeoutMs: 200,
          readyPollIntervalMs: 25,
        },
      ).then(() => { confirmed = true; });

      expect(child.unref).toHaveBeenCalledOnce();
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
    const handoff = spawnDetachedUpdateHelper(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-File', 'C:\\Temp\\handoff.ps1'],
      'C:\\Temp\\ready',
      { spawnProcess: () => child },
    );
    child.emit('error', failure);
    await expect(handoff).rejects.toBe(failure);
  });

  it('rejects a helper that exits before taking ownership', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
    child.unref = vi.fn().mockReturnValue(child);
    const handoff = spawnDetachedUpdateHelper(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-File', 'C:\\Temp\\handoff.ps1'],
      'C:\\Temp\\ready',
      { spawnProcess: () => child },
    );
    child.emit('exit', 1, null);
    await expect(handoff).rejects.toThrow('exited before taking ownership');
  });

  it('does not let the app quit without the helper ready handshake', async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 4321 }) as ChildProcess;
      child.unref = vi.fn().mockReturnValue(child);
      child.kill = vi.fn().mockReturnValue(true);
      const handoff = spawnDetachedUpdateHelper(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-File', 'C:\\Temp\\handoff.ps1'],
        'C:\\Temp\\ready',
        {
          spawnProcess: () => child,
          readyFileExists: () => false,
          readyTimeoutMs: 200,
          readyPollIntervalMs: 25,
        },
      );
      const rejected = expect(handoff).rejects.toThrow('did not become ready within 200ms');
      await vi.advanceTimersByTimeAsync(200);
      await rejected;
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the exact update lifecycle paths to the detached helper', () => {
    const args = windowsUpdateHandoffArguments({
      parentProcessId: 4242,
      installerPath: 'C:\\Cache\\Update Setup.exe',
      installDirectory: 'C:\\Apps\\DeepSeek YukiRyou',
      executablePath: 'C:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe',
      logPath: 'C:\\Temp\\handoff.log',
      readyPath: 'C:\\Temp\\ready',
    });
    expect(args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ]);
    const encodedCommand = args[5];
    expect(encodedCommand).toBeDefined();
    const command = Buffer.from(encodedCommand ?? '', 'base64').toString('utf16le');
    expect(command).toContain('$ParentProcessId = 4242');
    expect(command).toContain("$InstallerPath = 'C:\\Cache\\Update Setup.exe'");
    expect(command).toContain("$InstallDirectory = 'C:\\Apps\\DeepSeek YukiRyou'");
    expect(command).toContain("$ExecutablePath = 'C:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe'");
    expect(command).toContain("$LogPath = 'C:\\Temp\\handoff.log'");
    expect(command).toContain("$ReadyPath = 'C:\\Temp\\ready'");
    expect(encodedCommand?.length).toBeLessThan(30_000);
  });

  it.runIf(process.platform === 'win32')(
    'receives a ready handshake from the real system PowerShell',
    async () => {
      const handoffDirectory = mkdtempSync(join(tmpdir(), 'dsh-helper-contract-'));
      const readyPath = join(handoffDirectory, 'ready');
      const logPath = join(handoffDirectory, 'handoff.log');
      let child: ChildProcess | undefined;
      let stdout = '';
      let stderr = '';
      try {
        const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
        const powershell = join(
          systemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        );
        const args = windowsUpdateHandoffArguments({
          parentProcessId: process.pid,
          installerPath: join(handoffDirectory, 'unused-installer.exe'),
          installDirectory: handoffDirectory,
          executablePath: join(handoffDirectory, 'unused-app.exe'),
          logPath,
          readyPath,
        });
        try {
          await spawnDetachedUpdateHelper(powershell, args, readyPath, {
            spawnProcess: (command, commandArgs) => {
              child = spawn(command, [...commandArgs], {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
              });
              child.stdout?.on('data', (chunk: Buffer | string) => {
                stdout += chunk.toString();
              });
              child.stderr?.on('data', (chunk: Buffer | string) => {
                stderr += chunk.toString();
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
              `encodedCommandLength=${String(args[5]?.length ?? 0)}`,
              `stdout=${stdout || '<empty>'}`,
              `stderr=${stderr || '<empty>'}`,
              `handoffLog=${handoffLog}`,
            ].join('\n'),
            { cause: error },
          );
        }
        expect(existsSync(readyPath)).toBe(true);
      } finally {
        child?.kill();
        rmSync(handoffDirectory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 50,
        });
      }
    },
  );

  it('waits for the old app, preserves install mode, installs, then relaunches', () => {
    const script = createWindowsUpdateHandoffScript();
    const signalReady = script.indexOf('Set-Content -LiteralPath $ReadyPath');
    const waitForOldApp = script.indexOf('Get-Process -Id $ParentProcessId');
    const waitForOldProcessTree = script.indexOf('Get-CimInstance Win32_Process');
    const startInstaller = script.indexOf('Start-Process -FilePath $InstallerPath');
    const verifyInstaller = script.indexOf('if ($installerProcess.ExitCode -ne 0)');
    const relaunchUpdatedApp = script.indexOf('Start-Process -FilePath $ExecutablePath');

    expect(signalReady).toBeGreaterThan(-1);
    expect(waitForOldApp).toBeGreaterThan(signalReady);
    expect(waitForOldProcessTree).toBeGreaterThan(waitForOldApp);
    expect(startInstaller).toBeGreaterThan(waitForOldProcessTree);
    expect(verifyInstaller).toBeGreaterThan(startInstaller);
    expect(relaunchUpdatedApp).toBeGreaterThan(verifyInstaller);
    expect(script).toContain("{ '/allusers' } else { '/currentuser' }");
    expect(script).toContain('-Wait -PassThru');
    expect(script).toContain("@('--updated', '/S', $installModeArgument, \"/D=$InstallDirectory\")");
    expect(script).not.toContain('--force-run');
    expect(script).toContain('Get-CimInstance Win32_Process -ErrorAction Stop');
    expect(script).toContain('StartsWith(\n            $installDirectoryPrefix');
    expect(script).toContain('event=parent-exited');
    expect(script).toContain('event=application-exited');
    expect(script).toContain('event=completed');
  });
});
