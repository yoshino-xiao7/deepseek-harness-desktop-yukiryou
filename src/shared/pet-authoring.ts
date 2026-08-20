import { PET_MOTIONS, type PetMotion } from './pet-package.js';
import type { PetRuntimeCandidateId } from './pet-runtime-benchmark.js';

export const PET_CREATOR_INPUT_SCHEMA_VERSION = 1;
export const PET_AUTHORING_EVIDENCE_SCHEMA_VERSION = 1;

export const PET_AUTHORING_CANDIDATES = [
  'webm-alpha',
  'frame-sequence-canvas2d',
  'layered-rig-canvas2d',
] as const satisfies readonly PetRuntimeCandidateId[];

export type PetAuthoringCandidateId = typeof PET_AUTHORING_CANDIDATES[number];

export const PET_AUTHORING_PROGRESS_STAGES = [
  'preparing',
  'main-look',
  'motions',
  'hatching',
] as const;

export type PetAuthoringProgressStage = typeof PET_AUTHORING_PROGRESS_STAGES[number];

export interface PetAuthoringProgressSnapshot {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly status: 'running' | 'complete' | 'failed' | 'cancelled';
  readonly stage: PetAuthoringProgressStage;
  readonly percent: number;
  readonly completedMotions: readonly PetMotion[];
  readonly totalMotions: number;
}

export interface PetCreatorReference {
  readonly id: string;
  readonly role: 'primary' | 'supplemental';
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface PetCreatorInput {
  readonly schemaVersion: 1;
  readonly locale: 'zh-CN' | 'en';
  readonly displayName: string;
  readonly request: string;
  readonly references: readonly PetCreatorReference[];
}

export type PetCreatorInputValidation =
  | { readonly status: 'accepted'; readonly input: PetCreatorInput }
  | { readonly status: 'rejected'; readonly issues: readonly string[] };

export interface PetAuthoringEvidence {
  readonly schemaVersion: 1;
  readonly candidateId: PetAuthoringCandidateId;
  readonly creatorInputSha256: string;
  readonly packageSha256: string;
  readonly automation: {
    readonly userProvidedEngineAsset: boolean;
    readonly proprietaryEditorRequired: boolean;
    readonly manualEditorSteps: number;
    readonly extraProviderCredentialRequired: boolean;
  };
  readonly motions: Readonly<Record<PetMotion, {
    readonly generated: boolean;
    readonly durationMs: number;
    readonly frameCount: number;
  }>>;
  readonly qa: {
    readonly identityConsistency: number;
    readonly transparentEdges: 'pass' | 'fail';
    readonly stageBounds: 'pass' | 'fail';
    readonly transitionContinuity: 'pass' | 'fail';
  };
}

export type PetAuthoringAdapterReport = Pick<PetAuthoringEvidence, 'automation' | 'motions' | 'qa'>;

export type PetAuthoringGateResult =
  | { readonly status: 'pass'; readonly candidateId: PetAuthoringCandidateId }
  | { readonly status: 'fail'; readonly candidateId?: PetAuthoringCandidateId; readonly issues: readonly string[] };

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_DIMENSION = 16_384;
const MAX_REFERENCES = 8;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function validatePetCreatorInput(input: unknown): PetCreatorInputValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { status: 'rejected', issues: ['$'] };
  exactKeys(input, ['schemaVersion', 'locale', 'displayName', 'request', 'references'], '', issues);
  if (input.schemaVersion !== PET_CREATOR_INPUT_SCHEMA_VERSION) issues.push('schemaVersion');
  if (input.locale !== 'zh-CN' && input.locale !== 'en') issues.push('locale');
  boundedText(input.displayName, 'displayName', 1, 80, issues);
  boundedRequest(input.request, issues);
  validateReferences(input.references, issues);
  const uniqueIssues = [...new Set(issues)];
  return uniqueIssues.length === 0
    ? { status: 'accepted', input: input as unknown as PetCreatorInput }
    : { status: 'rejected', issues: uniqueIssues };
}

export function evaluatePetAuthoringEvidence(input: unknown): PetAuthoringGateResult {
  const issues: string[] = [];
  if (!isRecord(input)) return { status: 'fail', issues: ['$'] };
  exactKeys(input, ['schemaVersion', 'candidateId', 'creatorInputSha256', 'packageSha256', 'automation', 'motions', 'qa'], '', issues);
  if (input.schemaVersion !== PET_AUTHORING_EVIDENCE_SCHEMA_VERSION) issues.push('schemaVersion');
  const candidateId = isPetAuthoringCandidateId(input.candidateId) ? input.candidateId : undefined;
  if (candidateId === undefined) issues.push('candidateId');
  if (!isSha256(input.creatorInputSha256)) issues.push('creatorInputSha256');
  if (!isSha256(input.packageSha256)) issues.push('packageSha256');
  validateAutomation(input.automation, issues);
  validateMotions(input.motions, issues);
  validateQa(input.qa, issues);
  const uniqueIssues = [...new Set(issues)];
  return uniqueIssues.length === 0 && candidateId !== undefined
    ? { status: 'pass', candidateId }
    : { status: 'fail', ...(candidateId === undefined ? {} : { candidateId }), issues: uniqueIssues };
}

