export const MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL =
  'deepseek-yukiryou:managed-plugin:preview-request';
export const MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL =
  'deepseek-yukiryou:managed-plugin:preview-result';
export const MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL =
  'deepseek-yukiryou:managed-plugin:execute-request';
export const MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL =
  'deepseek-yukiryou:managed-plugin:execute-result';

const REQUEST_ID = /^request-[a-f0-9-]{36}$/u;
const PREVIEW_ID = /^preview-[a-f0-9-]{36}$/u;
const GENERATION = /^gen-[a-f0-9]{64}$/u;

export interface ManagedPluginPreviewRequest {
  readonly requestId: string;
  readonly sourceRecordId: string;
  readonly itemId: string;
  readonly versionPreference: 'catalog' | 'latest';
}

export interface ManagedPluginExecuteRequest {
  readonly requestId: string;
  readonly previewId: string;
}

export type ManagedPluginExecuteResult =
  | { readonly requestId: string; readonly status: 'cancelled' }
  | {
      readonly requestId: string;
      readonly status: 'prepared';
      readonly restartScheduled: true;
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason: 'runtime-unavailable' | 'preview-unavailable' | 'busy' | 'failed';
    };

export interface ManagedPluginPreviewSummary {
  readonly packageName: string;
  readonly version: string;
  readonly artifact: {
    readonly verifiedArtifacts: number;
    readonly verifiedCompressedBytes: number;
    readonly verifiedUnpackedBytes: number;
    readonly verifiedFileCount: number;
  };
  readonly dependencies: {
    readonly direct: number;
    readonly peers: number;
    readonly nodes: number;
    readonly edges: number;
    readonly maxDepth: number;
    readonly peerRequirements: number;
    readonly peerSatisfied: number;
    readonly peerOptionalMissing: number;
    readonly optionalSkipped: number;
  };
  readonly lifecycleScripts: readonly string[];
}

export type ManagedPluginInstallOperation =
  | { readonly kind: 'install' }
  | {
      readonly kind: 'reinstall' | 'update';
      readonly currentVersion: string;
    };

export type ManagedPluginPreviewResult =
  | {
      readonly requestId: string;
      readonly status: 'ready';
      readonly previewId: string;
      readonly profileGeneration: string;
      readonly expiresInSeconds: number;
      readonly operation: ManagedPluginInstallOperation;
      readonly summary: ManagedPluginPreviewSummary;
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason: 'runtime-unavailable' | 'not-installable' | 'busy' | 'invalid-response';
    };

export function validatedManagedPluginPreviewRequest(
  value: unknown,
): ManagedPluginPreviewRequest | undefined {
  if (!isRecord(value) || !validRequestId(value.requestId)) return undefined;
  const sourceRecordId = boundedString(value.sourceRecordId, 100);
  const itemId = boundedString(value.itemId, 320);
  const versionPreference = value.versionPreference;
  if (sourceRecordId === undefined || itemId === undefined ||
    (versionPreference !== 'catalog' && versionPreference !== 'latest')) return undefined;
  return { requestId: value.requestId as string, sourceRecordId, itemId, versionPreference };
}

export function validatedManagedPluginPreviewResult(
  value: unknown,
): ManagedPluginPreviewResult | undefined {
  if (!isRecord(value) || !validRequestId(value.requestId)) return undefined;
  const requestId = value.requestId as string;
  if (value.status === 'unavailable' && isUnavailableReason(value.reason)) {
    return { requestId, status: 'unavailable', reason: value.reason };
  }
  if (
    value.status !== 'ready' ||
    typeof value.previewId !== 'string' ||
    !PREVIEW_ID.test(value.previewId) ||
    typeof value.profileGeneration !== 'string' ||
    !GENERATION.test(value.profileGeneration) ||
    !safeCount(value.expiresInSeconds, 300) ||
    Number(value.expiresInSeconds) < 1
  )
    return undefined;
  const summary = validatedNormalizedSummary(value.summary);
  const operation = validatedOperation(value.operation);
  if (summary === undefined || operation === undefined) return undefined;
  return {
    requestId,
    status: 'ready',
    previewId: value.previewId,
    profileGeneration: value.profileGeneration,
    expiresInSeconds: value.expiresInSeconds as number,
    operation,
    summary,
  };
}

function validatedOperation(value: unknown): ManagedPluginInstallOperation | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'install') return { kind: 'install' };
  if (
    (value.kind === 'reinstall' || value.kind === 'update') &&
    boundedString(value.currentVersion, 100) !== undefined
  ) {
    return { kind: value.kind, currentVersion: value.currentVersion as string };
  }
  return undefined;
}

export function validatedManagedPluginExecuteRequest(
  value: unknown,
): ManagedPluginExecuteRequest | undefined {
  if (
    !isRecord(value) ||
    !validRequestId(value.requestId) ||
    typeof value.previewId !== 'string' ||
    !PREVIEW_ID.test(value.previewId)
  )
    return undefined;
  return { requestId: value.requestId, previewId: value.previewId };
}

