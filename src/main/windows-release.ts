export const windowsExecutableName = 'DeepSeek YukiRyou';
export const windowsAppUserModelId = 'com.yukiryou.deepseek.yukiryou';

export function shouldConfigureWindowsApplicationIdentity(
  platform: NodeJS.Platform,
): boolean {
  return platform === 'win32';
}
