import { describe, expect, it } from 'vitest';

import {
  curatedCatalogUrls,
  desktopUpdateSources,
  distributionRegion,
  releaseDownloadPageUrl,
  releaseMetadataUrls,
} from './distribution-routing.js';

describe('distribution routing', () => {
  it('uses the China route only for a Chinese locale or explicit override', () => {
    expect(distributionRegion({ countryCode: 'CN' })).toBe('china');
    expect(distributionRegion({ countryCode: 'US' })).toBe('global');
    expect(distributionRegion({ countryCode: 'CN', override: 'global' })).toBe('global');
    expect(distributionRegion({ countryCode: 'US', override: 'china' })).toBe('china');
  });

  it('keeps GitHub as the final fallback for China release metadata', () => {
    const urls = releaseMetadataUrls({
      region: 'china',
      platform: 'win32',
      architecture: 'x64',
    });
    expect(urls[0]).toBe(
      'https://download-cn.suzuki.ink/updates/win32-x64/latest.json',
    );
    expect(urls.at(-1)).toContain('api.github.com');
  });

  it('uses a generic China auto-update provider with the GitHub provider as fallback', () => {
    expect(desktopUpdateSources({
      region: 'china',
      platform: 'darwin',
      architecture: 'arm64',
    })).toEqual([
      {
        provider: 'generic',
        url: 'https://download-cn.suzuki.ink/updates/darwin-arm64',
      },
      {
        provider: 'github',
        owner: 'yoshino-xiao7',
        repo: 'deepseek-harness-desktop-yukiryou',
        private: false,
      },
    ]);
  });

  it('routes curated plugin metadata through China with GitHub fallback', () => {
    const urls = curatedCatalogUrls('china');
    expect(urls[0]).toContain('download-cn.suzuki.ink');
    expect(urls[1]).toContain('raw.githubusercontent.com');
    expect(releaseDownloadPageUrl()).toContain('github.com');
  });
});
