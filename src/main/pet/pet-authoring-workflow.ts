import { createHash } from 'node:crypto';

import {
  PET_AUTHORING_CANDIDATES,
  evaluatePetAuthoringEvidence,
  validatePetCreatorInput,
  type PetAuthoringAdapterReport,
  type PetAuthoringCandidateId,
  type PetAuthoringEvidence,
  type PetCreatorInput,
} from '../../shared/pet-authoring.js';
import { PET_PACKAGE_LIMITS } from '../../shared/pet-package.js';
import {
  PetAuthoringProgressTracker,
  type PetAuthoringAdapterProgress,
  type PetAuthoringProgressListener,
} from './pet-authoring-progress.js';
import { preflightPetPackage } from './pet-package-preflight.js';

export interface PetAuthoringAdapterRequest {
  readonly input: PetCreatorInput;
  readonly creatorInputSha256: string;
  readonly references: ReadonlyMap<string, Uint8Array>;
  readonly signal: AbortSignal;
  readonly progress: PetAuthoringAdapterProgress;
}

export interface PetAuthoringAdapterOutput {
  readonly archive: Uint8Array;
  readonly report: PetAuthoringAdapterReport;
}

export interface PetAuthoringAdapter {
  readonly candidateId: PetAuthoringCandidateId;
  author(request: PetAuthoringAdapterRequest): Promise<PetAuthoringAdapterOutput>;
}

export type PetAuthoringWorkflowResult =
  | {
    readonly status: 'accepted';
    readonly archive: Uint8Array;
    readonly evidence: PetAuthoringEvidence;
  }
  | {
    readonly status: 'rejected';
    readonly stage: 'input' | 'references' | 'adapter' | 'package' | 'creator-gate';
    readonly issues: readonly string[];
  };

export class PetAuthoringWorkflow {
  readonly #adapters: ReadonlyMap<PetAuthoringCandidateId, PetAuthoringAdapter>;

  constructor(adapters: readonly PetAuthoringAdapter[]) {
    const byId = new Map<PetAuthoringCandidateId, PetAuthoringAdapter>();
    for (const adapter of adapters) {
      if (byId.has(adapter.candidateId)) throw new Error(`duplicate pet authoring adapter: ${adapter.candidateId}`);
      byId.set(adapter.candidateId, adapter);
    }
    this.#adapters = byId;
  }

  async author(
    candidateId: PetAuthoringCandidateId,
    rawInput: unknown,
    rawReferences: ReadonlyMap<string, Uint8Array>,
    signal: AbortSignal,
    onProgress?: PetAuthoringProgressListener,
  ): Promise<PetAuthoringWorkflowResult> {
    const progress = new PetAuthoringProgressTracker(onProgress);
    const validatedInput = validatePetCreatorInput(rawInput);
    if (validatedInput.status === 'rejected') {
      progress.finish('failed');
      return { status: 'rejected', stage: 'input', issues: validatedInput.issues };
    }
    const references = validateReferenceBytes(validatedInput.input, rawReferences);
    if (references.status === 'rejected') {
      progress.finish('failed');
      return references;
    }
    progress.prepared();
    if (signal.aborted) {
      progress.finish('cancelled');
      return rejected('adapter', ['aborted']);
    }
    const adapter = this.#adapters.get(candidateId);
    if (adapter === undefined || !PET_AUTHORING_CANDIDATES.includes(candidateId)) {
      progress.finish('failed');
      return rejected('adapter', ['candidateId']);
    }
    const creatorInputSha256 = sha256(Buffer.from(canonicalJson(validatedInput.input)));
    let output: PetAuthoringAdapterOutput;
    try {
      output = await adapter.author({
        input: validatedInput.input,
        creatorInputSha256,
        references: references.references,
        signal,
        progress,
      });
    } catch {
      progress.finish(signal.aborted ? 'cancelled' : 'failed');
      return rejected('adapter', [signal.aborted ? 'aborted' : 'failed']);
    }
    if (signal.aborted) {
      progress.finish('cancelled');
      return rejected('adapter', ['aborted']);
    }
    progress.packagingStarted();
    if (!(output.archive instanceof Uint8Array) || output.archive.byteLength < 1 || output.archive.byteLength > PET_PACKAGE_LIMITS.archiveBytes) {
      progress.finish('failed');
      return rejected('package', ['archive']);
    }
    const archive = Uint8Array.from(output.archive);
    const packageResult = await preflightPetPackage(archive);
    if (packageResult.status === 'rejected') {
      progress.finish('failed');
      return rejected('package', [packageResult.code, packageResult.reason]);
    }
    const evidence: PetAuthoringEvidence = {
      schemaVersion: 1,
      candidateId,
      creatorInputSha256,
      packageSha256: sha256(archive),
      automation: output.report.automation,
      motions: output.report.motions,
      qa: output.report.qa,
    };
    const gate = evaluatePetAuthoringEvidence(evidence);
    if (gate.status === 'fail') {
      progress.finish('failed');
      return rejected('creator-gate', gate.issues);
    }
    progress.complete();
    return { status: 'accepted', archive, evidence };
  }
}

type ReferenceValidation =
  | { readonly status: 'accepted'; readonly references: ReadonlyMap<string, Uint8Array> }
  | Extract<PetAuthoringWorkflowResult, { status: 'rejected' }>;

function validateReferenceBytes(
  input: PetCreatorInput,
  rawReferences: ReadonlyMap<string, Uint8Array>,
): ReferenceValidation {
  const expectedIds = new Set(input.references.map((reference) => reference.id));
  const issues: string[] = [];
  for (const id of rawReferences.keys()) {
    if (!expectedIds.has(id)) issues.push(`references.${id}`);
  }
  const references = new Map<string, Uint8Array>();
  for (const reference of input.references) {
    const bytes = rawReferences.get(reference.id);
    if (!(bytes instanceof Uint8Array)) {
      issues.push(`references.${reference.id}.missing`);
      continue;
    }
    if (bytes.byteLength !== reference.byteLength) issues.push(`references.${reference.id}.byteLength`);
    if (sha256(bytes) !== reference.sha256) issues.push(`references.${reference.id}.sha256`);
    references.set(reference.id, Uint8Array.from(bytes));
  }
  return issues.length === 0
    ? { status: 'accepted', references }
    : rejected('references', [...new Set(issues)]);
}

function rejected(
  stage: Extract<PetAuthoringWorkflowResult, { status: 'rejected' }>['stage'],
  issues: readonly string[],
): Extract<PetAuthoringWorkflowResult, { status: 'rejected' }> {
  return { status: 'rejected', stage, issues };
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
