import { describe, expect, it } from 'vitest';

import type { PetMediaWorkerAtlasMetadata } from '../../shared/pet-media-worker-protocol.js';
import { petAtlasFrameRects } from './browser-atlas-decoder.js';

const atlas = (overrides: Partial<PetMediaWorkerAtlasMetadata> = {}): PetMediaWorkerAtlasMetadata => ({
  motion: 'work-enter',
  mediaType: 'image/png',
  width: 3_072,
  height: 1_248,
  columns: 16,
  rows: 6,
  frameCount: 90,
  durationMs: 1_500,
  ...overrides,
});

describe('petAtlasFrameRects', () => {
  it('maps every atlas cell in row-major order without reading padded cells', () => {
    const rects = petAtlasFrameRects(atlas());
    expect(rects).toHaveLength(90);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 192, height: 208 });
    expect(rects[16]).toEqual({ x: 0, y: 208, width: 192, height: 208 });
    expect(rects[89]).toEqual({ x: 1_728, y: 1_040, width: 192, height: 208 });
  });

  it('rejects the wrong cell shape and more than one production motion worth of frames', () => {
    expect(() => petAtlasFrameRects(atlas({ width: 3_071 }))).toThrow('invalid motion atlas frame plan');
    expect(() => petAtlasFrameRects(atlas({ rows: 16, height: 3_328, frameCount: 241 }))).toThrow('invalid motion atlas frame plan');
  });
});
