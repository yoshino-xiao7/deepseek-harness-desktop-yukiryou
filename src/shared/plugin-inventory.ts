export type PluginOwnership = 'system' | 'dependency' | 'external';
export type PluginInventoryState =
  | 'active'
  | 'disabled'
  | 'waiting'
  | 'failed'
  | 'unavailable';

export interface RuntimePluginInventoryEntry {
  readonly entryId: string;
  readonly moduleName: string;
  readonly enabled: boolean;
  readonly fiberPhase:
    | 'pending'
    | 'loading'
    | 'active'
    | 'failed'
    | 'unloading'
    | null;
}

export interface ExplainedPluginInventoryItem {
  readonly id: string;
  readonly displayName: string;
  readonly moduleName: string;
  readonly ownership: PluginOwnership;
  readonly state: PluginInventoryState;
  readonly mutable: false;
  readonly allowedActions: readonly [];
  readonly reason: 'app-bundled' | 'runtime-bundled' | 'dependency-only' | 'external-readonly';
}

/**
 * Phase 0 is deliberately a read-only projection of the bundled Runtime's authoritative
 * Loader snapshot. Ownership is deployment provenance, not a security claim.
 */
export function explainPluginInventoryEntry(
  entry: RuntimePluginInventoryEntry,
): ExplainedPluginInventoryItem {
  const ownership = pluginOwnership(entry.moduleName);
  return {
    id: entry.entryId,
    displayName: shortPluginName(entry.moduleName),
    moduleName: entry.moduleName,
    ownership,
    state: pluginInventoryState(entry),
    mutable: false,
    allowedActions: [],
    reason:
      ownership === 'dependency'
        ? 'dependency-only'
        : ownership === 'system'
          ? entry.moduleName.startsWith('@dsh-desktop/')
            ? 'app-bundled'
            : 'runtime-bundled'
          : 'external-readonly',
  };
}

export function pluginOwnership(moduleName: string): PluginOwnership {
  if (
    moduleName.startsWith('cordis:') ||
    moduleName.startsWith('@deepseek-ai/cordis') ||
    moduleName.startsWith('cordis-plugin-')
  ) {
    return 'dependency';
  }
  if (
    moduleName.startsWith('@dsh-desktop/') ||
    moduleName.startsWith('@deepseek-ai/dsh-')
  ) {
    return 'system';
  }
  return 'external';
}

export function pluginInventoryState(
  entry: RuntimePluginInventoryEntry,
): PluginInventoryState {
  if (!entry.enabled) return 'disabled';
  if (entry.fiberPhase === 'active') return 'active';
  if (entry.fiberPhase === 'failed') return 'failed';
  if (entry.fiberPhase === 'pending' || entry.fiberPhase === 'loading') {
    return 'waiting';
  }
  return 'unavailable';
}

export function shortPluginName(moduleName: string): string {
  const segments = moduleName.split('/');
  return segments.at(-1) || moduleName;
}
