import { createHash } from 'node:crypto';

import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import type {
  FrameSequenceGeneration,
  FrameSequenceVisualQa,
  FrameSequenceVisualQaRequest,
  FrameSequenceVisualQaResult,
  GeneratedMotionAtlas,
} from './frame-sequence-authoring-adapter.js';
import { PET_MOTION_GENERATION_SPECS, type PetVisualReference } from './frame-sequence-generation-orchestrator.js';

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ALPHA_THRESHOLD = 16;
const MAX_ADJACENT_CENTROID_STEP = 0.12;
const MAX_ADJACENT_AREA_CHANGE = 0.35;
const MAX_ADJACENT_PIXEL_DELTA = 0.45;
const MAX_LOOP_PIXEL_DELTA = 0.25;
const MIN_MEANINGFUL_PIXEL_DELTA = 0.00002;
const MIN_STAGE_MARGIN = 4;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface DecodedPetAtlas {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly frames: readonly Uint8ClampedArray[];
}

export interface PetAtlasFrameDecoder {
  readonly id: string;
  readonly version: string;
  decode(atlas: GeneratedMotionAtlas, signal: AbortSignal): Promise<DecodedPetAtlas>;
}

export interface PetIdentityEvaluationAdapter {
  readonly id: string;
  readonly version: string;
  readonly extraProviderCredentialRequired: boolean;
  evaluate(request: Readonly<{
    input: PetCreatorInput;
    references: readonly PetVisualReference[];
    samples: ReadonlyMap<PetMotion, readonly Uint8ClampedArray[]>;
    cellWidth: number;
    cellHeight: number;
    signal: AbortSignal;
  }>): Promise<Readonly<{ identityConsistency: number }>>;
}

export class IndependentFrameSequenceVisualQa implements FrameSequenceVisualQa {
  readonly #evaluatorVersion: string;

  get extraProviderCredentialRequired(): boolean {
    return this.identity.extraProviderCredentialRequired;
  }

