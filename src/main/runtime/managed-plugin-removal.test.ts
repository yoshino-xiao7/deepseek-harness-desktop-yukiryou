import { describe, expect, it, vi } from 'vitest';

import { createManagedPluginRemoval } from './managed-plugin-removal.js';

const request = {
  requestId: 'request-12345678-1234-1234-1234-123456789abc',
  packageName: '@example/dsh-tool',
  version: '1.2.3',
  generation: `gen-${'a'.repeat(64)}`,
};
const receipt = {
  packageName: request.packageName,
  version: request.version,
  generation: request.generation,
  installedAt: '2026-08-22T01:00:00.000Z',
  enabled: true,
  rollbackTarget: null,
  lastBlockedAttempt: null,
};

describe('ManagedPluginRemoval', () => {
  it('confirms and prepares an exact current receipt before scheduling restart', async () => {
    const prepareRemoval = vi.fn(async () => ({ generation: `gen-${'b'.repeat(64)}` }));
    const scheduleRestart = vi.fn();
    const removal = createManagedPluginRemoval({
      bootstrap: {
        inventory: async () => ({ currentGeneration: request.generation, entries: [receipt] }),
        prepareRemoval,
      },
      confirm: vi.fn(async () => true),
      runtimeAvailable: () => true,
      scheduleRestart,
    });

    await expect(removal.execute(request)).resolves.toEqual({
      requestId: request.requestId,
      status: 'prepared',
      restartScheduled: true,
    });
    expect(prepareRemoval).toHaveBeenCalledWith({
      packageName: request.packageName,
      version: request.version,
      generation: request.generation,
    });
    expect(scheduleRestart).toHaveBeenCalledOnce();
  });

  it('does not mutate after cancellation or a mismatched receipt', async () => {
    const prepareRemoval = vi.fn();
    const cancelled = createManagedPluginRemoval({
      bootstrap: {
        inventory: async () => ({ currentGeneration: request.generation, entries: [receipt] }),
        prepareRemoval,
      },
      confirm: async () => false,
      runtimeAvailable: () => true,
      scheduleRestart: vi.fn(),
    });
    await expect(cancelled.execute(request)).resolves.toMatchObject({ status: 'cancelled' });

    const mismatched = createManagedPluginRemoval({
      bootstrap: {
        inventory: async () => ({ currentGeneration: request.generation, entries: [] }),
        prepareRemoval,
      },
      confirm: async () => true,
      runtimeAvailable: () => true,
      scheduleRestart: vi.fn(),
    });
    await expect(mismatched.execute(request)).resolves.toMatchObject({
      status: 'unavailable', reason: 'receipt-mismatch',
    });
    expect(prepareRemoval).not.toHaveBeenCalled();
  });

  it('serializes removals and rechecks Runtime after confirmation', async () => {
    let resolveConfirmation: ((value: boolean) => void) | undefined;
    let available = true;
    const removal = createManagedPluginRemoval({
      bootstrap: {
        inventory: async () => ({ currentGeneration: request.generation, entries: [receipt] }),
        prepareRemoval: vi.fn(),
      },
      confirm: () => new Promise((resolve) => { resolveConfirmation = resolve; }),
      runtimeAvailable: () => available,
      scheduleRestart: vi.fn(),
    });
    const first = removal.execute(request);
    await Promise.resolve();
    await expect(removal.execute({ ...request, requestId: 'request-99999999-9999-4999-8999-999999999999' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'busy' });
    available = false;
    resolveConfirmation?.(true);
    await expect(first).resolves.toMatchObject({
      status: 'unavailable', reason: 'runtime-unavailable',
    });
  });
});
