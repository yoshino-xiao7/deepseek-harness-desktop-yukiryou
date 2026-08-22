const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const WINDOWS_COLD_STARTUP_TIMEOUT_MS = 60_000;

export function runtimeStartupTimeoutMs(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === 'win32'
    ? WINDOWS_COLD_STARTUP_TIMEOUT_MS
    : DEFAULT_STARTUP_TIMEOUT_MS;
}
