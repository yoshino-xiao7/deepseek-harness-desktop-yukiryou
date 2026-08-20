import type { PetFrameMetrics } from './pet-frame-metrics.js';

export const PET_RUNTIME_BENCHMARK_SCHEMA_VERSION = 1;

export const PET_RUNTIME_CANDIDATES = Object.freeze({
  'rive-canvas-lite': { family: 'rive', renderer: 'canvas-lite' },
  'rive-webgl2': { family: 'rive', renderer: 'webgl2' },
  'dotlottie-software': { family: 'dotlottie', renderer: 'software' },
  'dotlottie-webgl2': { family: 'dotlottie', renderer: 'webgl2' },
  'webm-alpha': { family: 'webm-alpha', renderer: 'chromium-video' },
  'frame-sequence-canvas2d': { family: 'frame-sequence', renderer: 'canvas2d' },
  'layered-rig-canvas2d': { family: 'layered-rig', renderer: 'canvas2d' },
} as const);

export type PetRuntimeCandidateId = keyof typeof PET_RUNTIME_CANDIDATES;
export type PetRuntimeFamily = typeof PET_RUNTIME_CANDIDATES[PetRuntimeCandidateId]['family'];

export interface PetRuntimeBenchmarkRecord {
  readonly schemaVersion: 1;
  readonly candidate: {
    readonly id: PetRuntimeCandidateId;
    readonly family: PetRuntimeFamily;
    readonly adapterVersion: string;
    readonly runtimeVersion: string;
    readonly renderer: string;
  };
  readonly environment: {
    readonly appVersion: string;
    readonly electronVersion: string;
    readonly platform: 'darwin';
    readonly arch: 'arm64';
    readonly packaged: boolean;
  };
  readonly scenario: {
    readonly id: string;
    readonly creatorInputSha256: string;
    readonly scriptVersion: number;
    readonly viewport: {
      readonly width: number;
      readonly height: number;
      readonly deviceScaleFactor: number;
    };
    readonly warmupMs: number;
    readonly durationMs: number;
    readonly switchCycles: number;
  };
  readonly trials: readonly PetRuntimeBenchmarkTrial[];
  readonly artifact: {
    readonly packageSha256: string;
    readonly petAssetSha256: string;
    readonly runtimeBundleBytes: number;
    readonly petAssetBytes: number;
  };
  readonly evidence: {
    readonly capturedAt: string;
    readonly source: 'packaged-electron';
    readonly runId: string;
  };
}

export interface PetRuntimeBenchmarkTrial {
  readonly frame: PetFrameMetrics;
  readonly resources: {
    readonly activeCpuPercent: number;
    readonly hiddenCpuPercent: number;
    readonly peakResidentMemoryBytes: number;
    readonly residentMemoryDeltaBytes: number;
    readonly longTaskCount: number;
  };
  readonly lifecycle: {
    readonly completedSwitchCycles: number;
    readonly crashes: number;
    readonly watchdogRestarts: number;
    readonly runtimeFailures: number;
  };
  readonly network: {
    readonly observedRequests: number;
    readonly blockedRequests: number;
  };
}

export type PetRuntimeBenchmarkValidation =
  | { readonly status: 'valid'; readonly record: PetRuntimeBenchmarkRecord }
  | { readonly status: 'invalid'; readonly issues: readonly string[] };

export interface PetRuntimeBenchmarkRow {
  readonly candidateId: PetRuntimeCandidateId;
  readonly family: PetRuntimeFamily;
  readonly trialCount: number;
  readonly frameP95Ms: number;
  readonly frameP99Ms: number;
  readonly overDoublePeriodRatio: number;
  readonly consecutiveMissedFrames: number;
  readonly activeCpuPercentMean: number;
  readonly hiddenCpuPercentMean: number;
  readonly peakResidentMemoryBytes: number;
  readonly residentMemoryDeltaBytes: number;
  readonly longTaskCount: number;
  readonly runtimeBundleBytes: number;
  readonly petAssetBytes: number;
  readonly objectiveGates: {
    readonly packagedArm64: 'pass' | 'fail';
    readonly offline: 'pass' | 'fail';
    readonly lifecycleStability: 'pass' | 'fail';
  };
  readonly scorecardImportReady: boolean;
}

export type PetRuntimeBenchmarkComparison =
  | { readonly status: 'incomparable'; readonly issues: readonly string[] }
  | { readonly status: 'comparable'; readonly rows: readonly PetRuntimeBenchmarkRow[] };