  constructor(
    private readonly decoder: PetAtlasFrameDecoder,
    private readonly identity: PetIdentityEvaluationAdapter,
  ) {
    validateComponent(decoder);
    validateComponent(identity);
    this.#evaluatorVersion = `pipeline-${createHash('sha256')
      .update(`${decoder.id}@${decoder.version}|${identity.id}@${identity.version}|objective-v1`)
      .digest('hex').slice(0, 16)}`;
  }

  async evaluate(request: FrameSequenceVisualQaRequest): Promise<FrameSequenceVisualQaResult> {
    throwIfAborted(request.signal);
    const objective = { transparentEdges: true, stageBounds: true, transitionContinuity: true };
    const samples = new Map<PetMotion, readonly Uint8ClampedArray[]>();
    const atlases = generationByMotion(request.generation);
    for (const motion of PET_MOTIONS) {
      const atlas = atlases.get(motion)!;
      const decoded = await this.decoder.decode(cloneAtlas(atlas), request.signal);
      throwIfAborted(request.signal);
      validateDecoded(decoded, atlas.frameCount);
      const result = inspectMotion(decoded.frames, motion, decoded.cellWidth, decoded.cellHeight);
      objective.transparentEdges &&= result.transparentEdges;
      objective.stageBounds &&= result.stageBounds;
      objective.transitionContinuity &&= result.transitionContinuity;
      samples.set(motion, sampleFrames(decoded.frames));
    }
    const identity = await this.identity.evaluate({
      input: cloneInput(request.input),
      references: referencesFrom(request),
      samples: cloneSamples(samples),
      cellWidth: CELL_WIDTH,
      cellHeight: CELL_HEIGHT,
      signal: request.signal,
    });
    throwIfAborted(request.signal);
    if (!Number.isFinite(identity.identityConsistency) || identity.identityConsistency < 0 || identity.identityConsistency > 100) {
      throw new Error('invalid identity evaluation');
    }
    return {
      creatorInputSha256: request.creatorInputSha256,
      generationSha256: request.generationSha256,
      evaluator: { id: 'independent-visual-qa', version: this.#evaluatorVersion },
      qa: {
        identityConsistency: identity.identityConsistency,
        transparentEdges: objective.transparentEdges ? 'pass' : 'fail',
        stageBounds: objective.stageBounds ? 'pass' : 'fail',
        transitionContinuity: objective.transitionContinuity ? 'pass' : 'fail',
      },
    };
  }
}

interface FrameMetrics {
  readonly area: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly touchesPerimeter: boolean;
}

function inspectMotion(
  frames: readonly Uint8ClampedArray[],
  motion: PetMotion,
  width: number,
  height: number,
): Readonly<{ transparentEdges: boolean; stageBounds: boolean; transitionContinuity: boolean }> {
  const metrics = frames.map((frame) => frameMetrics(frame, width, height));
  let transitionContinuity = true;
  let meaningfullyChangedPairs = 0;
  for (let index = 1; index < frames.length; index += 1) {
    transitionContinuity &&= continuousPair(frames[index - 1]!, frames[index]!, metrics[index - 1]!, metrics[index]!, width, height, false);
    if (normalizedPixelDelta(frames[index - 1]!, frames[index]!) >= MIN_MEANINGFUL_PIXEL_DELTA) {
      meaningfullyChangedPairs += 1;
    }
  }
  const { loop } = PET_MOTION_GENERATION_SPECS[motion];
  if (loop) transitionContinuity &&= continuousPair(frames.at(-1)!, frames[0]!, metrics.at(-1)!, metrics[0]!, width, height, true);
  transitionContinuity &&= meaningfullyChangedPairs / Math.max(1, frames.length - 1) >= minimumTemporalDensity(motion);
  return {
    transparentEdges: metrics.every(({ touchesPerimeter }) => !touchesPerimeter),
    stageBounds: metrics.every((value) => value.area > 0
      && value.left >= MIN_STAGE_MARGIN
      && value.top >= MIN_STAGE_MARGIN
      && value.right < width - MIN_STAGE_MARGIN
      && value.bottom < height - MIN_STAGE_MARGIN),
    transitionContinuity,
  };
}

function minimumTemporalDensity(motion: PetMotion): number {
  if (motion === 'standing' || motion === 'sleeping') return 0.15;
  if (motion === 'eating') return 0.65;
  return 0.7;
}

function continuousPair(
  left: Uint8ClampedArray,
  right: Uint8ClampedArray,
  leftMetrics: FrameMetrics,
  rightMetrics: FrameMetrics,
  width: number,
  height: number,
  loopClosure: boolean,
): boolean {
  if (leftMetrics.area === 0 || rightMetrics.area === 0) return false;
  const centroidStep = Math.hypot(leftMetrics.centerX - rightMetrics.centerX, leftMetrics.centerY - rightMetrics.centerY)
    / Math.hypot(width, height);
  const areaChange = Math.abs(leftMetrics.area - rightMetrics.area) / Math.max(leftMetrics.area, rightMetrics.area);
  const pixelDelta = normalizedPixelDelta(left, right);
  return centroidStep <= MAX_ADJACENT_CENTROID_STEP
    && areaChange <= MAX_ADJACENT_AREA_CHANGE
    && pixelDelta <= (loopClosure ? MAX_LOOP_PIXEL_DELTA : MAX_ADJACENT_PIXEL_DELTA);
}

function frameMetrics(frame: Uint8ClampedArray, width: number, height: number): FrameMetrics {
  let area = 0;
  let weightedX = 0;
  let weightedY = 0;
  let touchesPerimeter = false;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = frame[(y * width + x) * 4 + 3]!;
      if (alpha <= ALPHA_THRESHOLD) continue;
      const weight = alpha / 255;
      area += weight;
      weightedX += x * weight;
      weightedY += y * weight;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesPerimeter = true;
    }
  }
  return {
    area,
    centerX: area === 0 ? 0 : weightedX / area,
    centerY: area === 0 ? 0 : weightedY / area,
    left,
    top,
    right,
    bottom,
    touchesPerimeter,
  };
}

function normalizedPixelDelta(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
  let delta = 0;
  for (let index = 0; index < left.length; index += 1) delta += Math.abs(left[index]! - right[index]!);
  return delta / (left.length * 255);
}

function sampleFrames(frames: readonly Uint8ClampedArray[]): readonly Uint8ClampedArray[] {
  const indices = new Set([0, Math.floor((frames.length - 1) / 4), Math.floor((frames.length - 1) / 2), Math.floor((frames.length - 1) * 3 / 4), frames.length - 1]);
  return [...indices].sort((left, right) => left - right).map((index) => new Uint8ClampedArray(frames[index]!));
}

function validateDecoded(decoded: DecodedPetAtlas, expectedFrames: number): void {
  if (decoded.cellWidth !== CELL_WIDTH || decoded.cellHeight !== CELL_HEIGHT || decoded.frames.length !== expectedFrames) {
    throw new Error('decoded atlas shape mismatch');
  }
  const expectedBytes = CELL_WIDTH * CELL_HEIGHT * 4;
  if (decoded.frames.some((frame) => !(frame instanceof Uint8ClampedArray) || frame.byteLength !== expectedBytes)) {
    throw new Error('decoded frame shape mismatch');
  }
}

function generationByMotion(generation: FrameSequenceGeneration): Map<PetMotion, GeneratedMotionAtlas> {
  const result = new Map(generation.atlases.map((atlas) => [atlas.motion, atlas]));
  if (result.size !== PET_MOTIONS.length || PET_MOTIONS.some((motion) => !result.has(motion))) throw new Error('incomplete visual QA generation');
  return result;
}

function referencesFrom(request: FrameSequenceVisualQaRequest): PetVisualReference[] {
  return request.input.references.map((metadata) => ({ ...metadata, bytes: Uint8Array.from(request.references.get(metadata.id)!), role: metadata.role }));
}

function cloneSamples(input: ReadonlyMap<PetMotion, readonly Uint8ClampedArray[]>): ReadonlyMap<PetMotion, readonly Uint8ClampedArray[]> {
  return new Map([...input].map(([motion, frames]) => [motion, frames.map((frame) => new Uint8ClampedArray(frame))]));
}

function cloneAtlas(atlas: GeneratedMotionAtlas): GeneratedMotionAtlas { return { ...atlas, bytes: Uint8Array.from(atlas.bytes) }; }
function cloneInput(input: PetCreatorInput): PetCreatorInput { return { ...input, references: input.references.map((reference) => ({ ...reference })) }; }
function validateComponent(value: Readonly<{ id: string; version: string }>): void { if (!SAFE_ID.test(value.id) || !SAFE_ID.test(value.version)) throw new Error('invalid visual QA component identity'); }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new Error('aborted'); }
