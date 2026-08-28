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
    expect(listScript).toContain('; Get-CimInstance Win32_Process');
    expect(listScript).toContain('ForEach-Object { $_.ProcessId }');
    expect(stopScript).toContain(
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
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