export function validatePetRuntimeBenchmarkRecord(input: unknown): PetRuntimeBenchmarkValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { status: 'invalid', issues: ['$'] };
  exactKeys(input, ['schemaVersion', 'candidate', 'environment', 'scenario', 'trials', 'artifact', 'evidence'], '', issues);
  if (input.schemaVersion !== PET_RUNTIME_BENCHMARK_SCHEMA_VERSION) issues.push('schemaVersion');
  validateCandidate(input.candidate, issues);
  validateEnvironment(input.environment, issues);
  validateScenario(input.scenario, issues);
  validateTrials(input.trials, issues);
  validateArtifact(input.artifact, issues);
  validateEvidence(input.evidence, issues);
  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length > 0) return { status: 'invalid', issues: uniqueIssues };
  return { status: 'valid', record: input as unknown as PetRuntimeBenchmarkRecord };
}

export function buildPetRuntimeBenchmarkComparison(
  inputs: readonly PetRuntimeBenchmarkRecord[],
): PetRuntimeBenchmarkComparison {
  if (inputs.length === 0) return { status: 'incomparable', issues: ['records'] };
  const records: PetRuntimeBenchmarkRecord[] = [];
  const issues: string[] = [];
  inputs.forEach((input, index) => {
    const result = validatePetRuntimeBenchmarkRecord(input);
    if (result.status === 'valid') records.push(result.record);
    else issues.push(...result.issues.map((issue) => `records[${index}].${issue}`));
  });
  if (issues.length > 0) return { status: 'incomparable', issues };
  const baseline = records[0];
  if (baseline === undefined) return { status: 'incomparable', issues: ['records'] };
  for (const record of records.slice(1)) {
    compareScenario(baseline, record, issues);
  }
  if (issues.length > 0) return { status: 'incomparable', issues: [...new Set(issues)] };
  return { status: 'comparable', rows: records.map(summarizeRecord) };
}

function summarizeRecord(record: PetRuntimeBenchmarkRecord): PetRuntimeBenchmarkRow {
  const trials = record.trials;
  const packagedArm64 = record.environment.packaged
    && record.environment.platform === 'darwin'
    && record.environment.arch === 'arm64' ? 'pass' : 'fail';
  const offline = trials.every((trial) => trial.network.observedRequests === 0 && trial.network.blockedRequests === 0)
    ? 'pass'
    : 'fail';
  const lifecycleStability = trials.every((trial) =>
    trial.lifecycle.completedSwitchCycles >= record.scenario.switchCycles
      && trial.lifecycle.crashes === 0
      && trial.lifecycle.watchdogRestarts === 0
      && trial.lifecycle.runtimeFailures === 0)
    ? 'pass'
    : 'fail';
  const objectiveGates = { packagedArm64, offline, lifecycleStability } as const;
  return {
    candidateId: record.candidate.id,
    family: record.candidate.family,
    trialCount: trials.length,
    frameP95Ms: maximum(trials.map((trial) => trial.frame.frameP95Ms)),
    frameP99Ms: maximum(trials.map((trial) => trial.frame.frameP99Ms)),
    overDoublePeriodRatio: maximum(trials.map((trial) => trial.frame.overDoublePeriodRatio)),
    consecutiveMissedFrames: maximum(trials.map((trial) => trial.frame.consecutiveMissedFrames)),
    activeCpuPercentMean: mean(trials.map((trial) => trial.resources.activeCpuPercent)),
    hiddenCpuPercentMean: mean(trials.map((trial) => trial.resources.hiddenCpuPercent)),
    peakResidentMemoryBytes: maximum(trials.map((trial) => trial.resources.peakResidentMemoryBytes)),
    residentMemoryDeltaBytes: maximum(trials.map((trial) => trial.resources.residentMemoryDeltaBytes)),
    longTaskCount: sum(trials.map((trial) => trial.resources.longTaskCount)),
    runtimeBundleBytes: record.artifact.runtimeBundleBytes,
    petAssetBytes: record.artifact.petAssetBytes,
    objectiveGates,
    scorecardImportReady: Object.values(objectiveGates).every((gate) => gate === 'pass'),
  };
}

function compareScenario(
  baseline: PetRuntimeBenchmarkRecord,
  candidate: PetRuntimeBenchmarkRecord,
  issues: string[],
): void {
  compareValue(baseline.environment.appVersion, candidate.environment.appVersion, 'environment.appVersion', issues);
  compareValue(baseline.environment.electronVersion, candidate.environment.electronVersion, 'environment.electronVersion', issues);
  compareValue(baseline.environment.platform, candidate.environment.platform, 'environment.platform', issues);
  compareValue(baseline.environment.arch, candidate.environment.arch, 'environment.arch', issues);
  compareValue(baseline.environment.packaged, candidate.environment.packaged, 'environment.packaged', issues);
  compareValue(baseline.scenario.id, candidate.scenario.id, 'scenario.id', issues);
  compareValue(baseline.scenario.creatorInputSha256, candidate.scenario.creatorInputSha256, 'scenario.creatorInputSha256', issues);
  compareValue(baseline.scenario.scriptVersion, candidate.scenario.scriptVersion, 'scenario.scriptVersion', issues);
  compareValue(JSON.stringify(baseline.scenario.viewport), JSON.stringify(candidate.scenario.viewport), 'scenario.viewport', issues);
  compareValue(baseline.scenario.warmupMs, candidate.scenario.warmupMs, 'scenario.warmupMs', issues);
  compareValue(baseline.scenario.durationMs, candidate.scenario.durationMs, 'scenario.durationMs', issues);
  compareValue(baseline.scenario.switchCycles, candidate.scenario.switchCycles, 'scenario.switchCycles', issues);
}

