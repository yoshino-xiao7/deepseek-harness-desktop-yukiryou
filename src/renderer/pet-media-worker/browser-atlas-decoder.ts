import {
  PET_MEDIA_WORKER_FRAME_BYTES,
  PET_MEDIA_WORKER_MAX_DECODED_BYTES,
  PET_MEDIA_WORKER_MAX_DECODED_FRAMES,
  type PetMediaWorkerAtlasMetadata,
} from '../../shared/pet-media-worker-protocol.js';

export interface DecodedAtlasBuffer {
  readonly cellWidth: 192;
  readonly cellHeight: 208;
  readonly frameCount: number;
  readonly framesBytes: Uint8ClampedArray<ArrayBuffer>;
}

export interface PetAtlasFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: 192;
  readonly height: 208;
}

export async function decodePetMotionAtlas(input: Readonly<{
  bytes: ArrayBuffer;
  atlas: PetMediaWorkerAtlasMetadata;
  signal: AbortSignal;
}>): Promise<DecodedAtlasBuffer> {
  const rects = petAtlasFrameRects(input.atlas);
  if (!(input.bytes instanceof ArrayBuffer) || input.bytes.byteLength < 1) throw new Error('invalid motion atlas bytes');
  throwIfAborted(input.signal);
  const bitmap = await createImageBitmap(new Blob([input.bytes], { type: input.atlas.mediaType }));
  const canvas = document.createElement('canvas');
  try {
    throwIfAborted(input.signal);
    if (bitmap.width !== input.atlas.width || bitmap.height !== input.atlas.height) throw new Error('motion atlas dimensions mismatch');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error('motion atlas canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    const framesBytes = new Uint8ClampedArray(input.atlas.frameCount * PET_MEDIA_WORKER_FRAME_BYTES);
    rects.forEach((rect, index) => {
      throwIfAborted(input.signal);
      framesBytes.set(context.getImageData(rect.x, rect.y, rect.width, rect.height).data, index * PET_MEDIA_WORKER_FRAME_BYTES);
    });
    return { cellWidth: 192, cellHeight: 208, frameCount: input.atlas.frameCount, framesBytes };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function petAtlasFrameRects(atlas: PetMediaWorkerAtlasMetadata): readonly PetAtlasFrameRect[] {
  const cellWidth = atlas.width / atlas.columns;
  const cellHeight = atlas.height / atlas.rows;
  const decodedBytes = atlas.frameCount * PET_MEDIA_WORKER_FRAME_BYTES;
  if (
    !Number.isSafeInteger(atlas.frameCount)
    || atlas.frameCount < 2
    || atlas.frameCount > PET_MEDIA_WORKER_MAX_DECODED_FRAMES
    || atlas.columns * atlas.rows < atlas.frameCount
    || cellWidth !== 192
    || cellHeight !== 208
    || decodedBytes > PET_MEDIA_WORKER_MAX_DECODED_BYTES
  ) throw new Error('invalid motion atlas frame plan');
  return Array.from({ length: atlas.frameCount }, (_, index) => ({
    x: (index % atlas.columns) * 192,
    y: Math.floor(index / atlas.columns) * 208,
    width: 192,
    height: 208,
  }));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('aborted');
}
