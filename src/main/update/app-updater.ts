import { autoUpdater, type Event } from 'electron';
import type { AllPublishOptions, UpdateInfo } from 'builder-util-runtime';
import { MacUpdater } from 'electron-updater';
import { dirname } from 'node:path';

import { updateFeedUrl } from './update-config.js';
import { updateRecoveryForError } from './update-error.js';
import { ReliableWindowsNsisUpdater } from './windows-nsis-updater.js';
import type { DesktopUpdateSource } from '../distribution/distribution-routing.js';
import type { DesktopUpdateState } from '../../shared/update-bridge.js';

export type UpdateCheckResult =
  | { readonly status: 'disabled' | 'busy' | 'not-available' }
  | { readonly status: 'available' };

export interface AppUpdater {
  checkForUpdates(): Promise<UpdateCheckResult>;
  getState(): DesktopUpdateState;
  getDownloadUrl(): string | undefined;
  subscribe(listener: (state: DesktopUpdateState) => void): () => void;
  startAutomaticChecks(): void;
  prepareInstall(): Promise<boolean>;
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
  readonly releaseMetadataUrls?: readonly string[];
  readonly updateSources?: readonly DesktopUpdateSource[];
  readonly createNativeUpdater?: (
    platform: NodeJS.Platform,
    source: AllPublishOptions,
  ) => NativeUpdateClient;
  readonly macInstallReadiness?: MacInstallReadiness;
}

export interface MacInstallReadiness {
  on(event: 'update-downloaded', listener: () => void): unknown;
  removeListener(event: 'update-downloaded', listener: () => void): unknown;
}

export function createAppUpdater(options: AppUpdaterOptions): AppUpdater {
  if (options.enabled && (options.platform === 'darwin' || options.platform === 'win32')) {
    return new CrossPlatformAppUpdater(options);
  }
  return new ElectronAppUpdater(options);
}

