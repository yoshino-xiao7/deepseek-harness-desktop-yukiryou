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
  /** A hard gate. Failure here must prevent the installer from starting. */
  readonly prepare: () => Promise<void>;
  /** Best-effort persistence that runs after the hard gate. */
  readonly persist: () => Promise<void> | void;
  /** The native updater handoff. This must be the final lifecycle action. */
  readonly handoff: () => Promise<void>;
  readonly onHandoffFailure: (error: unknown) => Promise<void> | void;
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
 * Stops update-sensitive resources before handing control to the native
 * updater. In particular, the Windows Runtime process tree must be gone before
 * NSIS starts; starting NSIS first races the old uninstaller against cleanup.
 */
export async function handoffApplicationUpdate(
  options: ApplicationUpdateHandoffOptions,
): Promise<boolean> {
  try {
    await options.prepare();
  } catch (error) {
    await options.onHandoffFailure(error);
    return false;
  }

  await waitForApplicationExitCleanup(options.persist);
  try {
    await options.handoff();
  } catch (error) {
    await options.onHandoffFailure(error);
    return false;
  }
  return true;
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
