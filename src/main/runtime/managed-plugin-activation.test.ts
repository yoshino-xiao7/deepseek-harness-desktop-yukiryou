import { describe, expect, it, vi } from 'vitest';

import { createManagedPluginActivation } from './managed-plugin-activation.js';

const request = {
  requestId: 'request-12345678-1234-1234-1234-123456789abc',
  packageName: '@example/dsh-tool',
  version: '1.2.3',
  generation: `gen-${'a'.repeat(64)}`,
  enabled: false,
};
const receipt = {
  packageName: request.packageName,
  version: request.version,
  generation: request.generation,
  installedAt: '2026-08-22T02:00:00.000Z',
  enabled: true,
  rollbackTarget: null,
  lastBlockedAttempt: null,
};

describe('ManagedPluginActivation', () => {
  it('confirms and prepares an exact enabled-state transition', async () => {
    const prepareEnabled = vi.fn(async () => ({ generation: `gen-${'b'.repeat(64)}` }));
    const scheduleRestart = vi.fn();
    const activation = createManagedPluginActivation({
      bootstrap: {
        inventory: async () => ({ currentGeneration: request.generation, entries: [receipt] }),
        prepareEnabled,
      },
      confirm: vi.fn(async () => true),
      runtimeAvailable: () => true,
      scheduleRestart,
    });

    await expect(activation.execute(request)).resolves.toMatchObject({
      status: 'prepared', restartScheduled: true,
    });
    expect(prepareEnabled).toHaveBeenCalledWith({
      packageName: request.packageName,
      version: request.version,
      generation: request.generation,
      enabled: false,
    });
    expect(scheduleRestart).toHaveBeenCalledOnce();
  });

  it('rejects redundant or stale receipt transitions without mutation', async () => {
    const prepareEnabled = vi.fn();
    const activation = createManagedPluginActivation({
      bootstrap: {
        inventory: async () => ({
          currentGeneration: request.generation,
          entries: [{ ...receipt, enabled: false }],
        }),
        prepareEnabled,
      },
      confirm: vi.fn(async () => true),
      runtimeAvailable: () => true,
      scheduleRestart: vi.fn(),
    });

    await expect(activation.execute(request)).resolves.toMatchObject({
      status: 'unavailable', reason: 'receipt-mismatch',
    });
    expect(prepareEnabled).not.toHaveBeenCalled();
  });

  it('serializes transitions and revalidates state after confirmation', async () => {
    let reads = 0;
    let resolveConfirmation: ((value: boolean) => void) | undefined;
    const prepareEnabled = vi.fn();
    const activation = createManagedPluginActivation({
      bootstrap: {
        inventory: async () => ({
          currentGeneration: request.generation,
          entries: [reads++ === 0 ? receipt : { ...receipt, enabled: false }],
        }),
        prepareEnabled,
      },
      confirm: () => new Promise((resolve) => { resolveConfirmation = resolve; }),
      runtimeAvailable: () => true,
      scheduleRestart: vi.fn(),
    });
    const first = activation.execute(request);
    await Promise.resolve();
    await expect(activation.execute({
      ...request,
      requestId: 'request-99999999-9999-4999-8999-999999999999',
    })).resolves.toMatchObject({ status: 'unavailable', reason: 'busy' });
    resolveConfirmation?.(true);
    await expect(first).resolves.toMatchObject({
      status: 'unavailable', reason: 'receipt-mismatch',
    });
    expect(prepareEnabled).not.toHaveBeenCalled();
  });
});
