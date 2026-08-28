import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { AllPublishOptions } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import type { InstallOptions } from 'electron-updater/out/BaseUpdater.js';

export interface WindowsUpdateHandoffArgumentsOptions {
  readonly helperPath: string;
  readonly parentProcessId: number;
  readonly installerPath: string;
  readonly installDirectory: string;
  readonly executablePath: string;
  readonly logPath: string;
}

export function windowsUpdateHandoffArguments(
  options: WindowsUpdateHandoffArgumentsOptions,
): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    options.helperPath,
    '-ParentProcessId',
    String(options.parentProcessId),
    '-InstallerPath',
    options.installerPath,
    '-InstallDirectory',
    options.installDirectory,
    '-ExecutablePath',
    options.executablePath,
    '-LogPath',
    options.logPath,
  ];
}

export function createWindowsUpdateHandoffScript(): string {
  return String.raw`param(
  [Parameter(Mandatory = $true)][int]$ParentProcessId,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'

function Write-HandoffLog([string]$Message) {
  $timestamp = [DateTime]::UtcNow.ToString('o')
  Add-Content -LiteralPath $LogPath -Value "$timestamp $Message" -Encoding utf8
}

try {
  Write-HandoffLog "waiting parent=$ParentProcessId installer=$InstallerPath target=$InstallDirectory"
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Old application process $ParentProcessId did not exit within 90 seconds"
    }
    Start-Sleep -Milliseconds 200
  }

  $normalizedInstallDirectory = $InstallDirectory.TrimEnd('\\')
  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $registeredInstall = Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InstallLocation -and
      $_.InstallLocation.TrimEnd('\\').Equals(
        $normalizedInstallDirectory,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } |
    Select-Object -First 1
  $installModeArgument = if (
    $registeredInstall -and
    $registeredInstall.PSPath.StartsWith('Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE', [System.StringComparison]::OrdinalIgnoreCase)
  ) { '/allusers' } else { '/currentuser' }

  $installerArguments = @('--updated', '/S', $installModeArgument, "/D=$InstallDirectory")
  Write-HandoffLog "starting installer arguments=$($installerArguments -join ' ')"
  & $InstallerPath @installerArguments
  $installerExitCode = $LASTEXITCODE
  Write-HandoffLog "installer exited code=$installerExitCode"
  if ($installerExitCode -ne 0) {
    throw "Update installer failed with exit code $installerExitCode"
  }
  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
    throw "Updated executable is missing: $ExecutablePath"
  }

  Write-HandoffLog "relaunching executable=$ExecutablePath"
  Start-Process -FilePath $ExecutablePath -ArgumentList '--updated'
  Write-HandoffLog 'handoff completed'
  exit 0
} catch {
  Write-HandoffLog "handoff failed: $($_.Exception.Message)"
  exit 1
}
`;
}

/**
 * electron-updater 6.x detaches NSIS from the Electron process and immediately
 * quits. On assisted Windows installations that handoff can be lost while the
 * old process still owns application files. A system PowerShell helper owns the
 * terminal lifecycle instead: wait for the exact parent PID, install into the
 * exact per-user directory, check NSIS' exit code, then relaunch that executable.
 */
export class ReliableWindowsNsisUpdater extends NsisUpdater {
  constructor(options?: AllPublishOptions | null) {
    super(options);
  }

  protected override doInstall(options: InstallOptions): boolean {
    const installerPath = this.installerPath;
    if (installerPath === null) {
      this.dispatchError(new Error("No update filepath provided, can't quit and install"));
      return false;
    }

    try {
      this._logger.info(
        `Starting reliable Windows update handoff (adminRequired=${String(options.isAdminRightsRequired)})`,
      );
      const executablePath = process.execPath;
      const installDirectory = this.installDirectory ?? dirname(executablePath);
      const handoffDirectory = mkdtempSync(join(tmpdir(), 'dsh-yukiryou-update-'));
      const helperPath = join(handoffDirectory, 'handoff.ps1');
      const logPath = join(handoffDirectory, 'handoff.log');
      writeFileSync(helperPath, createWindowsUpdateHandoffScript(), {
        encoding: 'utf8',
        flag: 'wx',
      });

      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
      const powershell = join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const child = spawn(powershell, windowsUpdateHandoffArguments({
        helperPath,
        parentProcessId: process.pid,
        installerPath,
        installDirectory,
        executablePath,
        logPath,
      }), {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', (error) => this.dispatchError(error));
      child.unref();
      if (child.pid === undefined) {
        throw new Error('Windows update handoff helper did not start');
      }
      return true;
    } catch (error) {
      this.dispatchError(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
}
