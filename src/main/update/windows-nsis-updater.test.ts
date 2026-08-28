import { describe, expect, it } from 'vitest';

import {
  createWindowsUpdateHandoffScript,
  windowsUpdateHandoffArguments,
} from './windows-nsis-updater.js';

describe('reliable Windows NSIS update handoff', () => {
  it('waits for the old process, preserves the per-user install directory, and relaunches only after success', () => {
    const script = createWindowsUpdateHandoffScript();

    expect(script).toContain('Get-Process -Id $ParentProcessId');
    expect(script).toContain("{ '/allusers' } else { '/currentuser' }");
    expect(script).toContain("@('--updated', '/S', $installModeArgument, \"/D=$InstallDirectory\")");
    expect(script).toContain('& $InstallerPath @installerArguments');
    expect(script).toContain('if ($installerExitCode -ne 0)');
    expect(script.indexOf('Get-Process -Id $ParentProcessId'))
      .toBeLessThan(script.indexOf('& $InstallerPath @installerArguments'));
    expect(script.indexOf('if ($installerExitCode -ne 0)'))
      .toBeLessThan(script.indexOf('Start-Process -FilePath $ExecutablePath'));

    expect(windowsUpdateHandoffArguments({
      helperPath: 'C:\\Temp\\handoff.ps1',
      parentProcessId: 42,
      installerPath: 'C:\\Cache\\Update Setup.exe',
      installDirectory: 'D:\\Apps\\DeepSeek YukiRyou',
      executablePath: 'D:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe',
      logPath: 'C:\\Temp\\handoff.log',
    })).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\Temp\\handoff.ps1',
      '-ParentProcessId',
      '42',
      '-InstallerPath',
      'C:\\Cache\\Update Setup.exe',
      '-InstallDirectory',
      'D:\\Apps\\DeepSeek YukiRyou',
      '-ExecutablePath',
      'D:\\Apps\\DeepSeek YukiRyou\\DeepSeek YukiRyou.exe',
      '-LogPath',
      'C:\\Temp\\handoff.log',
    ]);
  });
});
