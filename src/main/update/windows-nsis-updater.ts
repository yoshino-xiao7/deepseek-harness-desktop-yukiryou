import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  type Dirent,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { AllPublishOptions } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import type { InstallOptions } from 'electron-updater/out/BaseUpdater.js';

const HELPER_READY_TIMEOUT_MS = 10_000;
const HELPER_READY_POLL_INTERVAL_MS = 25;
const TERMINAL_HANDOFF_CLEANUP_AGE_MS = 5 * 60_000;
const ABANDONED_HANDOFF_CLEANUP_AGE_MS = 24 * 60 * 60_000;

type SpawnDetached = (
  command: string,
  args: readonly string[],
  workingDirectory?: string,
) => ChildProcess;
type TerminateProcessTree = (child: ChildProcess) => void;

export interface WindowsUpdateHandoffArgumentsOptions {
  readonly parentProcessId: number;
  readonly installerPath: string;
  readonly installDirectory: string;
  readonly executablePath: string;
  readonly logPath: string;
  readonly readyPath: string;
}

export function windowsUpdateHandoffArguments(
  helperPath: string,
): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    helperPath,
  ];
}

export function createWindowsUpdateHandoffCommand(
  options: WindowsUpdateHandoffArgumentsOptions,
): string {
  return [
    `$ParentProcessId = ${String(options.parentProcessId)}`,
    `$InstallerPath = ${powerShellSingleQuotedLiteral(options.installerPath)}`,
    `$InstallDirectory = ${powerShellSingleQuotedLiteral(options.installDirectory)}`,
    `$ExecutablePath = ${powerShellSingleQuotedLiteral(options.executablePath)}`,
    `$LogPath = ${powerShellSingleQuotedLiteral(options.logPath)}`,
    `$ReadyPath = ${powerShellSingleQuotedLiteral(options.readyPath)}`,
    createWindowsUpdateHandoffScript(),
  ].join('\n');
}

export function createWindowsUpdateHandoffScript(): string {
  return String.raw`
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
  $installDirectoryPrefix = "$normalizedInstallDirectory\"
  while ($true) {
    $remainingInstallProcesses = @(
      Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object {
          $_.ExecutablePath -and
          $_.ExecutablePath.StartsWith(
            $installDirectoryPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
          )
        }
    )
    if ($remainingInstallProcesses.Count -eq 0) {
      break
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      $remainingProcessIds = ($remainingInstallProcesses.ProcessId -join ',')
      throw "Old installation processes did not exit within 90 seconds: $remainingProcessIds"
    }
    Start-Sleep -Milliseconds 200
  }
  Write-HandoffLog "event=application-exited installDirectory=$normalizedInstallDirectory"

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
  $env:DSH_YUKIRYOU_UPDATE_INSTALLER = $InstallerPath
  $env:DSH_YUKIRYOU_UPDATE_DIRECTORY = $InstallDirectory
  $env:DSH_YUKIRYOU_UPDATE_MODE = $installModeArgument
  $installerWaitCommand = @'
$ErrorActionPreference = 'Stop'
try {
  $arguments = @(
    '--updated', '/S', $env:DSH_YUKIRYOU_UPDATE_MODE,
    "/D=$env:DSH_YUKIRYOU_UPDATE_DIRECTORY"
  )
  $installer = Start-Process -FilePath $env:DSH_YUKIRYOU_UPDATE_INSTALLER -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $env:DSH_YUKIRYOU_UPDATE_INSTALLER) -Wait -PassThru
  exit $installer.ExitCode
} catch {
  exit 255
}
'@
  $encodedInstallerWaitCommand = [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($installerWaitCommand)
  )
  $installerWaiterArguments = @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', $encodedInstallerWaitCommand
    )
  $installerWaiter = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $installerWaiterArguments -WorkingDirectory (Split-Path -Parent $InstallerPath) -WindowStyle Hidden -PassThru
  if (-not $installerWaiter.WaitForExit(600000)) {
    Write-HandoffLog "event=installer-timeout waiter=$($installerWaiter.Id)"
    $taskkillPath = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $taskkillProcess = Start-Process -FilePath $taskkillPath -ArgumentList @(
      '/PID', "$($installerWaiter.Id)", '/T', '/F'
    ) -WindowStyle Hidden -Wait -PassThru
    Write-HandoffLog "event=installer-kill-exited code=$($taskkillProcess.ExitCode)"
    if ($taskkillProcess.ExitCode -ne 0) {
      throw "Update installer timed out and its process tree could not be terminated (taskkill=$($taskkillProcess.ExitCode))"
    }
    throw "Update installer did not exit within 600 seconds"
  }
  $installerWaiter.Refresh()
  $installerExitCode = $installerWaiter.ExitCode
  Write-HandoffLog "event=installer-exited code=$installerExitCode"
  if ($installerExitCode -ne 0) {
    throw "Update installer failed with exit code $installerExitCode"
  }
  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
    throw "Updated executable is missing: $ExecutablePath"
  }

  Write-HandoffLog "event=relaunch-started executable=$ExecutablePath"
  Start-Process -FilePath $ExecutablePath -ArgumentList '--updated' -WorkingDirectory $InstallDirectory
  Write-HandoffLog 'event=completed'
  exit 0
} catch {
  Write-HandoffLog "event=failed error=$($_.Exception.Message)"
  exit 1
}
`;
}

function powerShellSingleQuotedLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface WindowsUpdateLauncherScriptOptions {
  readonly powershellPath: string;
  readonly powershellArguments: readonly string[];
  readonly workingDirectory: string;
  readonly logPath: string;
  readonly readyPath: string;
}

/**
 * A copied bundled Node executable is the detached process. It hosts
 * PowerShell without `detached: true`, which avoids the Windows Node/PowerShell
 * launch failure where PowerShell exits 0 without executing its script.
 */
export function createWindowsUpdateLauncherScript(
  options: WindowsUpdateLauncherScriptOptions,
): string {
  const serializedOptions = JSON.stringify(options);
  return String.raw`'use strict';

const { spawn } = require('node:child_process');
const { appendFileSync, existsSync } = require('node:fs');

const options = ${serializedOptions};

function writeFailure(message) {
  const timestamp = new Date().toISOString();
  appendFileSync(options.logPath, timestamp + ' event=launcher-failed error=' + message + '\n', 'utf8');
}

let helper;
try {
  helper = spawn(options.powershellPath, options.powershellArguments, {
    cwd: options.workingDirectory,
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });
} catch (error) {
  writeFailure(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

helper.once('error', (error) => {
  writeFailure(error.message);
  process.exit(1);
});
helper.once('exit', (code, signal) => {
  const ready = existsSync(options.readyPath);
  if (!ready) {
    writeFailure('PowerShell exited before ready (code=' + String(code) + ', signal=' + String(signal) + ')');
  }
  process.exit(ready && code === 0 ? 0 : (typeof code === 'number' && code !== 0 ? code : 1));
});
`;
}

