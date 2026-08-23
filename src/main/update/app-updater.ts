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
  readonly fetchLatestRelease?: typeof fetch;
}

export function createAppUpdater(options: AppUpdaterOptions): AppUpdater {
  if (options.enabled && options.platform === 'win32') {
    return new GitHubReleaseAppUpdater(options);
  }
  return new ElectronAppUpdater(options);
}

interface GitHubRelease {
  readonly tag_name: string;
  readonly name?: string | null;
  readonly body?: string | null;
  readonly html_url: string;
  readonly draft: boolean;
}

export class GitHubReleaseAppUpdater implements AppUpdater {
  readonly #options: AppUpdaterOptions;
  readonly #listeners = new Set<(state: DesktopUpdateState) => void>();
  #checking = false;
  #state: DesktopUpdateState;
  #initialTimer: ReturnType<typeof setTimeout> | undefined;
  #intervalTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    this.#state = {
      status: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
    };
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (!this.#options.enabled) return { status: 'disabled' };
    if (this.#checking) return { status: 'busy' };
    this.#checking = true;
    this.#setState({ status: 'checking', currentVersion: this.#options.currentVersion });
    try {
      const response = await (this.#options.fetchLatestRelease ?? fetch)(
        updateFeedUrl({
          currentVersion: this.#options.currentVersion,
          platform: this.#options.platform,
          architecture: this.#options.architecture,
        }),
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `DeepSeek-YukiRyou/${this.#options.currentVersion}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error(`GitHub update check failed (${String(response.status)})`);
      const release = validatedGitHubRelease(await response.json());
      const checkedAt = new Date().toISOString();
      if (compareVersions(release.tag_name, this.#options.currentVersion) <= 0) {
        this.#setState({ status: 'latest', currentVersion: this.#options.currentVersion, checkedAt });
        return { status: 'not-available' };
      }
      this.#setState({
        status: 'manual',
        currentVersion: this.#options.currentVersion,
        releaseName: (release.name ?? release.tag_name).slice(0, 80),
        releaseNotes: (release.body ?? '').slice(0, 2_000),
        checkedAt,
      });
      return { status: 'available' };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.#setState({
        status: 'error',
        currentVersion: this.#options.currentVersion,
        message: safeErrorMessage(failure),
      });
      this.#options.onError(failure);
      throw failure;
    } finally {
      this.#checking = false;
    }
  }

  getState(): DesktopUpdateState { return this.#state; }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  startAutomaticChecks(): void {
    if (!this.#options.enabled || this.#initialTimer !== undefined) return;
    const check = (): void => { void this.checkForUpdates().catch(() => undefined); };
    this.#initialTimer = setTimeout(check, this.#options.automaticCheckDelayMs ?? 15_000);
    this.#intervalTimer = setInterval(check, this.#options.automaticCheckIntervalMs ?? 6 * 60 * 60 * 1_000);
  }

  quitAndInstall(): void {}

  dispose(): void {
    clearTimeout(this.#initialTimer);
    clearInterval(this.#intervalTimer);
    this.#initialTimer = undefined;
    this.#intervalTimer = undefined;
    this.#listeners.clear();
  }

  #setState(state: DesktopUpdateState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
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

function validatedGitHubRelease(value: unknown): GitHubRelease {
  if (typeof value !== 'object' || value === null) throw new Error('GitHub returned an invalid release');
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.tag_name !== 'string' ||
    typeof candidate.html_url !== 'string' ||
    typeof candidate.draft !== 'boolean' ||
    candidate.draft
  ) {
    throw new Error('GitHub returned an invalid release');
  }
  return candidate as unknown as GitHubRelease;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): { core: number[]; prerelease: string[] } => {
    const normalized = value.trim().replace(/^v/i, '').split('+', 1)[0] ?? '';
    const [core = '', prerelease = ''] = normalized.split('-', 2);
    const numbers = core.split('.').map((part) => Number(part));
    if (numbers.length !== 3 || numbers.some((part) => !Number.isSafeInteger(part) || part < 0)) {
      throw new Error(`Invalid release version: ${value}`);
    }
    return { core: numbers, prerelease: prerelease === '' ? [] : prerelease.split('.') };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xNumber = /^\d+$/.test(x) ? Number(x) : undefined;
    const yNumber = /^\d+$/.test(y) ? Number(y) : undefined;
    if (xNumber !== undefined && yNumber !== undefined) return Math.sign(xNumber - yNumber);
    if (xNumber !== undefined || yNumber !== undefined) return xNumber !== undefined ? -1 : 1;
    return x.localeCompare(y);
  }
  return 0;
}
