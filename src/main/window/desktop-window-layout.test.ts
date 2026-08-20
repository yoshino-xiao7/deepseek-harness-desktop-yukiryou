import { describe, expect, it } from 'vitest';

import {
  animatedReservedWidth,
  companionLayout,
  resolvedCompanionPanelWidth,
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

  it.each([
    { width: 820, open: true, preview: false, expected: { overlay: true, reviewFocus: false, panelWidth: 380, reservedWidth: 0 } },
    { width: 980, open: true, preview: false, expected: { overlay: false, reviewFocus: false, panelWidth: 380, reservedWidth: 380 } },
    { width: 1180, open: true, preview: true, expected: { overlay: false, reviewFocus: true, panelWidth: 380, reservedWidth: 380 } },
    { width: 1319, open: true, preview: true, expected: { overlay: false, reviewFocus: true, panelWidth: 380, reservedWidth: 380 } },
    { width: 1320, open: true, preview: true, expected: { overlay: false, reviewFocus: false, panelWidth: 340, reservedWidth: 860 } },
    { width: 1480, open: true, preview: true, expected: { overlay: false, reviewFocus: false, panelWidth: 380, reservedWidth: 900 } },
  ])('uses the intended responsive mode at $width px', ({ width, open, preview, expected }) => {
    expect(companionLayout(width, open, preview, 380)).toEqual(expected);
  });

  it('dynamically clamps a preferred width without shrinking below the visible minimum', () => {
    expect(resolvedCompanionPanelWidth(900, 560, false)).toBe(560);
    expect(resolvedCompanionPanelWidth(980, 560, false)).toBe(500);
    expect(resolvedCompanionPanelWidth(1320, 560, true)).toBe(340);
  });
});
