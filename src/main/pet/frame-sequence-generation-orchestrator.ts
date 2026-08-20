import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import type {
  FrameSequenceGeneration,
  FrameSequenceGenerator,
  FrameSequenceGeneratorRequest,
  GeneratedMotionAtlas,
} from './frame-sequence-authoring-adapter.js';

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const TARGET_FPS = 60;
const ATLAS_COLUMNS = 16;
const DEFAULT_CONCURRENCY = 3;

export interface PetMotionGenerationSpec {
  readonly motion: PetMotion;
  readonly instruction: string;
  readonly loop: boolean;
  readonly fps: 60;
  readonly durationMs: number;
  readonly frameCount: number;
  readonly cellWidth: 192;
  readonly cellHeight: 208;
  readonly columns: 16;
  readonly rows: number;
}

export interface PetVisualReference {
  readonly id: string;
  readonly role: 'primary' | 'supplemental' | 'canonical-look';
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly bytes: Uint8Array;
}

export interface PetGeneratedMainLook {
  readonly mediaType: 'image/png' | 'image/webp';
  readonly bytes: Uint8Array;
}

export interface PetVisualGenerationBackend {
  readonly id: string;
  readonly version: string;
  readonly extraProviderCredentialRequired: boolean;
  generateMainLook(request: Readonly<{
    input: PetCreatorInput;
    references: readonly PetVisualReference[];
    signal: AbortSignal;
  }>): Promise<PetGeneratedMainLook>;
  generateMotion(request: Readonly<{
    input: PetCreatorInput;
    references: readonly PetVisualReference[];
    spec: PetMotionGenerationSpec;
    signal: AbortSignal;
  }>): Promise<GeneratedMotionAtlas>;
}

export class PetVisualGenerationError extends Error {
  constructor(
    readonly code: 'transient' | 'invalid-request' | 'policy-rejected' | 'invalid-output',
    message: string,
  ) {
    super(message);
    this.name = 'PetVisualGenerationError';
  }
}

export const PET_MOTION_GENERATION_SPECS: Readonly<Record<PetMotion, PetMotionGenerationSpec>> = Object.freeze({
  standing: spec('standing', 'Stand calmly with subtle breathing and occasional natural blinking.', true, 4_000),
  drowsy: spec('drowsy', 'Gradually become sleepy while remaining upright; eyelids and posture grow heavy.', false, 2_000),
  'lying-down': spec('lying-down', 'Naturally lower the whole body from standing into a comfortable lying pose.', false, 2_000),
  sleeping: spec('sleeping', 'Sleep peacefully while lying down, with restrained breathing and tiny secondary motion.', true, 3_000),
  waking: spec('waking', 'Wake after being disturbed and slowly rise from the sleeping pose.', false, 2_000),
  'rubbing-eyes': spec('rubbing-eyes', 'Rub the eyes sleepily, then recover the canonical standing posture.', false, 2_000),
  'work-enter': spec('work-enter', 'Transition from standing into a seated eating pose without a visible jump.', false, 1_500),
  eating: spec('eating', 'Eat rapidly and energetically while seated, preserving identity and stable placement.', true, 4_000),
  'work-exit': spec('work-exit', 'Finish eating and return naturally from the seated pose to standing.', false, 1_500),
});

export class FrameSequenceGenerationOrchestrator implements FrameSequenceGenerator {
  readonly #concurrency: number;

  get extraProviderCredentialRequired(): boolean {
    return this.backend.extraProviderCredentialRequired;
  }

