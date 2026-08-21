import { describe, expect, it } from 'vitest';

import {
  animatedReservedWidth,
  companionLayoutStateChanged,
  companionLayout,
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

  it('requires a relayout when a new-session workspace transition closes the preview', () => {
    const before = {
      active: true,
      open: true,
      previewOpen: true,
      workspace: { status: 'ready' as const, workspaceId: 'workspace-1', title: 'Project', running: false },
    };
    const after = { ...before, previewOpen: false, workspace: { status: 'none' as const } };

    expect(companionLayoutStateChanged(before, after)).toBe(true);
  });

  it.each([
    { width: 820, open: true, preview: false, expected: { overlay: true, reviewFocus: false, reservedWidth: 0 } },
    { width: 980, open: true, preview: false, expected: { overlay: false, reviewFocus: false, reservedWidth: 340 } },
    { width: 1180, open: true, preview: true, expected: { overlay: false, reviewFocus: true, reservedWidth: 340 } },
    { width: 1319, open: true, preview: true, expected: { overlay: false, reviewFocus: true, reservedWidth: 340 } },
    { width: 1320, open: true, preview: true, expected: { overlay: false, reviewFocus: false, reservedWidth: 860 } },
    { width: 1480, open: true, preview: true, expected: { overlay: false, reviewFocus: false, reservedWidth: 860 } },
  ])('uses the intended responsive mode at $width px', ({ width, open, preview, expected }) => {
    expect(companionLayout(width, open, preview)).toEqual(expected);
  });
});
