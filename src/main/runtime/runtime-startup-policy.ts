// 0.1.5-rc.2's Loader concurrently applies the whole profile, then rolls the
// tree back before printing `failed to import/apply loader entry`. Killing the
// process at 20s left stderr empty, so plugin isolation could not match an
// inventory identity and fell through to safe mode.
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const WINDOWS_COLD_STARTUP_TIMEOUT_MS = 60_000;

export function runtimeStartupTimeoutMs(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === 'win32'
    ? WINDOWS_COLD_STARTUP_TIMEOUT_MS
    : DEFAULT_STARTUP_TIMEOUT_MS;
}
