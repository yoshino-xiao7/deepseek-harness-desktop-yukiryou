import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { AllPublishOptions } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import type { InstallOptions } from 'electron-updater/out/BaseUpdater.js';

const HELPER_READY_TIMEOUT_MS = 10_000;
const HELPER_READY_POLL_INTERVAL_MS = 25;

type SpawnDetached = (command: string, args: readonly string[]) => ChildProcess;

export interface WindowsUpdateHandoffArgumentsOptions {
  readonly helperPath: string;
  readonly parentProcessId: number;
  readonly installerPath: string;
  readonly installDirectory: string;
  readonly executablePath: string;
  readonly logPath: string;
  readonly readyPath: string;
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
    '-ReadyPath',
    options.readyPath,
  ];
}

export function createWindowsUpdateHandoffScript(): string {
  return String.raw`param(
  [Parameter(Mandatory = $true)][int]$ParentProcessId,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string]$ReadyPath
)

$ErrorActionPreference = 'Stop'

function Write-HandoffLog([string]$Message) {
  $timestamp = [DateTime]::UtcNow.ToString('o')
  Add-Content -LiteralPath $LogPath -Value "$timestamp $Message" -Encoding utf8
}

try {
  Write-HandoffLog "event=armed parent=$ParentProcessId installer=$InstallerPath target=$InstallDirectory"
  Set-Content -LiteralPath $ReadyPath -Value "helper=$PID parent=$ParentProcessId" -Encoding ascii
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Old application process $ParentProcessId did not exit within 90 seconds"
    }
    Start-Sleep -Milliseconds 200
  }
  Write-HandoffLog "event=parent-exited parent=$ParentProcessId"

  $normalizedInstallDirectory = $InstallDirectory.TrimEnd('\')
  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $registeredInstall = Get-ItemProperty -Path $uninstallRoots -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InstallLocation -and
      $_.InstallLocation.TrimEnd('\').Equals(
        $normalizedInstallDirectory,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } |
    Select-Object -First 1
  $installModeArgument = if (
    $registeredInstall -and
    $registeredInstall.PSPath.StartsWith('Microsoft.PowerShell.Core\Registry::HKEY_LOCAL_MACHINE', [System.StringComparison]::OrdinalIgnoreCase)
  ) { '/allusers' } else { '/currentuser' }

  $installerArguments = @('--updated', '/S', $installModeArgument, "/D=$InstallDirectory")
  Write-HandoffLog "event=installer-started arguments=$($installerArguments -join ' ')"
  $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList $installerArguments -Wait -PassThru
  Write-HandoffLog "event=installer-exited code=$($installerProcess.ExitCode)"
  if ($installerProcess.ExitCode -ne 0) {
    throw "Update installer failed with exit code $($installerProcess.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
    throw "Updated executable is missing: $ExecutablePath"
  }

  Write-HandoffLog "event=relaunch-started executable=$ExecutablePath"
  Start-Process -FilePath $ExecutablePath -ArgumentList '--updated'
  Write-HandoffLog 'event=completed'
  exit 0
} catch {
  Write-HandoffLog "event=failed error=$($_.Exception.Message)"
  exit 1
}
`;
}

export interface SpawnDetachedUpdateHelperOptions {
  readonly spawnProcess?: SpawnDetached;
  readonly readyFileExists?: (path: string) => boolean;
  readonly readyTimeoutMs?: number;
  readonly readyPollIntervalMs?: number;
}

