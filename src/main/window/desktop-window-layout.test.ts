import { describe, expect, it } from 'vitest';

import {
  animatedReservedWidth,
  harnessContentBounds,
} from './desktop-window-layout.js';

describe('integrated desktop window layout', () => {
  it('reserves a persistent draggable toolbar above Harness content', () => {
    expect(harnessContentBounds({ width: 1180, height: 780 })).toEqual({
      x: 0,
      y: 44,
      width: 1180,
      height: 736,
    });
  });

  it('eases the Companion reservation without overshooting either edge', () => {
    expect(animatedReservedWidth(0, 340, 0)).toBe(0);
    expect(animatedReservedWidth(0, 340, 0.5)).toBe(298);
    expect(animatedReservedWidth(0, 340, 1)).toBe(340);
    expect(animatedReservedWidth(340, 0, 2)).toBe(0);
  });
});
