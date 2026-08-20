import { describe, expect, it, vi } from 'vitest';

import type { AppLog } from './diagnostics/app-log.js';
import {
  finalizeApplicationExit,
  relaunchAfterStartupFailure,
  startupPreparationFailureLogDetails,
} from './startup-recovery.js';

describe('startup recovery', () => {
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