export function validatedManagedPluginExecuteResult(
  value: unknown,
): ManagedPluginExecuteResult | undefined {
  if (!isRecord(value) || !validRequestId(value.requestId)) return undefined;
  const requestId = value.requestId;
  if (value.status === 'cancelled') return { requestId, status: 'cancelled' };
  if (value.status === 'prepared' && value.restartScheduled === true) {
    return { requestId, status: 'prepared', restartScheduled: true };
  }
  if (value.status === 'unavailable' && isExecuteUnavailableReason(value.reason)) {
    return { requestId, status: 'unavailable', reason: value.reason };
  }
  return undefined;
}

/** Reduces the Host inspection to the exact fields the confirmation UI needs. */
export function validatedManagedPluginPreviewSummary(
  value: unknown,
): ManagedPluginPreviewSummary | undefined {
  if (!isRecord(value) || value.status !== 'artifact-verified' || value.executionReady !== false) {
    return undefined;
  }
  const identity = value.identity;
  const artifact = value.artifact;
  const dependencies = value.dependencySummary;
  if (!isRecord(identity) || !isRecord(artifact) || !isRecord(dependencies)) return undefined;
  const packageName = boundedString(identity.packageName, 214);
  const version = boundedString(identity.version, 100);
  if (packageName === undefined || version === undefined) return undefined;
  const artifactSummary = counts(artifact, [
    ['verifiedArtifacts', 10_000],
    ['verifiedCompressedBytes', Number.MAX_SAFE_INTEGER],
    ['verifiedUnpackedBytes', Number.MAX_SAFE_INTEGER],
    ['verifiedFileCount', 10_000_000],
  ] as const);
  const dependencySummary = counts(dependencies, [
    ['direct', 10_000],
    ['peers', 10_000],
    ['nodes', 100_000],
    ['edges', 1_000_000],
    ['maxDepth', 1_000],
    ['peerRequirements', 100_000],
    ['peerSatisfied', 100_000],
    ['peerOptionalMissing', 100_000],
    ['optionalSkipped', 100_000],
  ] as const);
  const lifecycleScripts = stringList(value.lifecycleScripts, 64, 100);
  if (
    artifactSummary === undefined ||
    dependencySummary === undefined ||
    lifecycleScripts === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    packageName,
    version,
    artifact: Object.freeze(artifactSummary),
    dependencies: Object.freeze(dependencySummary),
    lifecycleScripts: Object.freeze(lifecycleScripts),
  });
}

function validatedNormalizedSummary(value: unknown): ManagedPluginPreviewSummary | undefined {
  if (!isRecord(value)) return undefined;
  const packageName = boundedString(value.packageName, 214);
  const version = boundedString(value.version, 100);
  if (
    packageName === undefined ||
    version === undefined ||
    !isRecord(value.artifact) ||
    !isRecord(value.dependencies)
  )
    return undefined;
  const artifact = counts(value.artifact, [
    ['verifiedArtifacts', 10_000],
    ['verifiedCompressedBytes', Number.MAX_SAFE_INTEGER],
    ['verifiedUnpackedBytes', Number.MAX_SAFE_INTEGER],
    ['verifiedFileCount', 10_000_000],
  ] as const);
  const dependencies = counts(value.dependencies, [
    ['direct', 10_000],
    ['peers', 10_000],
    ['nodes', 100_000],
    ['edges', 1_000_000],
    ['maxDepth', 1_000],
    ['peerRequirements', 100_000],
    ['peerSatisfied', 100_000],
    ['peerOptionalMissing', 100_000],
    ['optionalSkipped', 100_000],
  ] as const);
  const lifecycleScripts = stringList(value.lifecycleScripts, 64, 100);
  if (artifact === undefined || dependencies === undefined || lifecycleScripts === undefined)
    return undefined;
  return Object.freeze({
    packageName,
    version,
    artifact: Object.freeze(artifact),
    dependencies: Object.freeze(dependencies),
    lifecycleScripts: Object.freeze(lifecycleScripts),
  });
}

function counts<const T extends readonly (readonly [string, number])[]>(
  value: Record<string, unknown>,
  fields: T,
): { [K in T[number][0]]: number } | undefined {
  const result: Record<string, number> = {};
  for (const [field, maximum] of fields) {
    if (!safeCount(value[field], maximum)) return undefined;
    result[field] = value[field] as number;
  }
  return result as { [K in T[number][0]]: number };
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const result: string[] = [];
  for (const item of value) {
    const entry = boundedString(item, maximumLength);
    if (entry === undefined) return undefined;
    result.push(entry);
  }
  return result;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function safeCount(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function isUnavailableReason(
  value: unknown,
): value is Extract<ManagedPluginPreviewResult, { status: 'unavailable' }>['reason'] {
  return (
    value === 'runtime-unavailable' ||
    value === 'not-installable' ||
    value === 'busy' ||
    value === 'invalid-response'
  );
}

function isExecuteUnavailableReason(
  value: unknown,
): value is Extract<ManagedPluginExecuteResult, { status: 'unavailable' }>['reason'] {
  return (
    value === 'runtime-unavailable' ||
    value === 'preview-unavailable' ||
    value === 'busy' ||
    value === 'failed'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
