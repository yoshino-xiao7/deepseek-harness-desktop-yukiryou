import { describe, expect, it } from 'vitest';

import { planStablePetPlacement, removePetGreenScreen } from './pet-motion-rasterization.js';

function frame(width: number, height: number, color: readonly [number, number, number, number]): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < output.length; offset += 4) output.set(color, offset);
  return output;
}

function setPixel(bytes: Uint8ClampedArray, width: number, x: number, y: number, color: readonly [number, number, number, number]): void {
  bytes.set(color, (y * width + x) * 4);
}

describe('removePetGreenScreen', () => {
  it('makes the fixed green background transparent while preserving foreground colors', () => {
    const rgba = frame(5, 5, [0, 255, 0, 255]);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 2; x <= 3; x += 1) setPixel(rgba, 5, x, y, [40, 60, 220, 255]);
    }

    const result = removePetGreenScreen({ rgba, width: 5, height: 5 });

    expect(result.rgba[3]).toBe(0);
    expect([...result.rgba.slice((2 + 2 * 5) * 4, (2 + 2 * 5) * 4 + 4)]).toEqual([40, 60, 220, 255]);
    expect(result.foregroundBounds).toEqual({ left: 2, top: 1, right: 3, bottom: 3 });
    expect(result.perimeterOpaquePixels).toBe(0);
  });

  it('softens green fringe alpha and suppresses spill instead of leaving a hard halo', () => {
    const rgba = frame(1, 1, [30, 180, 30, 255]);

    const result = removePetGreenScreen({ rgba, width: 1, height: 1 });

    expect(result.rgba[3]).toBeGreaterThan(16);
    expect(result.rgba[3]).toBeLessThan(255);
    expect(result.rgba[1]).toBeLessThan(180);
  });

  it('does not erase a saturated non-key green character color', () => {
    const result = removePetGreenScreen({ rgba: frame(1, 1, [0, 120, 40, 255]), width: 1, height: 1 });
    expect(result.rgba[3]).toBe(255);
  });

  it('rejects empty, malformed and oversized frame declarations', () => {
    expect(() => removePetGreenScreen({ rgba: frame(2, 2, [0, 255, 0, 255]), width: 2, height: 2 }))
      .toThrow('no foreground');
    expect(() => removePetGreenScreen({ rgba: new Uint8ClampedArray(3), width: 1, height: 1 }))
      .toThrow('invalid chroma-key frame');
    expect(() => removePetGreenScreen({ rgba: new Uint8ClampedArray(), width: 4097, height: 4097 }))
      .toThrow('invalid chroma-key frame');
  });
});

describe('planStablePetPlacement', () => {
  it('uses one union crop, scale and bottom baseline for every frame', () => {
    const result = planStablePetPlacement({
      frameWidth: 960,
      frameHeight: 960,
      frameBounds: [
        { left: 300, top: 100, right: 650, bottom: 850 },
        { left: 260, top: 140, right: 680, bottom: 870 },
        { left: 310, top: 80, right: 640, bottom: 840 },
      ],
      cellWidth: 192,
      cellHeight: 208,
      padding: 8,
    });

    expect(result.source).toEqual({ left: 260, top: 80, right: 680, bottom: 870 });
    expect(result.destinationX).toBeGreaterThanOrEqual(8);
    expect(result.destinationY + result.destinationHeight).toBeCloseTo(200);
    expect(result.destinationWidth).toBeLessThanOrEqual(176);
    expect(result.destinationHeight).toBeLessThanOrEqual(192);
  });

  it('rejects out-of-frame bounds and impossible padding', () => {
    expect(() => planStablePetPlacement({
      frameWidth: 10,
      frameHeight: 10,
      frameBounds: [{ left: 0, top: 0, right: 10, bottom: 9 }],
      cellWidth: 10,
      cellHeight: 10,
      padding: 1,
    })).toThrow('invalid foreground bounds');
    expect(() => planStablePetPlacement({
      frameWidth: 10,
      frameHeight: 10,
      frameBounds: [{ left: 0, top: 0, right: 9, bottom: 9 }],
      cellWidth: 10,
      cellHeight: 10,
      padding: 5,
    })).toThrow('invalid stable placement input');
  });
});
