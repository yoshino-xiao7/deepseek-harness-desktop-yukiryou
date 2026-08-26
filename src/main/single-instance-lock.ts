export interface SingleInstanceLockOptions {
  readonly request: () => boolean;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly retryDelayMs?: number;
  readonly maxAttempts?: number;
}

/**
 * Squirrel.Mac can launch the replacement bundle while the old Electron
 * process is still releasing its singleton socket. Give that hand-off a
 * short bounded grace period instead of treating the updater relaunch as a
 * normal duplicate launch and immediately terminating it.
 */
export async function acquireSingleInstanceLock(
  options: SingleInstanceLockOptions,
): Promise<boolean> {
  const delay = options.delay ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.request()) return true;
    if (attempt < maxAttempts) await delay(retryDelayMs);
  }
  return false;
}
