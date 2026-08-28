import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import type { AllPublishOptions } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import type { InstallOptions } from 'electron-updater/out/BaseUpdater.js';

const INSTALLER_OWNERSHIP_DELAY_MS = 200;

type SpawnDetached = (command: string, args: readonly string[]) => ChildProcess;

/** Keep Electron alive long enough for an asynchronous spawn error to surface. */
export function spawnDetachedInstaller(
  command: string,
  args: readonly string[],
  spawnProcess: SpawnDetached = (executable, executableArgs) => spawn(
    executable,
    [...executableArgs],
    { detached: true, stdio: 'ignore', windowsHide: true },
  ),
  ownershipDelayMs = INSTALLER_OWNERSHIP_DELAY_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(command, args);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.once('error', fail);
    child.unref();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('error', fail);
      resolve();
    }, ownershipDelayMs);
  });
}

function installerArguments(
  installDirectory: string | undefined,
  options: Pick<InstallOptions, 'isSilent' | 'isForceRunAfter'>,
): string[] {
  const args = ['--updated'];
  if (options.isSilent) args.push('/S');
  if (options.isForceRunAfter) args.push('--force-run');
  if (installDirectory !== undefined) args.push(`/D=${installDirectory}`);
  return args;
}

/**
 * Explicit updates confirm that NSIS (or the elevation helper) owns the
 * lifecycle before AppCoordinator shuts Electron down.
 */
export class ReliableWindowsNsisUpdater extends NsisUpdater {
  constructor(options?: AllPublishOptions | null) {
    super(options);
  }

  async prepareInstall(isSilent = true, isForceRunAfter = true): Promise<void> {
    if (this.quitAndInstallCalled) {
      throw new Error('Windows update installation has already started');
    }
    const installerPath = this.installerPath;
    if (installerPath === null) {
      throw new Error("No update filepath provided, can't quit and install");
    }

    this.quitAndInstallCalled = true;
    const args = installerArguments(this.installDirectory, { isSilent, isForceRunAfter });
    this._logger.info(`Preparing Windows installer handoff: ${installerPath}`);
    try {
      await spawnDetachedInstaller(installerPath, args);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const code = 'code' in failure ? String(failure.code) : '';
      if (code !== 'UNKNOWN' && code !== 'EACCES') {
        this.quitAndInstallCalled = false;
        throw failure;
      }
      this._logger.info(`Direct installer launch failed (${code}); retrying with elevate.exe`);
      try {
        await spawnDetachedInstaller(
          join(process.resourcesPath, 'elevate.exe'),
          [installerPath, ...args],
        );
      } catch (elevationError) {
        this.quitAndInstallCalled = false;
        throw elevationError;
      }
    }
    this._logger.info('Windows installer handoff confirmed');
  }

  protected override doInstall(options: InstallOptions): boolean {
    this.dispatchError(new Error(
      `Synchronous Windows install is disabled; prepare the installer handoff first ` +
      `(silent=${String(options.isSilent)}, forceRun=${String(options.isForceRunAfter)})`,
    ));
    return false;
  }
}
