import { describe, expect, it } from 'vitest';

import {
  explainPluginInventoryEntry,
  pluginInventoryState,
  pluginOwnership,
} from './plugin-inventory.js';

describe('plugin inventory explanation', () => {
  it('distinguishes app, Runtime dependency, and external provenance', () => {
    expect(pluginOwnership('@dsh-desktop/settings')).toBe('system');
    expect(pluginOwnership('@deepseek-ai/dsh-client-ui-settings')).toBe('system');
    expect(pluginOwnership('@deepseek-ai/cordis-plugin-loader')).toBe('dependency');
    expect(pluginOwnership('cordis:include')).toBe('dependency');
    expect(pluginOwnership('@community/example')).toBe('external');
  });

  it('derives state from effective enablement before fiber phase', () => {
    expect(pluginInventoryState({
      entryId: 'disabled', moduleName: '@deepseek-ai/dsh-example',
      enabled: false, fiberPhase: 'active',
    })).toBe('disabled');
    expect(pluginInventoryState({
      entryId: 'waiting', moduleName: '@deepseek-ai/dsh-example',
      enabled: true, fiberPhase: 'pending',
    })).toBe('waiting');
    expect(pluginInventoryState({
      entryId: 'failed', moduleName: '@deepseek-ai/dsh-example',
      enabled: true, fiberPhase: 'failed',
    })).toBe('failed');
  });

  it('keeps every Phase 0 item read-only and explains why', () => {
    expect(explainPluginInventoryEntry({
      entryId: 'loader', moduleName: '@deepseek-ai/cordis-plugin-loader',
      enabled: true, fiberPhase: 'active',
    })).toMatchObject({
      displayName: 'cordis-plugin-loader',
      ownership: 'dependency',
      state: 'active',
      mutable: false,
      allowedActions: [],
      reason: 'dependency-only',
    });
    expect(explainPluginInventoryEntry({
      entryId: 'community', moduleName: '@community/example',
      enabled: false, fiberPhase: null,
    })).toMatchObject({
      ownership: 'external',
      state: 'disabled',
      reason: 'external-readonly',
    });
  });
});