function validateCandidate(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('candidate');
  exactKeys(input, ['id', 'family', 'adapterVersion', 'runtimeVersion', 'renderer'], 'candidate', issues);
  const definition = typeof input.id === 'string'
    ? PET_RUNTIME_CANDIDATES[input.id as PetRuntimeCandidateId]
    : undefined;
  if (definition === undefined) issues.push('candidate.id');
  if (definition !== undefined && input.family !== definition.family) issues.push('candidate.family');
  if (definition !== undefined && input.renderer !== definition.renderer) issues.push('candidate.renderer');
  boundedString(input.adapterVersion, 'candidate.adapterVersion', issues);
  boundedString(input.runtimeVersion, 'candidate.runtimeVersion', issues);
}

function validateEnvironment(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('environment');
  exactKeys(input, ['appVersion', 'electronVersion', 'platform', 'arch', 'packaged'], 'environment', issues);
  boundedString(input.appVersion, 'environment.appVersion', issues);
  boundedString(input.electronVersion, 'environment.electronVersion', issues);
  if (input.platform !== 'darwin') issues.push('environment.platform');
  if (input.arch !== 'arm64') issues.push('environment.arch');
  if (typeof input.packaged !== 'boolean') issues.push('environment.packaged');
}

function validateScenario(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('scenario');
  exactKeys(input, ['id', 'creatorInputSha256', 'scriptVersion', 'viewport', 'warmupMs', 'durationMs', 'switchCycles'], 'scenario', issues);
  boundedString(input.id, 'scenario.id', issues);
  sha256(input.creatorInputSha256, 'scenario.creatorInputSha256', issues);
  positiveInteger(input.scriptVersion, 'scenario.scriptVersion', issues, 1_000);
  if (!isRecord(input.viewport)) issues.push('scenario.viewport');
  else {
    exactKeys(input.viewport, ['width', 'height', 'deviceScaleFactor'], 'scenario.viewport', issues);
    boundedNumber(input.viewport.width, 'scenario.viewport.width', issues, 64, 4_096);
    boundedNumber(input.viewport.height, 'scenario.viewport.height', issues, 64, 4_096);
    boundedNumber(input.viewport.deviceScaleFactor, 'scenario.viewport.deviceScaleFactor', issues, 0.5, 4);
  }
  positiveInteger(input.warmupMs, 'scenario.warmupMs', issues, 600_000);
  positiveInteger(input.durationMs, 'scenario.durationMs', issues, 3_600_000);
  positiveInteger(input.switchCycles, 'scenario.switchCycles', issues, 10_000);
}

function validateTrials(input: unknown, issues: string[]): void {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) return void issues.push('trials');
  input.forEach((trial, index) => validateTrial(trial, `trials[${index}]`, issues));
}

function validateTrial(input: unknown, path: string, issues: string[]): void {
  if (!isRecord(input)) return void issues.push(path);
  exactKeys(input, ['frame', 'resources', 'lifecycle', 'network'], path, issues);
  validateFrame(input.frame, `${path}.frame`, issues);
  validateResources(input.resources, `${path}.resources`, issues);
  validateLifecycle(input.lifecycle, `${path}.lifecycle`, issues);
  validateNetwork(input.network, `${path}.network`, issues);
}

function validateFrame(input: unknown, path: string, issues: string[]): void {
  if (!isRecord(input)) return void issues.push(path);
  exactKeys(input, ['sampleWindowMs', 'refreshPeriodMs', 'frameP95Ms', 'frameP99Ms', 'overDoublePeriodRatio', 'consecutiveMissedFrames'], path, issues);
  boundedNumber(input.sampleWindowMs, `${path}.sampleWindowMs`, issues, 1, 3_600_000);
  boundedNumber(input.refreshPeriodMs, `${path}.refreshPeriodMs`, issues, 1, 100);
  boundedNumber(input.frameP95Ms, `${path}.frameP95Ms`, issues, 1, 10_000);
  boundedNumber(input.frameP99Ms, `${path}.frameP99Ms`, issues, 1, 10_000);
  boundedNumber(input.overDoublePeriodRatio, `${path}.overDoublePeriodRatio`, issues, 0, 1);
  nonNegativeInteger(input.consecutiveMissedFrames, `${path}.consecutiveMissedFrames`, issues, 100_000);
}