export interface SpawnDetachedUpdateHelperOptions {
  readonly spawnProcess?: SpawnDetached;
  readonly terminateProcessTree?: TerminateProcessTree;
  readonly workingDirectory?: string;
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
    const spawnProcess = options.spawnProcess ?? ((
      executable,
      executableArgs,
      workingDirectory,
    ) => spawn(
      executable,
      [...executableArgs],
      {
        cwd: workingDirectory,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    ));
    const terminateProcessTree = options.terminateProcessTree ?? terminateWindowsProcessTree;
    const readyFileExists = options.readyFileExists ?? existsSync;
    let child: ChildProcess;
    try {
      child = spawnProcess(command, args, options.workingDirectory);
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
        terminateProcessTree(child);
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

function terminateWindowsProcessTree(child: ChildProcess): void {
  if (process.platform !== 'win32' || child.pid === undefined) {
    child.kill();
    return;
  }
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const taskkill = join(systemRoot, 'System32', 'taskkill.exe');
  const result = spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    child.kill();
  }
}

/** Best-effort removal of copied helper runtimes after they can no longer be active. */
export function cleanupStaleWindowsUpdateHandoffs(
  temporaryRoot = tmpdir(),
  now = Date.now(),
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(temporaryRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-yukiryou-update-')) continue;
    const directory = join(temporaryRoot, entry.name);
    const logPath = join(directory, 'handoff.log');
    const readyPath = join(directory, 'ready');
    try {
      const activityTimes = [statSync(directory).mtimeMs];
      if (existsSync(logPath)) activityTimes.push(statSync(logPath).mtimeMs);
      if (existsSync(readyPath)) activityTimes.push(statSync(readyPath).mtimeMs);
      const age = now - Math.max(...activityTimes);
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      const reachedTerminalState = [
        'event=completed',
        'event=failed',
        'event=launcher-failed',
      ].some((event) => log.includes(event));
      if (
        (reachedTerminalState && age >= TERMINAL_HANDOFF_CLEANUP_AGE_MS) ||
        age >= ABANDONED_HANDOFF_CLEANUP_AGE_MS
      ) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
    } catch {
      // A still-running helper can keep node.exe locked. Leave it for a later startup.
    }
  }
}

/**
 * The assisted NSIS installer cannot replace application files reliably while
 * Electron still owns them. A copied Node bridge outside the installation is
 * detached safely, then hosts system PowerShell without detaching it. The
 * helper waits for this exact process and every executable under the install
 * root to exit, preserves the install mode, waits for NSIS, and relaunches the
 * exact installed executable.
 */
export class ReliableWindowsNsisUpdater extends NsisUpdater {
  constructor(options?: AllPublishOptions | null) {
    super(options);
    if (process.platform === 'win32') cleanupStaleWindowsUpdateHandoffs();
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
    const launcherPath = join(handoffDirectory, 'handoff.cjs');
    const helperNodePath = join(handoffDirectory, 'node.exe');
    const logPath = join(handoffDirectory, 'handoff.log');
    const readyPath = join(handoffDirectory, 'ready');
    const handoffOptions: WindowsUpdateHandoffArgumentsOptions = {
      parentProcessId: process.pid,
      installerPath,
      installDirectory,
      executablePath,
      logPath,
      readyPath,
    };
    // Windows PowerShell 5.1 only detects UTF-8 reliably when a BOM is present.
    writeFileSync(helperPath, `\uFEFF${createWindowsUpdateHandoffCommand(handoffOptions)}`, {
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
    const powershellArguments = windowsUpdateHandoffArguments(helperPath);
    const runtimeNodePath = join(process.resourcesPath, 'runtime', 'node', 'node.exe');
    if (!existsSync(runtimeNodePath)) {
      throw new Error(`Bundled Windows update helper runtime is missing: ${runtimeNodePath}`);
    }
    await copyFile(runtimeNodePath, helperNodePath);
    writeFileSync(launcherPath, createWindowsUpdateLauncherScript({
      powershellPath: powershell,
      powershellArguments,
      workingDirectory: handoffDirectory,
      logPath,
      readyPath,
    }), {
      encoding: 'utf8',
      flag: 'wx',
    });

    this.quitAndInstallCalled = true;
    this._logger.info(`Preparing reliable Windows update helper: ${launcherPath}`);
    try {
      await spawnDetachedUpdateHelper(helperNodePath, [launcherPath], readyPath, {
        workingDirectory: handoffDirectory,
      });
    } catch (error) {
      this.quitAndInstallCalled = false;
      try {
        rmSync(helperNodePath, { force: true });
      } catch {
        // The process-tree abort may still be releasing the copied executable.
      }
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
