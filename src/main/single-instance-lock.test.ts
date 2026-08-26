import { describe, expect, it, vi } from 'vitest';

import { acquireSingleInstanceLock } from './single-instance-lock.js';

describe('single instance lock acquisition', () => {
  it('waits for the updater predecessor to release the lock', async () => {
    const request = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(acquireSingleInstanceLock({
      request,
      delay,
      maxAttempts: 9,
    })).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(500);
  });

  it('remains bounded for a genuine duplicate launch', async () => {
    const request = vi.fn().mockReturnValue(false);
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(acquireSingleInstanceLock({
      request,
      delay,
      maxAttempts: 3,
    })).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });
});
