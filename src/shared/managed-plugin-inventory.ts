export const MANAGED_PLUGIN_INVENTORY_REQUEST_CHANNEL =
  'deepseek-yukiryou:managed-plugin:inventory-request';
export const MANAGED_PLUGIN_INVENTORY_RESULT_CHANNEL =
  'deepseek-yukiryou:managed-plugin:inventory-result';
export const MANAGED_PLUGIN_REMOVE_REQUEST_CHANNEL =
  'deepseek-yukiryou:managed-plugin:remove-request';
export const MANAGED_PLUGIN_REMOVE_RESULT_CHANNEL =
  'deepseek-yukiryou:managed-plugin:remove-result';
export const MANAGED_PLUGIN_SET_ENABLED_REQUEST_CHANNEL =
  'deepseek-yukiryou:managed-plugin:set-enabled-request';
export const MANAGED_PLUGIN_SET_ENABLED_RESULT_CHANNEL =
  'deepseek-yukiryou:managed-plugin:set-enabled-result';
export const MANAGED_PLUGIN_ROLLBACK_REQUEST_CHANNEL =
  'deepseek-yukiryou:managed-plugin:rollback-request';
export const MANAGED_PLUGIN_ROLLBACK_RESULT_CHANNEL =
  'deepseek-yukiryou:managed-plugin:rollback-result';

const REQUEST_ID = /^request-[a-f0-9-]{36}$/u;
const GENERATION = /^gen-[a-f0-9]{64}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/u;

export interface ManagedPluginInventoryRequest {
  readonly requestId: string;
}

export interface ManagedPluginRemoveRequest {
  readonly requestId: string;
  readonly packageName: string;
  readonly version: string;
  readonly generation: string;
}

export interface ManagedPluginSetEnabledRequest extends ManagedPluginRemoveRequest {
  readonly enabled: boolean;
}

export type ManagedPluginRollbackRequest = ManagedPluginRemoveRequest;

export type ManagedPluginRemoveResult =
  | { readonly requestId: string; readonly status: 'cancelled' }
  | { readonly requestId: string; readonly status: 'prepared'; readonly restartScheduled: true }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason: 'runtime-unavailable' | 'receipt-mismatch' | 'busy' | 'failed';
    };

export type ManagedPluginSetEnabledResult = ManagedPluginRemoveResult;
export type ManagedPluginRollbackResult = ManagedPluginRemoveResult;

export interface ManagedPluginInventoryEntry {
  readonly packageName: string;
  readonly sourceId: string;
  readonly version: string;
  readonly generation: string;
  readonly installedAt: string;
  readonly enabled: boolean;
  readonly rollbackTarget: {
    readonly version: string;
    readonly generation: string;
    readonly installedAt: string;
  } | null;
  readonly lastBlockedAttempt: {
    readonly version: string;
    readonly reason: 'startup-interrupted' | 'runtime-unhealthy';
    readonly blockedAt: string;
  } | null;
}

export type ManagedPluginInventoryResult =
  | {
      readonly requestId: string;
      readonly status: 'ready';
      readonly currentGeneration: string | null;
      readonly entries: readonly ManagedPluginInventoryEntry[];
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason: 'runtime-unavailable' | 'invalid-response';
    };

export function validatedManagedPluginInventoryRequest(
  value: unknown,
): ManagedPluginInventoryRequest | undefined {
  return isRecord(value) && validRequestId(value.requestId)
    ? { requestId: value.requestId }
    : undefined;
}

export function validatedManagedPluginRemoveRequest(
  value: unknown,
): ManagedPluginRemoveRequest | undefined {
  if (!isRecord(value) || !validRequestId(value.requestId) ||
    !validPackageName(value.packageName) || !boundedString(value.version, 100) ||
    !validGeneration(value.generation)) return undefined;
  return {
    requestId: value.requestId,
    packageName: value.packageName,
    version: value.version,
    generation: value.generation,
  };
}

export function validatedManagedPluginSetEnabledRequest(
  value: unknown,
): ManagedPluginSetEnabledRequest | undefined {
  const request = validatedManagedPluginRemoveRequest(value);
  if (request === undefined || !isRecord(value) || typeof value.enabled !== 'boolean') {
    return undefined;
  }
  return { ...request, enabled: value.enabled };
}

