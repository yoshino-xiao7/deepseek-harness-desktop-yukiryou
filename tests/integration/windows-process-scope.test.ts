import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createWindowsInstallDirectoryProcessScript } from '../release/windows-process-scope.js';

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
});
