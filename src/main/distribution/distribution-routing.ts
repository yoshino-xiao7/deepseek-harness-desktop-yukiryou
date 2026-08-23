export type DistributionRegion = 'china' | 'global';
export type DesktopUpdateSource =
  | { readonly provider: 'generic'; readonly url: string }
  | {
      readonly provider: 'github';
      readonly owner: string;
      readonly repo: string;
      readonly private: false;
    };

const CHINA_DOWNLOAD_ORIGIN = 'https://download-cn.suzuki.ink';
const GITHUB_RELEASES_ORIGIN =
  'https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases';
const GITHUB_RELEASE_API =
  'https://api.github.com/repos/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest';

export function distributionRegion(options: {
  readonly countryCode?: string;
  readonly override?: string;
}): DistributionRegion {
  const override = options.override?.trim().toLowerCase();
  if (override === 'china' || override === 'global') return override;
  return options.countryCode?.trim().toUpperCase() === 'CN' ? 'china' : 'global';
}

export function releaseMetadataUrls(options: {
  readonly region: DistributionRegion;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}): readonly string[] {
  if (options.region === 'china') {
    return Object.freeze([
      `${CHINA_DOWNLOAD_ORIGIN}/updates/${options.platform}-${options.architecture}/latest.json`,
      GITHUB_RELEASE_API,
    ]);
  }
  return Object.freeze([GITHUB_RELEASE_API]);
}

export function desktopUpdateSources(options: {
  readonly region: DistributionRegion;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}): readonly DesktopUpdateSource[] {
  const github: DesktopUpdateSource = Object.freeze({
    provider: 'github',
    owner: 'yoshino-xiao7',
    repo: 'deepseek-harness-desktop-yukiryou',
    private: false,
  });
  return options.region === 'china'
    ? Object.freeze([
        Object.freeze({
          provider: 'generic',
          url: `${CHINA_DOWNLOAD_ORIGIN}/updates/${options.platform}-${options.architecture}`,
        }),
        github,
      ])
    : Object.freeze([github]);
}

export function releaseDownloadPageUrl(): string {
  // OSS intentionally has no browsable index. A successful China metadata
  // check supplies the exact mirrored asset URL; otherwise keep this safe
  // GitHub fallback instead of opening a nonexistent bucket directory.
  return `${GITHUB_RELEASES_ORIGIN}/latest`;
}

export function curatedCatalogUrls(region: DistributionRegion): readonly string[] {
  const github =
    'https://raw.githubusercontent.com/yoshino-xiao7/deepseek-yukiryou-plugin-catalog/main/catalog-v1.json';
  return region === 'china'
    ? Object.freeze([`${CHINA_DOWNLOAD_ORIGIN}/plugins/catalog/catalog-v1.json`, github])
    : Object.freeze([github]);
}