/** Keep Electron alive until the helper confirms that its script is armed. */
export function spawnDetachedUpdateHelper(
  command: string,
  args: readonly string[],
  readyPath: string,
  options: SpawnDetachedUpdateHelperOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnProcess = options.spawnProcess ?? ((executable, executableArgs) => spawn(
      executable,
      [...executableArgs],
      { detached: true, stdio: 'ignore', windowsHide: true },
    ));
    const readyFileExists = options.readyFileExists ?? existsSync;
    let child: ChildProcess;
    try {
      child = spawnProcess(command, args);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const readinessChecks: {
      timeout?: ReturnType<typeof setTimeout>;
      poll?: ReturnType<typeof setInterval>;
    } = {};
    const clearReadinessChecks = (): void => {
      if (readinessChecks.timeout !== undefined) clearTimeout(readinessChecks.timeout);
      if (readinessChecks.poll !== undefined) clearInterval(readinessChecks.poll);
      child.removeListener('error', fail);
      child.removeListener('exit', failOnEarlyExit);
    };
    const confirmReady = (): void => {
      if (settled) return;
      try {
        if (!readyFileExists(readyPath)) return;
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      settled = true;
      clearReadinessChecks();
      resolve();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearReadinessChecks();
      try {
        child.kill();
      } catch {
        // The helper may already have exited while reporting its failure.
      }
      reject(error);
    };
    const failOnEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      fail(new Error(
        `Windows update helper exited before taking ownership ` +
        `(code=${String(code)}, signal=${String(signal)})`,
      ));
    };
    child.once('error', fail);
    child.once('exit', failOnEarlyExit);
    child.unref();
    if (child.pid === undefined) {
      fail(new Error('Windows update handoff helper did not start'));
      return;
    }
    readinessChecks.poll = setInterval(
      confirmReady,
      options.readyPollIntervalMs ?? HELPER_READY_POLL_INTERVAL_MS,
    );
    readinessChecks.timeout = setTimeout(() => {
      confirmReady();
      if (!settled) {
        fail(new Error(
          `Windows update helper did not become ready within ` +
          `${String(options.readyTimeoutMs ?? HELPER_READY_TIMEOUT_MS)}ms`,
        ));
      }
    }, options.readyTimeoutMs ?? HELPER_READY_TIMEOUT_MS);
    confirmReady();
  });
}

/**
 * The assisted NSIS installer cannot replace application files reliably while
 * Electron still owns them. A detached system PowerShell helper owns the
 * terminal lifecycle instead: wait for this exact process to exit, preserve
 * the installed per-user/per-machine mode, wait for NSIS, then relaunch the
 * exact installed executable.
 */
export class ReliableWindowsNsisUpdater extends NsisUpdater {
  constructor(options?: AllPublishOptions | null) {
    super(options);
  }

  async prepareInstall(isSilent = true, isForceRunAfter = true): Promise<void> {
    if (this.quitAndInstallCalled) {
      throw new Error('Windows update installation has already started');
    }
    if (!isSilent || !isForceRunAfter) {
      throw new Error('Reliable Windows update handoff requires silent install and relaunch');
    }
    const installerPath = this.installerPath;
    if (installerPath === null) {
      throw new Error("No update filepath provided, can't quit and install");
    }

    const executablePath = process.execPath;
    const installDirectory = this.installDirectory ?? dirname(executablePath);
    const handoffDirectory = mkdtempSync(join(tmpdir(), 'dsh-yukiryou-update-'));
    const helperPath = join(handoffDirectory, 'handoff.ps1');
    const logPath = join(handoffDirectory, 'handoff.log');
    const readyPath = join(handoffDirectory, 'ready');
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
    const args = windowsUpdateHandoffArguments({
      helperPath,
      parentProcessId: process.pid,
      installerPath,
      installDirectory,
      executablePath,
      logPath,
      readyPath,
    });

    this.quitAndInstallCalled = true;
    this._logger.info(`Preparing reliable Windows update helper: ${helperPath}`);
    try {
      await spawnDetachedUpdateHelper(powershell, args, readyPath);
    } catch (error) {
      this.quitAndInstallCalled = false;
      throw error;
    }
    this._logger.info('Windows update helper handoff confirmed');
  }

  protected override doInstall(options: InstallOptions): boolean {
    this.dispatchError(new Error(
      `Synchronous Windows install is disabled; prepare the installer helper first ` +
      `(silent=${String(options.isSilent)}, forceRun=${String(options.isForceRunAfter)})`,
    ));
    return false;
  }
}
