import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  loadProductDocument,
  navigateProductDocument,
  resetProductDocument,
} from './product-document-navigation.js';

describe('product document navigation', () => {
  it('accepts a resolved Electron loadURL when no finish event is emitted', async () => {
    const events = new EventEmitter();
    const target = {
      once: events.once.bind(events),
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
      loadURL: vi.fn(async () => undefined),
    };

    await expect(navigateProductDocument(target, 'http://127.0.0.1:51234/'))
      .resolves.toBeUndefined();
  });

  it('uses the main-document finish event when Electron leaves loadURL pending', async () => {
    const events = new EventEmitter();
    const target = {
      once: events.once.bind(events),
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
      loadURL: vi.fn(() => {
        queueMicrotask(() => events.emit('did-finish-load'));
        return new Promise<void>(() => undefined);
      }),
    };

    await expect(navigateProductDocument(target, 'http://127.0.0.1:51234/'))
      .resolves.toBeUndefined();
  });

  it('does not reset before a successful first navigation', async () => {
    const reset = vi.fn(async () => undefined);

    await loadProductDocument(async () => undefined, 15_000, reset);

    expect(reset).not.toHaveBeenCalled();
  });

  it('resets an already loaded product document before the first navigation', async () => {
    const calls: string[] = [];
    const reset = vi.fn(async () => {
      calls.push('reset');
    });
    const load = vi.fn(async () => {
      calls.push('load');
    });

    await loadProductDocument(load, 15_000, reset, true);

    expect(calls).toEqual(['reset', 'load']);
  });

  it('primes a fresh hidden view with about:blank before a retry', async () => {
    const target = {
      stop: vi.fn(),
      getURL: vi.fn(() => ''),
      loadURL: vi.fn(async () => undefined),
    };

    await resetProductDocument(target);

    expect(target.stop).toHaveBeenCalledOnce();
    expect(target.loadURL).toHaveBeenCalledWith('about:blank');
  });

  it('accepts Electron ERR_ABORTED while cancelling a stale navigation', async () => {
    const aborted = Object.assign(new Error(" (-3) loading 'about:blank'"), {
      code: 'ERR_ABORTED',
      errno: -3,
    });
    const target = {
      stop: vi.fn(),
      getURL: vi.fn(() => 'http://127.0.0.1:51234/'),
      loadURL: vi.fn(async () => Promise.reject(aborted)),
    };

    await expect(resetProductDocument(target)).resolves.toBeUndefined();
  });

  it('retries one cold navigation timeout before reporting product startup failure', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn()
        .mockImplementationOnce(() => new Promise<void>(() => undefined))
        .mockResolvedValueOnce(undefined);
      const navigation = loadProductDocument(load, 15_000);
      const result = expect(navigation).resolves.toBeUndefined();

      await vi.advanceTimersByTimeAsync(15_000);
      await result;
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets a stale product document before the retry navigation', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const reset = vi.fn(async () => {
        calls.push('reset');
      });
      const load = vi.fn()
        .mockImplementationOnce(() => {
          calls.push('load');
          return new Promise<void>(() => undefined);
        })
        .mockImplementationOnce(async () => {
          calls.push('load');
        });
      const navigation = loadProductDocument(load, 15_000, reset);
      const result = expect(navigation).resolves.toBeUndefined();

      await vi.advanceTimersByTimeAsync(15_000);
      await result;
      expect(calls).toEqual(['load', 'reset', 'load']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a product navigation that never settles', async () => {
    vi.useFakeTimers();
    try {
      const navigation = loadProductDocument(
        () => new Promise<void>(() => undefined),
        15_000,
      );

      const rejection = expect(navigation).rejects.toThrow(
        'Product document navigation timed out after 15000ms',
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
