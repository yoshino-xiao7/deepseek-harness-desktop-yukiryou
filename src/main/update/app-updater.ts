import { autoUpdater, type Event } from 'electron';

import { updateFeedUrl } from './update-config.js';

export type UpdateCheckResult =
  | { readonly status: 'disabled' | 'busy' | 'not-available' }
  | { readonly status: 'available' };

export interface AppUpdater {
  checkForUpdates(): Promise<UpdateCheckResult>;
  quitAndInstall(): void;
  dispose(): void;
}

export interface AppUpdaterOptions {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly onDownloaded: (releaseName: string, releaseNotes: string) => void;
  readonly onError: (error: Error) => void;
}

export function createAppUpdater(options: AppUpdaterOptions): AppUpdater {
  return new ElectronAppUpdater(options);
}

class ElectronAppUpdater implements AppUpdater {
  readonly #options: AppUpdaterOptions;
  #checking = false;

  readonly #handleDownloaded = (
    _event: Event,
    releaseNotes: string,
    releaseName: string,
  ): void => {
    this.#options.onDownloaded(releaseName, releaseNotes);
  };

  readonly #handleBackgroundError = (error: Error): void => {
    if (!this.#checking) {
      this.#options.onError(error);
    }
  };

  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    if (!options.enabled) {
      return;
    }
    autoUpdater.setFeedURL({
      url: updateFeedUrl({
        currentVersion: options.currentVersion,
        platform: options.platform,
        architecture: options.architecture,
      }),
    });
    autoUpdater.on('update-downloaded', this.#handleDownloaded);
    autoUpdater.on('error', this.#handleBackgroundError);
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (!this.#options.enabled) {
      return { status: 'disabled' };
    }
    if (this.#checking) {
      return { status: 'busy' };
    }
    this.#checking = true;
    return new Promise<UpdateCheckResult>((resolve, reject) => {
      const finish = (result: UpdateCheckResult): void => {
        cleanup();
        this.#checking = false;
        resolve(result);
      };
      const fail = (error: Error): void => {
        cleanup();
        this.#checking = false;
        reject(error);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        autoUpdater.removeListener('update-available', available);
        autoUpdater.removeListener('update-not-available', notAvailable);
        autoUpdater.removeListener('error', fail);
      };
      const available = (): void => finish({ status: 'available' });
      const notAvailable = (): void => finish({ status: 'not-available' });
      autoUpdater.once('update-available', available);
      autoUpdater.once('update-not-available', notAvailable);
      autoUpdater.once('error', fail);
      const timer = setTimeout(
        () => fail(new Error('Update check timed out after 30 seconds')),
        30_000,
      );
      try {
        autoUpdater.checkForUpdates();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  dispose(): void {
    if (!this.#options.enabled) {
      return;
    }
    autoUpdater.removeListener('update-downloaded', this.#handleDownloaded);
    autoUpdater.removeListener('error', this.#handleBackgroundError);
  }
}