  constructor(
    private readonly backend: PetVisualGenerationBackend,
    concurrency = DEFAULT_CONCURRENCY,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > DEFAULT_CONCURRENCY) {
      throw new Error('pet generation concurrency must be between 1 and 3');
    }
    this.#concurrency = concurrency;
  }

  async generate(request: FrameSequenceGeneratorRequest): Promise<FrameSequenceGeneration> {
    throwIfAborted(request.signal);
    if (!safeBackendIdentifier(this.backend.id) || !safeBackendIdentifier(this.backend.version)) {
      throw new PetVisualGenerationError('invalid-output', 'invalid backend identity');
    }
    const baseReferences = referencesFrom(request);
    const mainLook = await this.#withTransientRetry(
      (signal) => this.backend.generateMainLook({
        input: cloneCreatorInput(request.input),
        references: cloneReferences(baseReferences),
        signal,
      }),
      request.signal,
    );
    throwIfAborted(request.signal);
    request.progress.mainLookReady();

    const canonicalReference: PetVisualReference = {
      id: 'canonical-look',
      role: 'canonical-look',
      mediaType: mainLook.mediaType,
      bytes: Uint8Array.from(mainLook.bytes),
    };
    const motionReferences = [...baseReferences, canonicalReference];
    const atlases = new Map<PetMotion, GeneratedMotionAtlas>();
    const internalAbort = new AbortController();
    const signal = AbortSignal.any([request.signal, internalAbort.signal]);
    let nextIndex = 0;
    let firstFailure: unknown;

    const worker = async (): Promise<void> => {
      while (!signal.aborted) {
        const index = nextIndex++;
        if (index >= PET_MOTIONS.length) return;
        const motion = PET_MOTIONS[index]!;
        try {
          const atlas = await this.#withTransientRetry(
            (attemptSignal) => this.backend.generateMotion({
              input: cloneCreatorInput(request.input),
              references: cloneReferences(motionReferences),
              spec: PET_MOTION_GENERATION_SPECS[motion],
              signal: attemptSignal,
            }),
            signal,
          );
          if (atlas.motion !== motion) throw new PetVisualGenerationError('invalid-output', `motion mismatch: ${motion}`);
          atlases.set(motion, cloneAtlas(atlas));
          request.progress.motionReady(motion);
        } catch (error) {
          if (firstFailure === undefined) firstFailure = error;
          internalAbort.abort();
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.#concurrency, PET_MOTIONS.length) }, worker));
    if (request.signal.aborted) throw abortError();
    if (firstFailure !== undefined) throw firstFailure;
    if (atlases.size !== PET_MOTIONS.length) throw new PetVisualGenerationError('invalid-output', 'incomplete motion generation');

    return {
      generator: { id: this.backend.id, version: this.backend.version },
      thumbnail: { mediaType: mainLook.mediaType, bytes: Uint8Array.from(mainLook.bytes) },
      atlases: PET_MOTIONS.map((motion) => cloneAtlas(atlases.get(motion)!)),
    };
  }

  async #withTransientRetry<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await operation(signal);
      } catch (error) {
        if (signal.aborted) throw abortError();
        if (!(error instanceof PetVisualGenerationError) || error.code !== 'transient' || attempt === 2) throw error;
      }
    }
    throw new PetVisualGenerationError('invalid-output', 'unreachable retry state');
  }
}

function spec(motion: PetMotion, instruction: string, loop: boolean, durationMs: number): PetMotionGenerationSpec {
  const frameCount = Math.round((durationMs / 1_000) * TARGET_FPS);
  return Object.freeze({
    motion,
    instruction,
    loop,
    fps: TARGET_FPS,
    durationMs,
    frameCount,
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    columns: ATLAS_COLUMNS,
    rows: Math.ceil(frameCount / ATLAS_COLUMNS),
  });
}

function referencesFrom(request: FrameSequenceGeneratorRequest): PetVisualReference[] {
  return request.input.references.map((metadata) => ({
    id: metadata.id,
    role: metadata.role,
    mediaType: metadata.mediaType,
    bytes: Uint8Array.from(request.references.get(metadata.id)!),
  }));
}

function cloneReferences(references: readonly PetVisualReference[]): PetVisualReference[] {
  return references.map((reference) => ({ ...reference, bytes: Uint8Array.from(reference.bytes) }));
}

function cloneCreatorInput(input: PetCreatorInput): PetCreatorInput {
  return { ...input, references: input.references.map((reference) => ({ ...reference })) };
}

function cloneAtlas(atlas: GeneratedMotionAtlas): GeneratedMotionAtlas {
  return { ...atlas, bytes: Uint8Array.from(atlas.bytes) };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  return new Error('aborted');
}

function safeBackendIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
}
