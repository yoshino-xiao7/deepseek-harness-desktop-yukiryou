import { describe, expect, it, vi } from 'vitest';

import { createManagedPluginRollback } from './managed-plugin-rollback.js';

const request = {
  requestId: 'request-11111111-1111-4111-8111-111111111111',
  packageName: '@example/dsh-tool',
  version: '2.0.0',
  generation: `gen-${'a'.repeat(64)}`,
};
const receipt = {
  ...request,
  installedAt: '2026-08-22T00:00:00.000Z',
  enabled: true,
  rollbackTarget: {
    version: '1.0.0',
    generation: `gen-${'b'.repeat(64)}`,
    installedAt: '2026-08-21T00:00:00.000Z',
  },
  lastBlockedAttempt: null,
};

describe('ManagedPluginRollback', () => {
  it('confirms and prepares an exact rollback target', async () => {
    const prepareRollback = vi.fn(async () => ({ generation: `gen-${'c'.repeat(64)}` }));
    const scheduleRestart = vi.fn();
    const rollback = createManagedPluginRollback({
      bootstrap: {
        inventory: async () => ({ currentGeneration: request.generation, entries: [receipt] }),
        prepareRollback,
      },
      confirm: async () => true,
      runtimeAvailable: () => true,
      scheduleRestart,
    });

    await expect(rollback.execute(request)).resolves.toEqual({
      requestId: request.requestId,
      status: 'prepared',
      restartScheduled: true,
    });
    expect(prepareRollback).toHaveBeenCalledWith({
      packageName: request.packageName,
      version: request.version,
      generation: request.generation,
    });
    expect(scheduleRestart).toHaveBeenCalledOnce();
  });

  it('rejects a receipt without a rollback target', async () => {
    const rollback = createManagedPluginRollback({
      bootstrap: {
        inventory: async () => ({
          currentGeneration: request.generation,
          entries: [{ ...receipt, rollbackTarget: null }],
        }),
        prepareRollback: vi.fn(),
      },
      confirm: async () => true,
      runtimeAvailable: () => true,
      scheduleRestart: vi.fn(),
    });

    await expect(rollback.execute(request)).resolves.toEqual({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'receipt-mismatch',
    });
  });
});
