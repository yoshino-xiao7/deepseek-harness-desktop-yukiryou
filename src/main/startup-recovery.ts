import type { AppLog } from './diagnostics/app-log.js';

export interface StartupRelaunchOptions {
  readonly log: AppLog | undefined;
  readonly relaunch: () => void;
  readonly dispose: () => void;
  readonly quit: () => void;
}

export interface ApplicationExitOptions {
  readonly log: AppLog | undefined;
  readonly dispose: () => void;
  readonly exit: () => void;
}

export interface ApplicationUpdateHandoffOptions {
  readonly log: AppLog | undefined;
  readonly handoff: () => void;
  readonly cleanup: () => Promise<void> | void;
  readonly dispose: () => void;
}

const APPLICATION_EXIT_CLEANUP_TIMEOUT_MS = 1_000;

/**
 * Relaunch after pre-Runtime startup failed. Logging is deliberately
 * best-effort because the triggering failure may be a full or read-only disk.
 */
export async function relaunchAfterStartupFailure(
  options: StartupRelaunchOptions,
): Promise<void> {
  try {
    options.log?.write('app.relaunching-after-startup-failure');
  } catch {
    // Relaunch must not depend on diagnostics being writable.
  }
  try {
    await options.log?.flush();
  } catch {
    // A failed diagnostics queue cannot block relaunch.
  }

  try {
    options.relaunch();
  } finally {
    await finalizeApplicationExit({
      log: options.log,
      dispose: options.dispose,
      exit: options.quit,
    });
  }
}

export async function finalizeApplicationExit(
  options: ApplicationExitOptions,
): Promise<void> {
  try {
    options.dispose();
  } finally {
    await waitForApplicationExitCleanup(() => options.log?.close());
    options.exit();
  }
}

/**
 * Starts the native installer before destroying the final application window.
 * On Windows, destroying that window can begin Electron shutdown immediately,
 * so deferring quitAndInstall until after UI cleanup can terminate the process
 * before electron-updater has spawned the NSIS installer.
 */
export async function handoffApplicationUpdate(
  options: ApplicationUpdateHandoffOptions,
): Promise<void> {
  options.handoff();
  try {
    await waitForApplicationExitCleanup(options.cleanup);
  } finally {
    options.dispose();
    await waitForApplicationExitCleanup(() => options.log?.close());
  }
}

/**
 * Exit and update installation are terminal operations. Best-effort state or
 * diagnostics persistence must therefore have a strict deadline: a filesystem
 * request that never settles cannot be allowed to strand the hidden Electron
 * main process before quitAndInstall is reached.
 */
export async function waitForApplicationExitCleanup(
  cleanup: () => Promise<void> | void,
  timeoutMs = APPLICATION_EXIT_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([
      Promise.resolve().then(cleanup).catch(() => undefined),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function startupPreparationFailureLogDetails(error: unknown): string {
  const code = isErrorWithCode(error) ? String(error.code) : 'unknown';
  const name = error instanceof Error ? error.name : typeof error;
  return `stage=runtime-preparation code=${code} error=${name}`;
}

function isErrorWithCode(
  error: unknown,
): error is Error & { readonly code: unknown } {
  return error instanceof Error && 'code' in error;
}
