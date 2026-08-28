import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { spawnDetachedInstaller } from './windows-nsis-updater.js';

describe('reliable Windows NSIS update handoff', () => {
  it('keeps the parent alive through the installer ownership window', async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as ChildProcess;
      child.unref = vi.fn().mockReturnValue(child);
      let confirmed = false;
      const handoff = spawnDetachedInstaller(
        'C:\\Cache\\Update Setup.exe',
        ['--updated', '/S', '--force-run'],
        vi.fn().mockReturnValue(child),
        200,
      ).then(() => { confirmed = true; });

      expect(child.unref).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(199);
      expect(confirmed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await handoff;
      expect(confirmed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an asynchronous spawn error before the app is allowed to quit', async () => {
    const child = new EventEmitter() as ChildProcess;
    child.unref = vi.fn().mockReturnValue(child);
    const failure = Object.assign(new Error('access denied'), { code: 'EACCES' });
    const handoff = spawnDetachedInstaller(
      'C:\\Cache\\Update Setup.exe',
      ['--updated'],
      () => child,
      200,
    );
    child.emit('error', failure);
    await expect(handoff).rejects.toBe(failure);
  });
});
