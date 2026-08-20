import { describe, expect, it } from 'vitest';

import { petMotionFrameTimestamps } from './browser-motion-rasterizer.js';

describe('petMotionFrameTimestamps', () => {
  it('maps the complete source clip onto an exact target frame count without seeking past duration', () => {
    const timestamps = petMotionFrameTimestamps(4_000, 240);
    expect(timestamps).toHaveLength(240);
    expect(timestamps[0]).toBe(0);
    expect(timestamps.at(-1)).toBe(3_999);
    expect(timestamps.every((timestamp, index) => index === 0 || timestamp > timestamps[index - 1]!)).toBe(true);
  });

  it('supports the shortest transition plan and rejects unbounded work', () => {
    expect(petMotionFrameTimestamps(2_000, 90)).toHaveLength(90);
    expect(() => petMotionFrameTimestamps(11_000, 90)).toThrow('invalid motion frame plan');
    expect(() => petMotionFrameTimestamps(2_000, 601)).toThrow('invalid motion frame plan');
  });
});
