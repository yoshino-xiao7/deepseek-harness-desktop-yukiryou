import { describe, expect, it } from 'vitest';

import { validatedPetStageSurfaceSnapshot } from './pet-stage-surface.js';

describe('pet stage surface contract', () => {
  it('accepts an exact bounded surface and the explicit hidden state', () => {
    expect(validatedPetStageSurfaceSnapshot({ visible: false })).toEqual({ visible: false });
    expect(validatedPetStageSurfaceSnapshot({
      visible: true,
      bounds: { x: 900, y: 164, width: 360, height: 172 },
      devicePixelRatio: 2,
      reducedMotion: false,
    })).toEqual({
      visible: true,
      bounds: { x: 900, y: 164, width: 360, height: 172 },
      devicePixelRatio: 2,
      reducedMotion: false,
    });
  });

  it('rejects undersized, oversized, fractional and extended surfaces', () => {
    const base = {
      visible: true,
      bounds: { x: 900, y: 164, width: 360, height: 172 },
      devicePixelRatio: 2,
      reducedMotion: false,
    };
    expect(validatedPetStageSurfaceSnapshot({ ...base, bounds: { ...base.bounds, width: 63 } })).toBeUndefined();
    expect(validatedPetStageSurfaceSnapshot({ ...base, bounds: { ...base.bounds, width: 561 } })).toBeUndefined();
    expect(validatedPetStageSurfaceSnapshot({ ...base, bounds: { ...base.bounds, x: 1.5 } })).toBeUndefined();
    expect(validatedPetStageSurfaceSnapshot({ ...base, remoteUrl: 'https://example.com' })).toBeUndefined();
  });
});
