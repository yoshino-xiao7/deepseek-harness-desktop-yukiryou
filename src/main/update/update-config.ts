const UPDATE_SERVER = 'https://update.electronjs.org';
const REPOSITORY_OWNER = 'yoshino-xiao7';
const REPOSITORY_NAME = 'deepseek-harness-desktop-yukiryou';

export function updateFeedUrl(options: {
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}): string {
  const target = `${options.platform}-${options.architecture}`;
  return [
    UPDATE_SERVER,
    REPOSITORY_OWNER,
    REPOSITORY_NAME,
    target,
    encodeURIComponent(options.currentVersion),
  ].join('/');
}

export function isUpdaterSupported(options: {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}): boolean {
  return (
    options.isPackaged &&
    options.platform === 'darwin' &&
    options.architecture === 'arm64'
  );
}
