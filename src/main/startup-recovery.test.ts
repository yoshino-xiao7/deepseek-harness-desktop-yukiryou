import { describe, expect, it, vi } from 'vitest';

import type { AppLog } from './diagnostics/app-log.js';
import {
  finalizeApplicationExit,
  handoffApplicationUpdate,
  relaunchAfterStartupFailure,
  startupPreparationFailureLogDetails,
  waitForApplicationExitCleanup,
} from './startup-recovery.js';

describe('startup recovery', () => {
  it('starts the native update handoff before destroying the last Windows window', async () => {
    const calls: string[] = [];
    let applicationExitStarted = false;

    await handoffApplicationUpdate({
      log: undefined,
      handoff: async () => {
        expect(applicationExitStarted).toBe(false);
        calls.push('handoff');
        await Promise.resolve();
        calls.push('installer-confirmed');
        return true;
      },
      cleanup: async () => {
        applicationExitStarted = true;
        calls.push('stop-runtime');
        await Promise.resolve();
        calls.push('destroy-last-window');
      },
      dispose: () => calls.push('dispose-updater'),
      quit: () => calls.push('quit'),
    });

    expect(calls).toEqual([
      'handoff',
      'installer-confirmed',
      'stop-runtime',
      'destroy-last-window',
      'dispose-updater',
      'quit',
    ]);
  });

  it('relaunches and quits even when the log can no longer be flushed or closed', async () => {
    const calls: string[] = [];
    const log: AppLog = {
      write: () => calls.push('write'),
      flush: vi.fn().mockRejectedValue(new Error('disk full')),
      close: vi.fn().mockRejectedValue(new Error('disk still full')),
    };

    await relaunchAfterStartupFailure({
      log,
      relaunch: () => calls.push('relaunch'),
      dispose: () => calls.push('dispose'),
      quit: () => calls.push('quit'),
    });

    expect(calls).toEqual(['write', 'relaunch', 'dispose', 'quit']);
  });

  it('reaches the terminal exit when log close rejects', async () => {
    const exit = vi.fn();
    const log: AppLog = {
      write: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error('disk full')),
    };

    await finalizeApplicationExit({ log, dispose: vi.fn(), exit });

    expect(exit).toHaveBeenCalledOnce();
  });

  it('does not let a cleanup promise that never settles block terminal exit', async () => {
    vi.useFakeTimers();
    try {
      let completed = false;
      const cleanup = waitForApplicationExitCleanup(
        () => new Promise<void>(() => {}),
        25,
      ).then(() => {
        completed = true;
      });

      await vi.advanceTimersByTimeAsync(24);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await cleanup;
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs only an error code and type for preparation failures', () => {
    const error = Object.assign(
      new Error('ENOSPC: no space left, copy /Users/private/runtime'),
      { code: 'ENOSPC' },
    );

    expect(startupPreparationFailureLogDetails(error)).toBe(
      'stage=runtime-preparation code=ENOSPC error=Error',
    );
    expect(startupPreparationFailureLogDetails(error)).not.toContain(
      '/Users/private/runtime',
    );
  });
});
