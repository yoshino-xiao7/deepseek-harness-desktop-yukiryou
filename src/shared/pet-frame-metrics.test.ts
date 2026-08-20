import { describe, expect, it } from 'vitest';

import { summarizePetFrameTimestamps } from './pet-frame-metrics.js';

describe('pet frame metrics', () => {
  it('measures frame time relative to the observed refresh period', () => {
    expect(summarizePetFrameTimestamps([0, 16, 32, 48, 98])).toEqual({
      sampleWindowMs: 98,
      refreshPeriodMs: 16,
      frameP95Ms: 50,
      frameP99Ms: 50,
      overDoublePeriodRatio: 0.25,
      consecutiveMissedFrames: 1,
    });
  });

  it('tracks consecutive missed frames without assuming a 60 Hz display', () => {
    expect(summarizePetFrameTimestamps([0, 8, 16, 40, 64, 72])).toMatchObject({
      refreshPeriodMs: 8,
      overDoublePeriodRatio: 0.4,
      consecutiveMissedFrames: 2,
    });
  });

  it('rejects insufficient or non-monotonic samples', () => {
    expect(summarizePetFrameTimestamps([0, 16])).toBeUndefined();
    expect(summarizePetFrameTimestamps([0, 16, 15])).toBeUndefined();
  });
});
