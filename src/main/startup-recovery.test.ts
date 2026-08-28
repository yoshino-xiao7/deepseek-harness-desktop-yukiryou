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
  it('finishes the hard Runtime gate before starting the native updater', async () => {
    const calls: string[] = [];

    await handoffApplicationUpdate({
      prepare: async () => {
        calls.push('stop-runtime-tree');
        await Promise.resolve();
      },
      onHandoffFailure: () => {
        calls.push('handoff-failed');
      },
      persist: async () => {
        calls.push('persist-state');
        await Promise.resolve();
      },
      handoff: async () => {
        calls.push('native-updater');
      },
    });

    expect(calls).toEqual([
      'stop-runtime-tree',
      'persist-state',
      'native-updater',
    ]);
  });

  it('never starts the installer when the Runtime hard gate fails', async () => {
    const failure = new Error('taskkill could not terminate the Runtime tree');
    const onHandoffFailure = vi.fn();
    const persist = vi.fn();
    const handoff = vi.fn();

    await expect(handoffApplicationUpdate({
      prepare: vi.fn().mockRejectedValue(failure),
      onHandoffFailure,
      persist,
      handoff,
    })).resolves.toBe(false);

    expect(onHandoffFailure).toHaveBeenCalledWith(failure);
    expect(persist).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
  });

  it('reports a native handoff failure without a caller-driven quit', async () => {
    const failure = new Error('native updater rejected the handoff');
    const onHandoffFailure = vi.fn();

    await expect(handoffApplicationUpdate({
      prepare: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn(),
      handoff: vi.fn().mockRejectedValue(failure),
      onHandoffFailure,
    })).resolves.toBe(false);

    expect(onHandoffFailure).toHaveBeenCalledWith(failure);
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
