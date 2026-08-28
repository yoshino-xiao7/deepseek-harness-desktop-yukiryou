import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

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
    expect(windowsUpdateHandoffArguments({
      helperPath: 'C:\\Temp\\handoff.ps1',
      parentProcessId: 4242,
      installerPath: 'C:\\Cache\\Update Setup.exe',
      installDirectory: 'C:\\Apps\\DeepSeek YukiRyou',
      executablePath: 'C:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe',
      logPath: 'C:\\Temp\\handoff.log',
      readyPath: 'C:\\Temp\\ready',
    })).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\Temp\\handoff.ps1',
      '-ParentProcessId',
      '4242',
      '-InstallerPath',
      'C:\\Cache\\Update Setup.exe',
      '-InstallDirectory',
      'C:\\Apps\\DeepSeek YukiRyou',
      '-ExecutablePath',
      'C:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe',
      '-LogPath',
      'C:\\Temp\\handoff.log',
      '-ReadyPath',
      'C:\\Temp\\ready',
    ]);
  });

  it('waits for the old app, preserves install mode, installs, then relaunches', () => {
    const script = createWindowsUpdateHandoffScript();
    const signalReady = script.indexOf('Set-Content -LiteralPath $ReadyPath');
    const waitForOldApp = script.indexOf('Get-Process -Id $ParentProcessId');
    const startInstaller = script.indexOf('Start-Process -FilePath $InstallerPath');
    const verifyInstaller = script.indexOf('if ($installerProcess.ExitCode -ne 0)');
    const relaunchUpdatedApp = script.indexOf('Start-Process -FilePath $ExecutablePath');

    expect(signalReady).toBeGreaterThan(-1);
    expect(waitForOldApp).toBeGreaterThan(signalReady);
    expect(startInstaller).toBeGreaterThan(waitForOldApp);
    expect(verifyInstaller).toBeGreaterThan(startInstaller);
    expect(relaunchUpdatedApp).toBeGreaterThan(verifyInstaller);
    expect(script).toContain("{ '/allusers' } else { '/currentuser' }");
    expect(script).toContain('-Wait -PassThru');
    expect(script).toContain("@('--updated', '/S', $installModeArgument, \"/D=$InstallDirectory\")");
    expect(script).not.toContain('--force-run');
    expect(script).toContain('event=parent-exited');
    expect(script).toContain('event=completed');
  });
});
