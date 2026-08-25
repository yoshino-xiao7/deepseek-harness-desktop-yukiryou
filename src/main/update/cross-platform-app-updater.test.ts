import type { AllPublishOptions, UpdateInfo } from 'builder-util-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  CrossPlatformAppUpdater,
  type NativeUpdateClient,
} from './app-updater.js';

class FakeNativeUpdater implements NativeUpdateClient {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  channel: string | null = null;
  allowDowngrade = true;
  disableDifferentialDownload = false;
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

  it('falls back from the China provider and preserves download/restart installation', async () => {
    const native = new FakeNativeUpdater();
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
    updater.quitAndInstall();
    expect(native.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});
