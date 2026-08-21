import { describe, expect, it } from 'vitest';

import {
  companionPanelDragDecision,
  companionPanelWidthFromKey,
  companionPanelWidthFromPointer,
} from './companion-panel-resize.js';

describe('Companion panel resize gestures', () => {
  it('derives and clamps width from the right window edge', () => {
    expect(companionPanelWidthFromPointer(1_440, 1_020)).toBe(420);
    expect(companionPanelWidthFromPointer(1_440, 1_400)).toBe(280);
    expect(companionPanelWidthFromPointer(1_440, 100)).toBe(480);
  });

  it('supports accessible keyboard resizing', () => {
    expect(companionPanelWidthFromKey(340, 'ArrowLeft')).toBe(356);
    expect(companionPanelWidthFromKey(340, 'ArrowRight', true)).toBe(300);
    expect(companionPanelWidthFromKey(340, 'Home')).toBe(280);
    expect(companionPanelWidthFromKey(340, 'End')).toBe(480);
    expect(companionPanelWidthFromKey(340, 'Enter')).toBeUndefined();
  });

  it('ends a stale drag as soon as the primary mouse button is no longer held', () => {
    expect(companionPanelDragDecision(7, 7, 1)).toBe('resize');
    expect(companionPanelDragDecision(7, 7, 0)).toBe('finish');
    expect(companionPanelDragDecision(7, 8, 1)).toBe('ignore');
  });
});
