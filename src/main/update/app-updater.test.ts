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
      'https://update.electronjs.org/yoshino-xiao7/deepseek-yukiryou/darwin-arm64/0.1.0',
    );
  });

  it('enables updates only for packaged Apple Silicon builds', () => {
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
  });
});
