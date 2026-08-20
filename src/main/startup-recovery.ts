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
    try {
      await options.log?.close();
    } catch {
      // A failed diagnostics queue cannot strand a hidden main process.
    }
    options.exit();
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
