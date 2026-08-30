import { execFile, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  createWindowsInstallDirectoryProcessScript,
  stopWindowsProcessTree,
} from '../release/windows-process-scope.js';

const execute = promisify(execFile);

describe('Windows release process scope', () => {
  it('separates assignments from the process pipeline', () => {
    const listScript = createWindowsInstallDirectoryProcessScript(
      'C:\\Program Files\\DeepSeek YukiRyou',
      'list',
    );
    const stopScript = createWindowsInstallDirectoryProcessScript(
      'C:\\Program Files\\DeepSeek YukiRyou',
      'stop',
    );

    expect(listScript).toContain(".TrimEnd('\\'); $prefix=");
    expect(listScript).toContain('$processes = @(Get-CimInstance Win32_Process');
    expect(listScript).toContain('$scoped.ContainsKey($parentKey)');
    expect(listScript).toContain('$process.ProcessId');
    expect(stopScript).toContain(
      'Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue',
    );
  });

  it.runIf(process.platform === 'win32')(
    'parses and executes with Windows PowerShell',
    async () => {
      const script = createWindowsInstallDirectoryProcessScript(
        'C:\\dsh-path-that-does-not-exist',
        'list',
      );
      const result = await execute('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ]);
      expect(result.stdout.trim()).toBe('');
    },
    20_000,
  );

  it.runIf(process.platform === 'win32')(
    'stops an exact Windows process tree without masking a live target',
    async () => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Start-Process powershell.exe -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 30"); Start-Sleep -Seconds 30',
        ],
        { stdio: 'ignore' },
      );
      const processId = child.pid;
      if (processId === undefined) throw new Error('Windows process-tree fixture did not start');
      await delay(500);

      stopWindowsProcessTree(processId);

      await expect.poll(() => isRunning(processId), {
        timeout: 5_000,
        interval: 100,
      }).toBe(false);
    },
    20_000,
  );
});

function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