function validateResources(input: unknown, path: string, issues: string[]): void {
  if (!isRecord(input)) return void issues.push(path);
  exactKeys(input, ['activeCpuPercent', 'hiddenCpuPercent', 'peakResidentMemoryBytes', 'residentMemoryDeltaBytes', 'longTaskCount'], path, issues);
  boundedNumber(input.activeCpuPercent, `${path}.activeCpuPercent`, issues, 0, 1_000);
  boundedNumber(input.hiddenCpuPercent, `${path}.hiddenCpuPercent`, issues, 0, 1_000);
  nonNegativeInteger(input.peakResidentMemoryBytes, `${path}.peakResidentMemoryBytes`, issues, Number.MAX_SAFE_INTEGER);
  boundedNumber(input.residentMemoryDeltaBytes, `${path}.residentMemoryDeltaBytes`, issues, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  nonNegativeInteger(input.longTaskCount, `${path}.longTaskCount`, issues, 10_000_000);
}

function validateLifecycle(input: unknown, path: string, issues: string[]): void {
  if (!isRecord(input)) return void issues.push(path);
  exactKeys(input, ['completedSwitchCycles', 'crashes', 'watchdogRestarts', 'runtimeFailures'], path, issues);
  nonNegativeInteger(input.completedSwitchCycles, `${path}.completedSwitchCycles`, issues, 10_000);
  nonNegativeInteger(input.crashes, `${path}.crashes`, issues, 10_000);
  nonNegativeInteger(input.watchdogRestarts, `${path}.watchdogRestarts`, issues, 10_000);
  nonNegativeInteger(input.runtimeFailures, `${path}.runtimeFailures`, issues, 10_000);
}

function validateNetwork(input: unknown, path: string, issues: string[]): void {
  if (!isRecord(input)) return void issues.push(path);
  exactKeys(input, ['observedRequests', 'blockedRequests'], path, issues);
  nonNegativeInteger(input.observedRequests, `${path}.observedRequests`, issues, 10_000);
  nonNegativeInteger(input.blockedRequests, `${path}.blockedRequests`, issues, 10_000);
}

function validateArtifact(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('artifact');
  exactKeys(input, ['packageSha256', 'petAssetSha256', 'runtimeBundleBytes', 'petAssetBytes'], 'artifact', issues);
  sha256(input.packageSha256, 'artifact.packageSha256', issues);
  sha256(input.petAssetSha256, 'artifact.petAssetSha256', issues);
  nonNegativeInteger(input.runtimeBundleBytes, 'artifact.runtimeBundleBytes', issues, Number.MAX_SAFE_INTEGER);
  nonNegativeInteger(input.petAssetBytes, 'artifact.petAssetBytes', issues, Number.MAX_SAFE_INTEGER);
}

function validateEvidence(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('evidence');
  exactKeys(input, ['capturedAt', 'source', 'runId'], 'evidence', issues);
  if (typeof input.capturedAt !== 'string' || !Number.isFinite(Date.parse(input.capturedAt))) issues.push('evidence.capturedAt');
  if (input.source !== 'packaged-electron') issues.push('evidence.source');
  boundedString(input.runId, 'evidence.runId', issues);
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) issues.push(path === '' ? key : `${path}.${key}`);
  }
}

function boundedString(input: unknown, path: string, issues: string[]): void {
  if (typeof input !== 'string' || input.length < 1 || input.length > 128 || hasControlCharacter(input)) issues.push(path);
}

function hasControlCharacter(input: string): boolean {
  return [...input].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function sha256(input: unknown, path: string, issues: string[]): void {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/u.test(input)) issues.push(path);
}

function positiveInteger(input: unknown, path: string, issues: string[], maximum: number): void {
  if (!Number.isInteger(input) || (input as number) < 1 || (input as number) > maximum) issues.push(path);
}

function nonNegativeInteger(input: unknown, path: string, issues: string[], maximum: number): void {
  if (!Number.isInteger(input) || (input as number) < 0 || (input as number) > maximum) issues.push(path);
}

function boundedNumber(input: unknown, path: string, issues: string[], minimum: number, maximum: number): void {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < minimum || input > maximum) issues.push(path);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function compareValue(left: unknown, right: unknown, path: string, issues: string[]): void {
  if (left !== right) issues.push(path);
}

function maximum(values: readonly number[]): number {
  return Math.max(...values);
}

function mean(values: readonly number[]): number {
  return round(sum(values) / values.length);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
