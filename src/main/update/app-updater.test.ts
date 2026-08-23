import { describe, expect, it } from 'vitest';

import { isUpdaterSupported, updateFeedUrl } from './update-config.js';

describe('application updater configuration', () => {
  it('uses the architecture-specific public GitHub update service feed', () => {
    expect(
      updateFeedUrl({
        currentVersion: '0.1.0',
        platform: 'darwin',
        architecture: 'arm64',
      }),
    ).toBe(
      'https://update.electronjs.org/yoshino-xiao7/deepseek-harness-desktop-yukiryou/darwin-arm64/0.1.0',
    );
  });

  it('enables updates only for packaged release targets', () => {
    expect(
      isUpdaterSupported({
        isPackaged: true,
        platform: 'darwin',
        architecture: 'arm64',
      }),
    ).toBe(true);
    expect(
      isUpdaterSupported({
        isPackaged: false,
        platform: 'darwin',
        architecture: 'arm64',
      }),
    ).toBe(false);
    expect(
      isUpdaterSupported({
        isPackaged: true,
        platform: 'darwin',
        architecture: 'x64',
      }),
    ).toBe(false);
    expect(
      isUpdaterSupported({
        isPackaged: true,
        platform: 'win32',
        architecture: 'x64',
      }),
    ).toBe(true);
    expect(
      isUpdaterSupported({
        isPackaged: true,
        platform: 'win32',
        architecture: 'arm64',
      }),
    ).toBe(false);
    expect(
      isUpdaterSupported({
        isPackaged: true,
        platform: 'linux',
        architecture: 'x64',
      }),
    ).toBe(false);
  });

  it('uses the GitHub Releases API instead of a missing Squirrel RELEASES feed on Windows', () => {
    expect(
      updateFeedUrl({
        currentVersion: '0.2.3-beta.1',
        platform: 'win32',
        architecture: 'x64',
      }),
    ).toBe('https://api.github.com/repos/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest');
  });
});
