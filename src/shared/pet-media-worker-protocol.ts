import { PET_MOTIONS, type PetMotion } from './pet-package.js';

export const PET_MEDIA_WORKER_PROTOCOL_VERSION = 1;
export const PET_MEDIA_WORKER_INIT_CHANNEL = 'deepseek-yukiryou:pet-media-worker:init';
export const PET_MEDIA_WORKER_WINDOW_PORT_MESSAGE = 'deepseek-yukiryou:pet-media-worker-port';
export const PET_MEDIA_WORKER_MAX_CLIP_BYTES = 64 * 1024 * 1024;
export const PET_MEDIA_WORKER_MAX_ATLAS_BYTES = 64 * 1024 * 1024;
export const PET_MEDIA_WORKER_MAX_DECODED_FRAMES = 240;
export const PET_MEDIA_WORKER_FRAME_BYTES = 192 * 208 * 4;
export const PET_MEDIA_WORKER_MAX_DECODED_BYTES = PET_MEDIA_WORKER_MAX_DECODED_FRAMES * PET_MEDIA_WORKER_FRAME_BYTES;

export interface PetMediaWorkerInitEnvelope {
  readonly protocolVersion: 1;
  readonly realmEpoch: string;
  readonly nonce: string;
}

export interface PetMediaWorkerMotionSpec {
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

export type PetMediaWorkerHostMessage =
  | {
    readonly kind: 'rasterize';
    readonly realmEpoch: string;
    readonly jobGeneration: number;
    readonly clipBytes: ArrayBuffer;
    readonly spec: PetMediaWorkerMotionSpec;
  }
  | {
    readonly kind: 'decode-atlas';
    readonly realmEpoch: string;
    readonly jobGeneration: number;
    readonly atlasBytes: ArrayBuffer;
    readonly atlas: PetMediaWorkerAtlasMetadata;
  }
  | { readonly kind: 'dispose'; readonly realmEpoch: string };

export interface PetMediaWorkerAtlasMetadata {
  readonly motion: PetMotion;
  readonly mediaType: 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly durationMs: number;
}

export type PetMediaWorkerOutputMessage =
  | {
    readonly kind: 'hello';
    readonly protocolVersion: 1;
    readonly realmEpoch: string;
    readonly nonce: string;
  }
  | {
    readonly kind: 'result';
    readonly realmEpoch: string;
    readonly jobGeneration: number;
    readonly atlasBytes: ArrayBuffer;
    readonly atlas: PetMediaWorkerAtlasMetadata & { readonly mediaType: 'image/png' };
    readonly evidence: {
      readonly decodedFrameCount: number;
      readonly targetFrameCount: number;
      readonly uniqueFrameCount: number;
      readonly transparentEdges: 'pass' | 'fail';
      readonly stableRegistration: 'pass' | 'fail';
      readonly stageBounds: 'pass' | 'fail';
    };
  }
  | {
    readonly kind: 'decoded-atlas';
    readonly realmEpoch: string;
    readonly jobGeneration: number;
    readonly framesBytes: ArrayBuffer;
    readonly cellWidth: 192;
    readonly cellHeight: 208;
    readonly frameCount: number;
  }
  | {
    readonly kind: 'failure';
    readonly realmEpoch: string;
    readonly jobGeneration: number;
    readonly code: 'invalid-input' | 'decode-failed' | 'rasterization-failed' | 'aborted';
  };

export function parsePetMediaWorkerInitEnvelope(value: unknown): PetMediaWorkerInitEnvelope | undefined {
  if (!isRecord(value) || !exactKeys(value, ['protocolVersion', 'realmEpoch', 'nonce'])) return undefined;
  if (value.protocolVersion !== 1 || !opaqueId(value.realmEpoch) || !opaqueId(value.nonce)) return undefined;
  return value as unknown as PetMediaWorkerInitEnvelope;
}

export function parsePetMediaWorkerHostMessage(value: unknown, realmEpoch: string): PetMediaWorkerHostMessage | undefined {
  if (!isRecord(value) || value.realmEpoch !== realmEpoch) return undefined;
  if (value.kind === 'dispose' && exactKeys(value, ['kind', 'realmEpoch'])) return value as unknown as PetMediaWorkerHostMessage;
  if (value.kind === 'decode-atlas') {
    if (!exactKeys(value, ['kind', 'realmEpoch', 'jobGeneration', 'atlasBytes', 'atlas'])
      || !generation(value.jobGeneration)
      || !(value.atlasBytes instanceof ArrayBuffer)
      || value.atlasBytes.byteLength < 1
      || value.atlasBytes.byteLength > PET_MEDIA_WORKER_MAX_ATLAS_BYTES
      || !atlasMetadata(value.atlas, PET_MEDIA_WORKER_MAX_DECODED_FRAMES, true)) return undefined;
    return value as unknown as PetMediaWorkerHostMessage;
  }
  if (
    value.kind !== 'rasterize'
    || !exactKeys(value, ['kind', 'realmEpoch', 'jobGeneration', 'clipBytes', 'spec'])
    || !generation(value.jobGeneration)
    || !(value.clipBytes instanceof ArrayBuffer)
    || value.clipBytes.byteLength < 1
    || value.clipBytes.byteLength > PET_MEDIA_WORKER_MAX_CLIP_BYTES
    || !motionSpec(value.spec)
  ) return undefined;
  return value as unknown as PetMediaWorkerHostMessage;
}

export function parsePetMediaWorkerOutputMessage(
  value: unknown,
  context: Readonly<{ realmEpoch: string; nonce: string; jobGeneration: number }>,
): PetMediaWorkerOutputMessage | undefined {
  if (!isRecord(value) || value.realmEpoch !== context.realmEpoch) return undefined;
  if (value.kind === 'hello') {
    if (!exactKeys(value, ['kind', 'protocolVersion', 'realmEpoch', 'nonce'])
      || value.protocolVersion !== 1 || value.nonce !== context.nonce) return undefined;
    return value as unknown as PetMediaWorkerOutputMessage;
  }
  if (value.kind === 'failure') {
    if (!exactKeys(value, ['kind', 'realmEpoch', 'jobGeneration', 'code'])
      || value.jobGeneration !== context.jobGeneration
      || !['invalid-input', 'decode-failed', 'rasterization-failed', 'aborted'].includes(value.code as string)) return undefined;
    return value as unknown as PetMediaWorkerOutputMessage;
  }
  if (value.kind === 'decoded-atlas') {
    if (!exactKeys(value, ['kind', 'realmEpoch', 'jobGeneration', 'framesBytes', 'cellWidth', 'cellHeight', 'frameCount'])
      || value.jobGeneration !== context.jobGeneration
      || value.cellWidth !== 192
      || value.cellHeight !== 208
      || !integer(value.frameCount, 2, PET_MEDIA_WORKER_MAX_DECODED_FRAMES)
      || !(value.framesBytes instanceof ArrayBuffer)
      || value.framesBytes.byteLength !== (value.frameCount as number) * PET_MEDIA_WORKER_FRAME_BYTES
      || value.framesBytes.byteLength > PET_MEDIA_WORKER_MAX_DECODED_BYTES) return undefined;
    return value as unknown as PetMediaWorkerOutputMessage;
  }
  if (
    value.kind !== 'result'
    || !exactKeys(value, ['kind', 'realmEpoch', 'jobGeneration', 'atlasBytes', 'atlas', 'evidence'])
    || value.jobGeneration !== context.jobGeneration
    || !(value.atlasBytes instanceof ArrayBuffer)
    || value.atlasBytes.byteLength < 1
    || value.atlasBytes.byteLength > PET_MEDIA_WORKER_MAX_ATLAS_BYTES
    || !atlasMetadata(value.atlas, 600, false)
    || !isRecord(value.atlas)
    || value.atlas.mediaType !== 'image/png'
    || !rasterizationEvidence(value.evidence)
  ) return undefined;
  return value as unknown as PetMediaWorkerOutputMessage;
}

function motionSpec(value: unknown): value is PetMediaWorkerMotionSpec {
  if (!isRecord(value) || !exactKeys(value, ['motion', 'instruction', 'loop', 'fps', 'durationMs', 'frameCount', 'cellWidth', 'cellHeight', 'columns', 'rows'])) return false;
  return PET_MOTIONS.includes(value.motion as PetMotion)
    && typeof value.instruction === 'string' && value.instruction.length > 0 && value.instruction.length <= 1_000
    && typeof value.loop === 'boolean' && value.fps === 60
    && integer(value.durationMs, 100, 10_000) && integer(value.frameCount, 2, 600)
    && value.cellWidth === 192 && value.cellHeight === 208 && value.columns === 16
    && integer(value.rows, 1, 38) && (value.rows as number) * 16 >= (value.frameCount as number);
}

function atlasMetadata(value: unknown, maximumFrames: number, requireCellShape: boolean): boolean {
  if (!isRecord(value) || !exactKeys(value, ['motion', 'mediaType', 'width', 'height', 'columns', 'rows', 'frameCount', 'durationMs'])) return false;
  if (!PET_MOTIONS.includes(value.motion as PetMotion) || !['image/png', 'image/webp'].includes(value.mediaType as string)
    || !integer(value.width, 1, 8192) || !integer(value.height, 1, 8192)
    || !integer(value.columns, 1, 64) || !integer(value.rows, 1, 64)
    || !integer(value.frameCount, 2, maximumFrames) || !integer(value.durationMs, 100, 10_000)) return false;
  const width = value.width as number;
  const height = value.height as number;
  const columns = value.columns as number;
  const rows = value.rows as number;
  const frameCount = value.frameCount as number;
  return width % columns === 0 && height % rows === 0 && columns * rows >= frameCount
    && (!requireCellShape || (width / columns === 192 && height / rows === 208));
}

function rasterizationEvidence(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ['decodedFrameCount', 'targetFrameCount', 'uniqueFrameCount', 'transparentEdges', 'stableRegistration', 'stageBounds'])) return false;
  return integer(value.decodedFrameCount, 1, 600) && integer(value.targetFrameCount, 1, 600)
    && integer(value.uniqueFrameCount, 1, 600)
    && (value.transparentEdges === 'pass' || value.transparentEdges === 'fail')
    && (value.stableRegistration === 'pass' || value.stableRegistration === 'fail')
    && (value.stageBounds === 'pass' || value.stageBounds === 'fail');
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function opaqueId(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value); }
function generation(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function integer(value: unknown, minimum: number, maximum: number): boolean { return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
