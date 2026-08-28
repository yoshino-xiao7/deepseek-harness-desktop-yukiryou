import type { AllPublishOptions, UpdateInfo } from 'builder-util-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  CrossPlatformAppUpdater,
  type MacInstallReadiness,
  type NativeUpdateClient,
  type WindowsInstallReadiness,
} from './app-updater.js';

class FakeMacInstallReadiness implements MacInstallReadiness {
  readonly #listeners = new Set<() => void>();

  on(_event: 'update-downloaded', listener: () => void): unknown {
    this.#listeners.add(listener);
    return this;
  }

  removeListener(_event: 'update-downloaded', listener: () => void): unknown {
    this.#listeners.delete(listener);
    return this;
  }

  markReady(): void {
    for (const listener of this.#listeners) listener();
  }
}

class FakeWindowsInstallReadiness implements WindowsInstallReadiness {
  readonly #listeners = new Set<() => void>();

  on(_event: 'before-quit-for-update', listener: () => void): unknown {
    this.#listeners.add(listener);
    return this;
  }

  removeListener(_event: 'before-quit-for-update', listener: () => void): unknown {
    this.#listeners.delete(listener);
    return this;
  }

  markReady(): void {
    for (const listener of this.#listeners) listener();
  }
}

class FakeNativeUpdater implements NativeUpdateClient {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  autoRunAppAfterInstall = false;
  channel: string | null = null;
  allowDowngrade = true;
  disableDifferentialDownload = false;
  installDirectory?: string;
  readonly feeds: AllPublishOptions[] = [];
  readonly quitAndInstall = vi.fn();
  readonly results: Array<() => Promise<{ readonly updateInfo: UpdateInfo } | null>> = [];
  checkCalls = 0;
  readonly #listeners = new Map<string, Set<(value: never) => void>>();

  on(event: string, listener: (value: never) => void): unknown {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: (value: never) => void): unknown {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  setFeedURL(source: AllPublishOptions): void { this.feeds.push(source); }

  async checkForUpdates(): Promise<{ readonly updateInfo: UpdateInfo } | null> {
    this.checkCalls += 1;
    const result = await this.results.shift()?.();
    if (result !== null && result !== undefined) this.emit('update-available', result.updateInfo);
    return result ?? null;
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(value as never);
  }
}

const updateInfo = { version: '0.2.4' } as UpdateInfo;

describe('cross-platform automatic updater', () => {
  it('checks immediately when automatic checks start', async () => {
    vi.useFakeTimers();
    try {
      const native = new FakeNativeUpdater();
      native.results.push(async () => null);
      const updater = new CrossPlatformAppUpdater({
        enabled: true,
        currentVersion: '1.0.1',
        platform: 'darwin',
        architecture: 'arm64',
        onError: vi.fn(),
        createNativeUpdater: () => native,
      });

      updater.startAutomaticChecks();
      await vi.advanceTimersByTimeAsync(0);

      expect(native.checkCalls).toBe(1);
      expect(updater.getState().status).toBe('latest');
      updater.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not offer restart on macOS before Squirrel finishes staging the update', async () => {
    const native = new FakeNativeUpdater();
    const readiness = new FakeMacInstallReadiness();
    const updater = new CrossPlatformAppUpdater({
      enabled: true,
      currentVersion: '1.0.2',
      platform: 'darwin',
      architecture: 'arm64',
      onError: vi.fn(),
      createNativeUpdater: () => native,
      macInstallReadiness: readiness,
    });

    native.emit('update-available', { version: '1.0.3' } as UpdateInfo);
    native.emit('update-downloaded', { version: '1.0.3' } as UpdateInfo);

    expect(updater.getState().status).toBe('downloading');
    readiness.markReady();
    expect(updater.getState().status).toBe('downloaded');
    await updater.prepareInstall();
    expect(native.autoRunAppAfterInstall).toBe(true);
    expect(native.quitAndInstall).toHaveBeenCalledWith(false, true);
    updater.dispose();
  });

  it('falls back from the China provider and preserves download/restart installation', async () => {
    const native = new FakeNativeUpdater();
    const readiness = new FakeWindowsInstallReadiness();
    native.quitAndInstall.mockImplementation(() => readiness.markReady());
    native.results.push(
      async () => { throw new Error('China source unavailable'); },
      async () => ({ updateInfo }),
    );
    const updater = new CrossPlatformAppUpdater({
      enabled: true,
      currentVersion: '0.2.3',
      platform: 'win32',
      architecture: 'x64',
      onError: vi.fn(),
      updateSources: [
        { provider: 'generic', url: 'https://download-cn.suzuki.ink/updates/win32-x64' },
        { provider: 'github', owner: 'yoshino-xiao7', repo: 'deepseek-harness-desktop-yukiryou', private: false },
      ],
      createNativeUpdater: () => native,
      windowsInstallReadiness: readiness,
    });

    await expect(updater.checkForUpdates()).resolves.toEqual({ status: 'available' });
    expect(native.autoDownload).toBe(true);
    expect(native.channel).toBe('latest');
    expect(native.allowDowngrade).toBe(false);
    expect(native.disableDifferentialDownload).toBe(true);
    expect(native.feeds).toHaveLength(2);
    expect(updater.getState().status).toBe('downloading');

    native.emit('update-downloaded', updateInfo);
    expect(updater.getState().status).toBe('downloaded');
    await updater.prepareInstall();
    expect(native.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(native.autoInstallOnAppQuit).toBe(false);
    expect(native.installDirectory).toBeDefined();
  });

  it('uses the maintained silent NSIS updater and lets it own the quit', async () => {
    const native = new FakeNativeUpdater();
    const readiness = new FakeWindowsInstallReadiness();
    native.quitAndInstall.mockImplementation(() => readiness.markReady());
    const updater = new CrossPlatformAppUpdater({
      enabled: true,
      currentVersion: '1.0.4',
      platform: 'win32',
      architecture: 'x64',
      onError: vi.fn(),
      createNativeUpdater: () => native,
      windowsInstallReadiness: readiness,
    });

    await expect(updater.prepareInstall()).resolves.toBeUndefined();
    expect(native.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('rejects when the Windows updater never accepts the install handoff', async () => {
    vi.useFakeTimers();
    try {
      const native = new FakeNativeUpdater();
      const updater = new CrossPlatformAppUpdater({
        enabled: true,
        currentVersion: '1.0.4',
        platform: 'win32',
        architecture: 'x64',
        onError: vi.fn(),
        createNativeUpdater: () => native,
        windowsInstallReadiness: new FakeWindowsInstallReadiness(),
        windowsInstallHandoffTimeoutMs: 25,
      });

      const handoff = expect(updater.prepareInstall()).rejects.toThrow(
        'Windows native updater did not accept the install handoff',
      );
      await vi.advanceTimersByTimeAsync(25);
      await handoff;
    } finally {
      vi.useRealTimers();
    }
  });
});
