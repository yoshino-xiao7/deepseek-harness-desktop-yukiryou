import { describe, expect, it } from 'vitest';

import {
  validatedManagedPluginInventoryRequest,
  validatedManagedPluginInventoryResult,
  validatedManagedPluginRemoveRequest,
  validatedManagedPluginRemoveResult,
  validatedManagedPluginSetEnabledRequest,
  validatedManagedPluginSetEnabledResult,
  validatedExternalPluginControlRequest,
  validatedExternalPluginControlResult,
} from './managed-plugin-inventory.js';

const requestId = 'request-12345678-1234-1234-1234-123456789abc';
const generation = `gen-${'a'.repeat(64)}`;

describe('managed plugin inventory boundary', () => {
  it('accepts a bounded inventory snapshot', () => {
    expect(validatedManagedPluginInventoryResult({
      requestId,
      status: 'ready',
      currentGeneration: generation,
      entries: [{
        packageName: '@example/dsh-tool',
        sourceId: 'dshfind',
        version: '1.2.3',
        generation,
        installedAt: '2026-08-21T12:41:40.475Z',
        enabled: true,
        rollbackTarget: {
          version: '1.2.2',
          generation: `gen-${'b'.repeat(64)}`,
          installedAt: '2026-08-20T12:41:40.475Z',
        },
        lastBlockedAttempt: {
          version: '1.2.4',
          reason: 'runtime-unhealthy',
          blockedAt: '2026-08-22T00:00:00.000Z',
        },
      }],
      externalEntries: [{
        packageName: 'dsh-grok-provider', version: '0.1.1', entryIds: ['llm-grok'],
        enabled: true, allowedActions: ['disable', 'uninstall'],
      }],
    })).toMatchObject({
      status: 'ready',
      entries: [{ packageName: '@example/dsh-tool', sourceId: 'dshfind', rollbackTarget: { version: '1.2.2' } }],
    });
  });

  it('validates exact external package controls without accepting path-like identities', () => {
    expect(validatedExternalPluginControlRequest({
      requestId, packageName: 'dsh-grok-provider', version: '0.1.1',
      entryId: 'llm-grok', action: 'disable',
    })).toMatchObject({ packageName: 'dsh-grok-provider', action: 'disable' });
    expect(validatedExternalPluginControlRequest({
      requestId, packageName: '../plugin', version: '0.1.1',
      entryId: 'llm-grok', action: 'uninstall',
    })).toBeUndefined();
    expect(validatedExternalPluginControlResult({
      requestId, status: 'prepared', restartScheduled: true,
    })).toEqual({ requestId, status: 'prepared', restartScheduled: true });
  });

  it('rejects duplicate packages and malformed timestamps', () => {
    const entry = {
      packageName: 'dsh-tool', version: '1.0.0', generation,
      installedAt: '2026-08-21T12:41:40.475Z', enabled: true, lastBlockedAttempt: null,
      rollbackTarget: null,
    };
    expect(validatedManagedPluginInventoryResult({
      requestId, status: 'ready', currentGeneration: generation, entries: [entry, entry],
    })).toBeUndefined();
    expect(validatedManagedPluginInventoryResult({
      requestId, status: 'ready', currentGeneration: generation,
      entries: [{ ...entry, installedAt: '2026-08-21 12:41' }],
    })).toBeUndefined();
    expect(validatedManagedPluginInventoryResult({
      requestId, status: 'ready', currentGeneration: generation, entries: [],
      externalEntries: [{
        packageName: 'dsh-grok-provider', version: '0.1.1', entryIds: ['../escape'],
        enabled: true, allowedActions: ['uninstall'],
      }],
    })).toBeUndefined();
  });

  it('accepts only generated request identifiers', () => {
    expect(validatedManagedPluginInventoryRequest({ requestId })).toEqual({ requestId });
    expect(validatedManagedPluginInventoryRequest({ requestId: 'request-manual' })).toBeUndefined();
  });

  it('validates exact managed removal identities and results', () => {
    expect(validatedManagedPluginRemoveRequest({
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation,
      ignored: true,
    })).toEqual({ requestId, packageName: '@example/dsh-tool', version: '1.2.3', generation });
    expect(validatedManagedPluginRemoveRequest({
      requestId, packageName: '../escape', version: '1.2.3', generation,
    })).toBeUndefined();
    expect(validatedManagedPluginRemoveResult({
      requestId, status: 'prepared', restartScheduled: true,
    })).toEqual({ requestId, status: 'prepared', restartScheduled: true });
  });

  it('validates exact managed enabled-state requests and results', () => {
    expect(validatedManagedPluginSetEnabledRequest({
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation,
      enabled: false,
    })).toEqual({
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation,
      enabled: false,
    });
    expect(validatedManagedPluginSetEnabledRequest({
      requestId, packageName: '@example/dsh-tool', version: '1.2.3', generation,
    })).toBeUndefined();
    expect(validatedManagedPluginSetEnabledResult({
      requestId, status: 'prepared', restartScheduled: true,
    })).toMatchObject({ status: 'prepared' });
  });
});