export function validatedManagedPluginRemoveResult(
  value: unknown,
): ManagedPluginRemoveResult | undefined {
  if (!isRecord(value) || !validRequestId(value.requestId)) return undefined;
  const requestId = value.requestId;
  if (value.status === 'cancelled') return { requestId, status: 'cancelled' };
  if (value.status === 'prepared' && value.restartScheduled === true) {
    return { requestId, status: 'prepared', restartScheduled: true };
  }
  if (value.status === 'unavailable' &&
    (value.reason === 'runtime-unavailable' || value.reason === 'receipt-mismatch' ||
      value.reason === 'busy' || value.reason === 'failed')) {
    return { requestId, status: 'unavailable', reason: value.reason };
  }
  return undefined;
}

export const validatedManagedPluginSetEnabledResult = validatedManagedPluginRemoveResult;
export const validatedManagedPluginRollbackRequest = validatedManagedPluginRemoveRequest;
export const validatedManagedPluginRollbackResult = validatedManagedPluginRemoveResult;

export function validatedManagedPluginInventoryResult(
  value: unknown,
): ManagedPluginInventoryResult | undefined {
  if (!isRecord(value) || !validRequestId(value.requestId)) return undefined;
  const requestId = value.requestId;
  if (value.status === 'unavailable' &&
    (value.reason === 'runtime-unavailable' || value.reason === 'invalid-response')) {
    return { requestId, status: 'unavailable', reason: value.reason };
  }
  if (value.status !== 'ready' ||
    (value.currentGeneration !== null && !validGeneration(value.currentGeneration)) ||
    !Array.isArray(value.entries) || value.entries.length > 1_000) return undefined;
  const entries: ManagedPluginInventoryEntry[] = [];
  const packages = new Set<string>();
  for (const item of value.entries) {
    const entry = validatedEntry(item);
    if (entry === undefined || packages.has(entry.packageName)) return undefined;
    packages.add(entry.packageName);
    entries.push(entry);
  }
  return {
    requestId,
    status: 'ready',
    currentGeneration: value.currentGeneration,
    entries,
  };
}

function validatedEntry(value: unknown): ManagedPluginInventoryEntry | undefined {
  if (!isRecord(value) || !validPackageName(value.packageName) ||
    typeof value.sourceId !== 'string' || !SOURCE_ID.test(value.sourceId) ||
    !boundedString(value.version, 100) || !validGeneration(value.generation) ||
    !validIsoDate(value.installedAt) || typeof value.enabled !== 'boolean') return undefined;
  let rollbackTarget: ManagedPluginInventoryEntry['rollbackTarget'] = null;
  if (value.rollbackTarget !== null) {
    if (!isRecord(value.rollbackTarget) ||
      !boundedString(value.rollbackTarget.version, 100) ||
      !validGeneration(value.rollbackTarget.generation) ||
      !validIsoDate(value.rollbackTarget.installedAt)) return undefined;
    rollbackTarget = {
      version: value.rollbackTarget.version,
      generation: value.rollbackTarget.generation,
      installedAt: value.rollbackTarget.installedAt,
    };
  }
  let lastBlockedAttempt: ManagedPluginInventoryEntry['lastBlockedAttempt'] = null;
  if (value.lastBlockedAttempt !== null) {
    if (!isRecord(value.lastBlockedAttempt) ||
      !boundedString(value.lastBlockedAttempt.version, 100) ||
      (value.lastBlockedAttempt.reason !== 'startup-interrupted' &&
        value.lastBlockedAttempt.reason !== 'runtime-unhealthy') ||
      !validIsoDate(value.lastBlockedAttempt.blockedAt)) return undefined;
    lastBlockedAttempt = {
      version: value.lastBlockedAttempt.version,
      reason: value.lastBlockedAttempt.reason,
      blockedAt: value.lastBlockedAttempt.blockedAt,
    };
  }
  return {
    packageName: value.packageName,
    sourceId: value.sourceId,
    version: value.version,
    generation: value.generation,
    installedAt: value.installedAt,
    enabled: value.enabled,
    rollbackTarget,
    lastBlockedAttempt,
  };
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

function validGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION.test(value);
}

function validPackageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 214 && PACKAGE_NAME.test(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
