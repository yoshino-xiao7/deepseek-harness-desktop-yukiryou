import { createHash } from 'node:crypto';

import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import type { GeneratedMotionAtlas } from './frame-sequence-authoring-adapter.js';
import {
  PetVisualGenerationError,
  type PetGeneratedMainLook,
  type PetMotionGenerationSpec,
  type PetVisualGenerationBackend,
  type PetVisualReference,
} from './frame-sequence-generation-orchestrator.js';
import type {
  PetMotionClipAdapter,
  PetMotionClipRasterization,
  PetMotionClipRasterizer,
} from './pet-motion-clip.js';

const MAX_MAIN_LOOK_BYTES = 20 * 1024 * 1024;
const MAX_MOTION_CLIP_BYTES = 64 * 1024 * 1024;
const MIN_UNIQUE_FRAME_RATIO = 0.9;
const SAFE_COMPONENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface PetMainLookAdapter {
  readonly id: string;
  readonly version: string;
  readonly extraProviderCredentialRequired: boolean;
  generate(request: Readonly<{
    input: PetCreatorInput;
    references: readonly PetVisualReference[];
    signal: AbortSignal;
  }>): Promise<PetGeneratedMainLook>;
}

export class ClipBasedPetVisualBackend implements PetVisualGenerationBackend {
  readonly id = 'clip-pet-visual';
  readonly version: string;
  readonly extraProviderCredentialRequired: boolean;

  constructor(
    private readonly mainLookAdapter: PetMainLookAdapter,
    private readonly motionClipAdapter: PetMotionClipAdapter,
    private readonly rasterizer: PetMotionClipRasterizer,
  ) {
    for (const component of [mainLookAdapter, motionClipAdapter, rasterizer]) validateComponent(component);
    const identity = [mainLookAdapter, motionClipAdapter, rasterizer]
      .map(({ id, version }) => `${id}@${version}`)
      .join('|');
    this.version = `pipeline-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
    this.extraProviderCredentialRequired =
      mainLookAdapter.extraProviderCredentialRequired || motionClipAdapter.extraProviderCredentialRequired;
  }

  async generateMainLook(request: Readonly<{
    input: PetCreatorInput;
    references: readonly PetVisualReference[];
    signal: AbortSignal;
  }>): Promise<PetGeneratedMainLook> {
    throwIfAborted(request.signal);
    const result = await this.mainLookAdapter.generate({
      input: cloneInput(request.input),
      references: cloneReferences(request.references),
      signal: request.signal,
    });
    throwIfAborted(request.signal);
    if (
      (result.mediaType !== 'image/png' && result.mediaType !== 'image/webp')
      || !(result.bytes instanceof Uint8Array)
      || result.bytes.byteLength < 1
      || result.bytes.byteLength > MAX_MAIN_LOOK_BYTES
    ) throw new PetVisualGenerationError('invalid-output', 'main look output is invalid');
    return { mediaType: result.mediaType, bytes: Uint8Array.from(result.bytes) };
  }

  async generateMotion(request: Readonly<{
    input: PetCreatorInput;
    references: readonly PetVisualReference[];
    spec: PetMotionGenerationSpec;
    signal: AbortSignal;
  }>): Promise<GeneratedMotionAtlas> {
    throwIfAborted(request.signal);
    const canonicalLook = uniqueCanonicalLook(request.references);
    const clip = await this.motionClipAdapter.generate({
      inputRequest: request.input.request,
      canonicalLook: cloneReference(canonicalLook),
      spec: request.spec,
      signal: request.signal,
    });
    throwIfAborted(request.signal);
    if (
      clip.mediaType !== 'video/mp4'
      || !(clip.bytes instanceof Uint8Array)
      || clip.bytes.byteLength < 1
      || clip.bytes.byteLength > MAX_MOTION_CLIP_BYTES
      || !positiveInteger(clip.sourceDurationMs)
      || clip.sourceDurationMs > 10_000
    ) {
      throw new PetVisualGenerationError('invalid-output', 'motion clip output is invalid');
    }
    const rasterization = await this.rasterizer.rasterize({
      clip: { ...clip, bytes: Uint8Array.from(clip.bytes) },
      spec: request.spec,
      chromaKey: { red: 0, green: 255, blue: 0 },
      signal: request.signal,
    });
    throwIfAborted(request.signal);
    validateRasterization(rasterization, request.spec);
    return cloneAtlas(rasterization.atlas);
  }
}

function validateComponent(component: Readonly<{ id: string; version: string }>): void {
  if (!SAFE_COMPONENT_ID.test(component.id) || !SAFE_COMPONENT_ID.test(component.version)) {
    throw new Error('invalid pet visual pipeline component identity');
  }
}

function uniqueCanonicalLook(references: readonly PetVisualReference[]): PetVisualReference {
  const candidates = references.filter(({ role }) => role === 'canonical-look');
  if (candidates.length !== 1) throw new PetVisualGenerationError('invalid-request', 'one canonical look is required');
  return candidates[0]!;
}

function validateRasterization(result: PetMotionClipRasterization, spec: PetMotionGenerationSpec): void {
  const { atlas, evidence } = result;
  const expectedWidth = spec.columns * spec.cellWidth;
  const expectedHeight = spec.rows * spec.cellHeight;
  if (
    atlas.motion !== spec.motion
    || (atlas.mediaType !== 'image/png' && atlas.mediaType !== 'image/webp')
    || !(atlas.bytes instanceof Uint8Array)
    || atlas.bytes.byteLength < 1
    || atlas.width !== expectedWidth
    || atlas.height !== expectedHeight
    || atlas.columns !== spec.columns
    || atlas.rows !== spec.rows
    || atlas.frameCount !== spec.frameCount
    || atlas.durationMs !== spec.durationMs
  ) throw new PetVisualGenerationError('invalid-output', `invalid ${spec.motion} atlas`);
  if (
    !positiveInteger(evidence.decodedFrameCount)
    || evidence.targetFrameCount !== spec.frameCount
    || !positiveInteger(evidence.uniqueFrameCount)
    || evidence.uniqueFrameCount > evidence.decodedFrameCount
    || evidence.uniqueFrameCount > evidence.targetFrameCount
    || evidence.uniqueFrameCount / evidence.targetFrameCount < MIN_UNIQUE_FRAME_RATIO
  ) throw new PetVisualGenerationError('invalid-output', `${spec.motion} does not contain enough unique frames`);
  if (
    evidence.transparentEdges !== 'pass'
    || evidence.stableRegistration !== 'pass'
    || evidence.stageBounds !== 'pass'
  ) throw new PetVisualGenerationError('invalid-output', `${spec.motion} failed rasterization QA`);
}

function cloneInput(input: PetCreatorInput): PetCreatorInput {
  return { ...input, references: input.references.map((reference) => ({ ...reference })) };
}

function cloneReferences(references: readonly PetVisualReference[]): PetVisualReference[] {
  return references.map(cloneReference);
}

function cloneReference(reference: PetVisualReference): PetVisualReference {
  return { ...reference, bytes: Uint8Array.from(reference.bytes) };
}

function cloneAtlas(atlas: GeneratedMotionAtlas): GeneratedMotionAtlas {
  return { ...atlas, bytes: Uint8Array.from(atlas.bytes) };
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('aborted');
}
