export const windowsSquirrelPackageId = 'DeepSeekYukiRyou';
export const windowsExecutableName = 'DeepSeek YukiRyou';
export const windowsSquirrelAppUserModelId =
  `com.squirrel.${windowsSquirrelPackageId}.${windowsExecutableName}`;

export function shouldConfigureWindowsApplicationIdentity(
  platform: NodeJS.Platform,
): boolean {
  return platform === 'win32';
}