export interface NativeUpdateClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  channel: string | null;
  allowDowngrade: boolean;
  disableDifferentialDownload: boolean;
  installDirectory?: string;
  on(event: 'update-available' | 'update-not-available' | 'update-downloaded', listener: (info: UpdateInfo) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'update-available' | 'update-not-available' | 'update-downloaded', listener: (info: UpdateInfo) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
  setFeedURL(source: AllPublishOptions): void;
  checkForUpdates(): Promise<{ readonly updateInfo: UpdateInfo } | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface ReliableWindowsUpdateClient extends NativeUpdateClient {
  prepareInstall(isSilent?: boolean, isForceRunAfter?: boolean): Promise<void>;
}

export class CrossPlatformAppUpdater implements AppUpdater {
  readonly #options: AppUpdaterOptions;
  readonly #native: NativeUpdateClient;
  readonly #macInstallReadiness: MacInstallReadiness | undefined;
  readonly #listeners = new Set<(state: DesktopUpdateState) => void>();
  readonly #sources: readonly DesktopUpdateSource[];
  #sourceIndex = 0;
  #checking = false;
  #recovering = false;
  #macInstallReady = false;
  #macDownloadedInfo: UpdateInfo | undefined;
  #state: DesktopUpdateState;
  #initialTimer: ReturnType<typeof setTimeout> | undefined;
  #intervalTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    this.#sources = options.updateSources ?? [{
      provider: 'github',
      owner: 'yoshino-xiao7',
      repo: 'deepseek-harness-desktop-yukiryou',
      private: false,
    }];
    const source = this.#source(0);
    this.#native = options.createNativeUpdater?.(options.platform, source) ??
      (options.platform === 'win32'
        ? new ReliableWindowsNsisUpdater(source)
        : new MacUpdater(source));
    this.#native.autoDownload = true;
    this.#native.autoInstallOnAppQuit = options.platform !== 'win32';
    this.#native.autoRunAppAfterInstall = true;
    this.#native.channel = 'latest';
    this.#native.allowDowngrade = false;
    this.#native.disableDifferentialDownload = true;
    if (options.platform === 'win32') {
      // Do not rely solely on NSIS' uninstall registry entry to rediscover a
      // user-selected install directory. Passing /D explicitly also makes the
      // updater deterministic for portable CI installations and repaired or
      // migrated installations whose registry state may be incomplete.
      this.#native.installDirectory = dirname(process.execPath);
    }
    this.#native.on('update-available', this.#handleAvailable);
    this.#native.on('update-not-available', this.#handleNotAvailable);
    this.#native.on('update-downloaded', this.#handleDownloaded);
    this.#native.on('error', this.#handleError);
    this.#macInstallReadiness = options.platform === 'darwin'
      ? options.macInstallReadiness ?? autoUpdater
      : undefined;
    this.#macInstallReadiness?.on('update-downloaded', this.#handleMacInstallReady);
    this.#state = { status: 'idle', currentVersion: options.currentVersion };
  }

  readonly #handleAvailable = (info: UpdateInfo): void => {
    if (this.#options.platform === 'darwin') {
      this.#macInstallReady = false;
      this.#macDownloadedInfo = undefined;
    }
    this.#setState({
      status: 'downloading',
      currentVersion: this.#options.currentVersion,
      releaseName: info.version.slice(0, 80),
      ...optionalReleaseNotes(info),
      checkedAt: new Date().toISOString(),
    });
  };

  readonly #handleNotAvailable = (): void => {
    this.#setState({
      status: 'latest',
      currentVersion: this.#options.currentVersion,
      checkedAt: new Date().toISOString(),
    });
  };

  readonly #handleDownloaded = (info: UpdateInfo): void => {
    if (this.#options.platform === 'darwin') {
      // MacUpdater emits its public event before Squirrel.Mac has fetched,
      // unpacked, and validated the ZIP through Electron's native updater.
      // Offering restart at this point can hide the app for minutes while no
      // installer owns the quit yet. Wait for the native readiness event.
      this.#macDownloadedInfo = info;
      if (!this.#macInstallReady) return;
    }
    this.#publishDownloaded(info);
  };

  readonly #handleMacInstallReady = (): void => {
    this.#macInstallReady = true;
    if (this.#macDownloadedInfo !== undefined) {
      this.#publishDownloaded(this.#macDownloadedInfo);
    }
  };

  #publishDownloaded(info: UpdateInfo): void {
    this.#setState({
      status: 'downloaded',
      currentVersion: this.#options.currentVersion,
      releaseName: info.version.slice(0, 80),
      ...optionalReleaseNotes(info),
      checkedAt: new Date().toISOString(),
    });
  }

  readonly #handleError = (error: Error): void => {
    if (this.#checking || this.#recovering) return;
    if (this.#sourceIndex + 1 < this.#sources.length) {
      void this.#recoverDownloadFromFallback();
      return;
    }
    this.#reportFailure(error);
  };

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (this.#checking || this.#state.status === 'downloading') return { status: 'busy' };
    if (this.#state.status === 'downloaded') return { status: 'available' };
    this.#checking = true;
    this.#setState({ status: 'checking', currentVersion: this.#options.currentVersion });
    let lastFailure: Error | undefined;
    try {
      for (let index = 0; index < this.#sources.length; index += 1) {
        this.#sourceIndex = index;
        this.#native.setFeedURL(this.#source(index));
        try {
          const result = await this.#native.checkForUpdates();
          if (result === null || compareVersions(result.updateInfo.version, this.#options.currentVersion) <= 0) {
            this.#handleNotAvailable();
            return { status: 'not-available' };
          }
          return { status: 'available' };
        } catch (error) {
          lastFailure = error instanceof Error ? error : new Error(String(error));
        }
      }
      throw lastFailure ?? new Error('No update source is configured');
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.#reportFailure(failure);
      throw failure;
    } finally {
      this.#checking = false;
    }
  }

  getState(): DesktopUpdateState { return this.#state; }

  getDownloadUrl(): string | undefined { return undefined; }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  startAutomaticChecks(): void {
    if (this.#initialTimer !== undefined) return;
    const check = (): void => { void this.checkForUpdates().catch(() => undefined); };
    this.#initialTimer = setTimeout(check, this.#options.automaticCheckDelayMs ?? 0);
    this.#intervalTimer = setInterval(check, this.#options.automaticCheckIntervalMs ?? 6 * 60 * 60 * 1_000);
  }

  async prepareInstall(): Promise<boolean> {
    // The Windows artifact is an assisted NSIS installer with
    // runAfterFinish=false. Its generated installer only honors --force-run
    // during a silent update; a non-silent quitAndInstall therefore installs
    // successfully but leaves the application closed. macOS keeps its native
    // non-silent Squirrel handoff.
    if (this.#options.platform === 'win32' && isReliableWindowsUpdateClient(this.#native)) {
      await this.#native.prepareInstall(true, true);
      return true;
    }
    this.#native.quitAndInstall(false, true);
    return false;
  }

  dispose(): void {
    clearTimeout(this.#initialTimer);
    clearInterval(this.#intervalTimer);
    this.#native.removeListener('update-available', this.#handleAvailable);
    this.#native.removeListener('update-not-available', this.#handleNotAvailable);
    this.#native.removeListener('update-downloaded', this.#handleDownloaded);
    this.#native.removeListener('error', this.#handleError);
    this.#macInstallReadiness?.removeListener(
      'update-downloaded',
      this.#handleMacInstallReady,
    );
    this.#listeners.clear();
  }

  #source(index: number): AllPublishOptions {
    const source = this.#sources[index];
    if (source === undefined) throw new Error('No update source is configured');
    return source;
  }

  async #recoverDownloadFromFallback(): Promise<void> {
    this.#recovering = true;
    this.#sourceIndex += 1;
    this.#native.setFeedURL(this.#source(this.#sourceIndex));
    this.#setState({ status: 'checking', currentVersion: this.#options.currentVersion });
    try {
      await this.#native.checkForUpdates();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (this.#sourceIndex + 1 < this.#sources.length) {
        this.#recovering = false;
        await this.#recoverDownloadFromFallback();
        return;
      }
      this.#reportFailure(failure);
    } finally {
      this.#recovering = false;
    }
  }

  #reportFailure(error: Error): void {
    this.#setState({
      status: updateRecoveryForError(error) === 'manual-download' ? 'manual' : 'error',
      currentVersion: this.#options.currentVersion,
      message: safeErrorMessage(error),
    });
    this.#options.onError(error);
  }

  #setState(state: DesktopUpdateState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
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
  #downloadUrl: string | undefined;

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
      const release = await this.#fetchLatestRelease();
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
      this.#downloadUrl = release.html_url;
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

  getDownloadUrl(): string | undefined { return this.#downloadUrl; }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  startAutomaticChecks(): void {
    if (!this.#options.enabled || this.#initialTimer !== undefined) return;
    const check = (): void => { void this.checkForUpdates().catch(() => undefined); };
    this.#initialTimer = setTimeout(check, this.#options.automaticCheckDelayMs ?? 0);
    this.#intervalTimer = setInterval(check, this.#options.automaticCheckIntervalMs ?? 6 * 60 * 60 * 1_000);
  }

  async prepareInstall(): Promise<boolean> { return false; }

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

  async #fetchLatestRelease(): Promise<GitHubRelease> {
    const urls = this.#options.releaseMetadataUrls ?? [updateFeedUrl({
      currentVersion: this.#options.currentVersion,
      platform: this.#options.platform,
      architecture: this.#options.architecture,
    })];
    let lastFailure: Error | undefined;
    for (const url of urls) {
      try {
        const response = await (this.#options.fetchLatestRelease ?? fetch)(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `DeepSeek-YukiRyou/${this.#options.currentVersion}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          throw new Error(`Update metadata request failed (${String(response.status)})`);
        }
        return validatedGitHubRelease(await response.json());
      } catch (error) {
        lastFailure = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastFailure ?? new Error('No update metadata source is configured');
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

  getDownloadUrl(): string | undefined { return undefined; }

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
      this.#options.automaticCheckDelayMs ?? 0,
    );
    this.#intervalTimer = setInterval(
      check,
      this.#options.automaticCheckIntervalMs ?? 6 * 60 * 60 * 1_000,
    );
  }

  async prepareInstall(): Promise<boolean> {
    autoUpdater.quitAndInstall();
    return false;
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

function isReliableWindowsUpdateClient(
  client: NativeUpdateClient,
): client is ReliableWindowsUpdateClient {
  return 'prepareInstall' in client && typeof client.prepareInstall === 'function';
}

function optionalReleaseNotes(info: UpdateInfo): { readonly releaseNotes?: string } {
  if (typeof info.releaseNotes === 'string') {
    return { releaseNotes: info.releaseNotes.slice(0, 2_000) };
  }
  if (Array.isArray(info.releaseNotes)) {
    return { releaseNotes: info.releaseNotes
      .map((entry) => `${entry.version}: ${entry.note ?? ''}`)
      .join('\n')
      .slice(0, 2_000) };
  }
  return {};
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
