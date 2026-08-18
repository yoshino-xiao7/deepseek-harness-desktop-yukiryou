import { autoUpdater, type Event } from 'electron';

import { updateFeedUrl } from './update-config.js';
import { updateRecoveryForError } from './update-error.js';
import type { DesktopUpdateState } from '../../shared/update-bridge.js';

export type UpdateCheckResult =
  | { readonly status: 'disabled' | 'busy' | 'not-available' }
  | { readonly status: 'available' };

export interface AppUpdater {
  checkForUpdates(): Promise<UpdateCheckResult>;
  getState(): DesktopUpdateState;
  subscribe(listener: (state: DesktopUpdateState) => void): () => void;
  startAutomaticChecks(): void;
  quitAndInstall(): void;
  dispose(): void;
}

export interface AppUpdaterOptions {
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly onError: (error: Error) => void;
  readonly automaticCheckDelayMs?: number;
  readonly automaticCheckIntervalMs?: number;
}

export function createAppUpdater(options: AppUpdaterOptions): AppUpdater {
  return new ElectronAppUpdater(options);
}

class ElectronAppUpdater implements AppUpdater {
  readonly #options: AppUpdaterOptions;
  readonly #listeners = new Set<(state: DesktopUpdateState) => void>();
  #checking = false;
  #state: DesktopUpdateState;
  #initialTimer: ReturnType<typeof setTimeout> | undefined;
  #intervalTimer: ReturnType<typeof setInterval> | undefined;

  readonly #handleDownloaded = (
    _event: Event,
    releaseNotes: string,
    releaseName: string,
  ): void => {
    this.#setState({
      status: 'downloaded',
      currentVersion: this.#options.currentVersion,
      releaseName: releaseName.slice(0, 80),
      releaseNotes: releaseNotes.slice(0, 2_000),
      checkedAt: new Date().toISOString(),
    });
  };

  readonly #handleBackgroundError = (error: Error): void => {
    if (!this.#checking) {
      this.#setState({
        status: updateRecoveryForError(error) === 'manual-download'
          ? 'manual'
          : 'error',
        currentVersion: this.#options.currentVersion,
        message: safeErrorMessage(error),
      });
      this.#options.onError(error);
    }
  };

  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    this.#state = {
      status: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
    };
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
    if (this.#checking || this.#state.status === 'downloading') {
      return { status: 'busy' };
    }
    if (this.#state.status === 'downloaded') {
      return { status: 'available' };
    }
    this.#checking = true;
    this.#setState({
      status: 'checking',
      currentVersion: this.#options.currentVersion,
    });
    return new Promise<UpdateCheckResult>((resolve, reject) => {
      const finish = (result: UpdateCheckResult): void => {
        cleanup();
        this.#checking = false;
        resolve(result);
      };
      const fail = (error: Error): void => {
        cleanup();
        this.#checking = false;
        this.#setState({
          status: updateRecoveryForError(error) === 'manual-download'
            ? 'manual'
            : 'error',
          currentVersion: this.#options.currentVersion,
          message: safeErrorMessage(error),
        });
        reject(error);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        autoUpdater.removeListener('update-available', available);
        autoUpdater.removeListener('update-not-available', notAvailable);
        autoUpdater.removeListener('error', fail);
      };
      const available = (): void => {
        this.#setState({
          status: 'downloading',
          currentVersion: this.#options.currentVersion,
          checkedAt: new Date().toISOString(),
        });
        finish({ status: 'available' });
      };
      const notAvailable = (): void => {
        this.#setState({
          status: 'latest',
          currentVersion: this.#options.currentVersion,
          checkedAt: new Date().toISOString(),
        });
        finish({ status: 'not-available' });
      };
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

  getState(): DesktopUpdateState {
    return this.#state;
  }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  startAutomaticChecks(): void {
    if (!this.#options.enabled || this.#initialTimer !== undefined) {
      return;
    }
    const check = (): void => {
      void this.checkForUpdates().catch(() => undefined);
    };
    this.#initialTimer = setTimeout(
      check,
      this.#options.automaticCheckDelayMs ?? 15_000,
    );
    this.#intervalTimer = setInterval(
      check,
      this.#options.automaticCheckIntervalMs ?? 6 * 60 * 60 * 1_000,
    );
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  dispose(): void {
    clearTimeout(this.#initialTimer);
    clearInterval(this.#intervalTimer);
    this.#initialTimer = undefined;
    this.#intervalTimer = undefined;
    this.#listeners.clear();
    if (!this.#options.enabled) {
      return;
    }
    autoUpdater.removeListener('update-downloaded', this.#handleDownloaded);
    autoUpdater.removeListener('error', this.#handleBackgroundError);
  }

  #setState(state: DesktopUpdateState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
}

function safeErrorMessage(error: Error): string {
  return (error.message.trim() || 'Unable to check for updates').slice(0, 240);
}
