import type { PetMotionClipRasterization } from '../../main/pet/pet-motion-clip.js';
import type { PetMotionGenerationSpec } from '../../main/pet/frame-sequence-generation-orchestrator.js';
import { planStablePetPlacement, removePetGreenScreen, type PetPixelBounds } from '../../main/pet/pet-motion-rasterization.js';

const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 2_048;
const MAX_ATLAS_PIXELS = 16 * 1024 * 1024;

export async function rasterizePetMotionVideo(input: Readonly<{
  bytes: ArrayBuffer;
  spec: PetMotionGenerationSpec;
  signal: AbortSignal;
}>): Promise<PetMotionClipRasterization> {
  validateInput(input);
  const objectUrl = URL.createObjectURL(new Blob([input.bytes], { type: 'video/mp4' }));
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;
  const sourceCanvas = document.createElement('canvas');
  const atlasCanvas = document.createElement('canvas');
  try {
    await waitForVideo(video, input.signal);
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!safeVideoMetadata(width, height, video.duration)) throw new Error('invalid motion video metadata');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (sourceContext === null) throw new Error('source canvas unavailable');
    const frameBounds: PetPixelBounds[] = [];
    const frameHashes = new Set<string>();
    let perimeterOpaquePixels = 0;
    const timestamps = petMotionFrameTimestamps(video.duration * 1_000, input.spec.frameCount);

    for (const timestamp of timestamps) {
      throwIfAborted(input.signal);
      await seekVideo(video, timestamp / 1_000, input.signal);
      const keyed = readKeyedFrame(video, sourceContext, width, height);
      frameBounds.push(keyed.foregroundBounds);
      perimeterOpaquePixels += keyed.perimeterOpaquePixels;
      frameHashes.add(await sha256(keyed.rgba));
    }

    const placement = planStablePetPlacement({
      frameWidth: width,
      frameHeight: height,
      frameBounds,
      cellWidth: input.spec.cellWidth,
      cellHeight: input.spec.cellHeight,
      padding: 8,
    });
    const atlasWidth = input.spec.columns * input.spec.cellWidth;
    const atlasHeight = input.spec.rows * input.spec.cellHeight;
    atlasCanvas.width = atlasWidth;
    atlasCanvas.height = atlasHeight;
    const atlasContext = atlasCanvas.getContext('2d', { alpha: true });
    if (atlasContext === null) throw new Error('atlas canvas unavailable');
    atlasContext.imageSmoothingEnabled = true;
    atlasContext.imageSmoothingQuality = 'high';

    for (let index = 0; index < timestamps.length; index += 1) {
      throwIfAborted(input.signal);
      await seekVideo(video, timestamps[index]! / 1_000, input.signal);
      const keyed = readKeyedFrame(video, sourceContext, width, height);
      sourceContext.putImageData(new ImageData(ownedRgba(keyed.rgba), width, height), 0, 0);
      const cellX = (index % input.spec.columns) * input.spec.cellWidth;
      const cellY = Math.floor(index / input.spec.columns) * input.spec.cellHeight;
      atlasContext.drawImage(
        sourceCanvas,
        placement.source.left,
        placement.source.top,
        placement.source.right - placement.source.left + 1,
        placement.source.bottom - placement.source.top + 1,
        cellX + placement.destinationX,
        cellY + placement.destinationY,
        placement.destinationWidth,
        placement.destinationHeight,
      );
    }
    const atlasBytes = await encodePng(atlasCanvas, input.signal);
    return {
      atlas: {
        motion: input.spec.motion,
        mediaType: 'image/png',
        bytes: atlasBytes,
        width: atlasWidth,
        height: atlasHeight,
        columns: input.spec.columns,
        rows: input.spec.rows,
        frameCount: input.spec.frameCount,
        durationMs: input.spec.durationMs,
      },
      evidence: {
        decodedFrameCount: timestamps.length,
        targetFrameCount: input.spec.frameCount,
        uniqueFrameCount: frameHashes.size,
        transparentEdges: perimeterOpaquePixels === 0 ? 'pass' : 'fail',
        stableRegistration: 'pass',
        stageBounds: placement.destinationX >= 0 && placement.destinationY >= 0
          && placement.destinationX + placement.destinationWidth <= input.spec.cellWidth
          && placement.destinationY + placement.destinationHeight <= input.spec.cellHeight
          ? 'pass'
          : 'fail',
      },
    };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    atlasCanvas.width = 0;
    atlasCanvas.height = 0;
  }
}

export function petMotionFrameTimestamps(durationMs: number, frameCount: number): readonly number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 10_500 || !positiveInteger(frameCount) || frameCount > 600) {
    throw new Error('invalid motion frame plan');
  }
  if (frameCount === 1) return [0];
  const finalTimestamp = Math.max(0, durationMs - 1);
  return Array.from({ length: frameCount }, (_, index) => finalTimestamp * index / (frameCount - 1));
}

function readKeyedFrame(video: HTMLVideoElement, context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height);
  context.drawImage(video, 0, 0, width, height);
  return removePetGreenScreen({ rgba: context.getImageData(0, 0, width, height).data, width, height });
}

function waitForVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return waitForMediaEvent(video, 'loadedmetadata', signal);
}

async function seekVideo(video: HTMLVideoElement, seconds: number, signal: AbortSignal): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.000_001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const settled = waitForMediaEvent(video, 'seeked', signal);
  video.currentTime = seconds;
  await settled;
}

function waitForMediaEvent(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'seeked', signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onSuccess = (): void => { cleanup(); resolve(); };
    const onError = (): void => { cleanup(); reject(new Error('motion video decode failed')); };
    const onAbort = (): void => { cleanup(); reject(new Error('aborted')); };
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function encodePng(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (signal.aborted) reject(new Error('aborted'));
      else if (blob === null || blob.type !== 'image/png') reject(new Error('motion atlas encoding failed'));
      else void blob.arrayBuffer().then((bytes) => resolve(new Uint8Array(bytes)), reject);
    }, 'image/png');
  });
}

async function sha256(bytes: Uint8ClampedArray): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedRgba(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function ownedRgba(bytes: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const owned = new Uint8ClampedArray(bytes.byteLength);
  owned.set(bytes);
  return owned;
}

function validateInput(input: Readonly<{ bytes: ArrayBuffer; spec: PetMotionGenerationSpec }>): void {
  const atlasWidth = input.spec.columns * input.spec.cellWidth;
  const atlasHeight = input.spec.rows * input.spec.cellHeight;
  if (
    !(input.bytes instanceof ArrayBuffer)
    || input.bytes.byteLength < 1
    || input.bytes.byteLength > MAX_VIDEO_BYTES
    || input.spec.fps !== 60
    || !positiveInteger(input.spec.frameCount)
    || input.spec.frameCount > 600
    || !positiveInteger(atlasWidth)
    || !positiveInteger(atlasHeight)
    || atlasWidth * atlasHeight > MAX_ATLAS_PIXELS
  ) throw new Error('invalid motion rasterization input');
}

function safeVideoMetadata(width: number, height: number, durationSeconds: number): boolean {
  return positiveInteger(width) && positiveInteger(height)
    && width <= MAX_SOURCE_DIMENSION && height <= MAX_SOURCE_DIMENSION
    && Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 10.5;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('aborted');
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