function validateReferences(input: unknown, issues: string[]): void {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_REFERENCES) {
    issues.push('references');
    return;
  }
  let totalBytes = 0;
  let primaryCount = 0;
  const ids = new Set<string>();
  const hashes = new Set<string>();
  input.forEach((reference, index) => {
    const path = `references[${index}]`;
    if (!isRecord(reference)) {
      issues.push(path);
      return;
    }
    exactKeys(reference, ['id', 'role', 'mediaType', 'byteLength', 'width', 'height', 'sha256'], path, issues);
    if (typeof reference.id !== 'string' || !SAFE_ID.test(reference.id) || ids.has(reference.id)) issues.push(`${path}.id`);
    else ids.add(reference.id);
    if (reference.role === 'primary') primaryCount += 1;
    else if (reference.role !== 'supplemental') issues.push(`${path}.role`);
    if (reference.mediaType !== 'image/png' && reference.mediaType !== 'image/jpeg' && reference.mediaType !== 'image/webp') {
      issues.push(`${path}.mediaType`);
    }
    if (!isIntegerInRange(reference.byteLength, 1, MAX_REFERENCE_BYTES)) issues.push(`${path}.byteLength`);
    else totalBytes += reference.byteLength;
    if (!isIntegerInRange(reference.width, 1, MAX_REFERENCE_DIMENSION)) issues.push(`${path}.width`);
    if (!isIntegerInRange(reference.height, 1, MAX_REFERENCE_DIMENSION)) issues.push(`${path}.height`);
    if (!isSha256(reference.sha256) || hashes.has(reference.sha256 as string)) issues.push(`${path}.sha256`);
    else hashes.add(reference.sha256 as string);
  });
  if (primaryCount !== 1) issues.push('references.primary');
  if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) issues.push('references.byteLength');
}

function validateAutomation(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('automation');
  exactKeys(input, ['userProvidedEngineAsset', 'proprietaryEditorRequired', 'manualEditorSteps', 'extraProviderCredentialRequired'], 'automation', issues);
  if (input.userProvidedEngineAsset !== false) issues.push('automation.userProvidedEngineAsset');
  if (input.proprietaryEditorRequired !== false) issues.push('automation.proprietaryEditorRequired');
  if (input.manualEditorSteps !== 0) issues.push('automation.manualEditorSteps');
  if (input.extraProviderCredentialRequired !== false) issues.push('automation.extraProviderCredentialRequired');
}

function validateMotions(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('motions');
  exactKeys(input, PET_MOTIONS, 'motions', issues);
  for (const motion of PET_MOTIONS) {
    const value = input[motion];
    const path = `motions.${motion}`;
    if (!isRecord(value)) {
      issues.push(path);
      continue;
    }
    exactKeys(value, ['generated', 'durationMs', 'frameCount'], path, issues);
    if (value.generated !== true) issues.push(`${path}.generated`);
    if (!isIntegerInRange(value.durationMs, 100, 60_000)) issues.push(`${path}.durationMs`);
    if (!isIntegerInRange(value.frameCount, 2, 3_600)) issues.push(`${path}.frameCount`);
  }
}

function validateQa(input: unknown, issues: string[]): void {
  if (!isRecord(input)) return void issues.push('qa');
  exactKeys(input, ['identityConsistency', 'transparentEdges', 'stageBounds', 'transitionContinuity'], 'qa', issues);
  if (typeof input.identityConsistency !== 'number' || !Number.isFinite(input.identityConsistency) || input.identityConsistency < 90 || input.identityConsistency > 100) {
    issues.push('qa.identityConsistency');
  }
  for (const key of ['transparentEdges', 'stageBounds', 'transitionContinuity'] as const) {
    if (input[key] !== 'pass') issues.push(`qa.${key}`);
  }
}

function isPetAuthoringCandidateId(value: unknown): value is PetAuthoringCandidateId {
  return typeof value === 'string' && PET_AUTHORING_CANDIDATES.some((candidate) => candidate === value);
}

function boundedText(value: unknown, path: string, minimum: number, maximum: number, issues: string[]): void {
  if (typeof value !== 'string' || value !== value.normalize('NFC') || value.length < minimum || value.length > maximum || hasForbiddenCodePoint(value, false)) {
    issues.push(path);
  }
}

function boundedRequest(value: unknown, issues: string[]): void {
  if (typeof value !== 'string' || value !== value.normalize('NFC') || value.trim().length < 1 || value.length > 4_000 || hasForbiddenCodePoint(value, true)) {
    issues.push('request');
  }
}

function hasForbiddenCodePoint(value: string, allowLayoutWhitespace: boolean): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const allowedWhitespace = allowLayoutWhitespace && (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d);
    if (
      (!allowedWhitespace && codePoint <= 0x1f)
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) return true;
  }
  return false;
}

function exactKeys(input: Readonly<Record<string, unknown>>, expected: readonly string[], path: string, issues: string[]): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(input)) {
    if (!expectedSet.has(key)) issues.push(path === '' ? key : `${path}.${key}`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(input, key)) issues.push(path === '' ? key : `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}
