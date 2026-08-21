import type { Rectangle } from 'electron';
import type { DesktopCompanionSnapshot } from '../../shared/desktop-companion.js';

import {
  COMPANION_DOCKED_MIN_WIDTH,
  COMPANION_PANEL_WIDTH,
  COMPANION_PREVIEW_WIDTH,
  COMPANION_WIDE_REVIEW_MIN_WIDTH,
} from '../../shared/desktop-companion.js';

export const DESKTOP_TOOLBAR_HEIGHT = 44;
export const COMPANION_LAYOUT_ANIMATION_MS = 220;

export interface CompanionLayout {
  readonly overlay: boolean;
  readonly reviewFocus: boolean;
  readonly reservedWidth: number;
}

export function companionLayoutStateChanged(
  previous: DesktopCompanionSnapshot,
  next: DesktopCompanionSnapshot,
): boolean {
  return previous.active !== next.active
    || previous.open !== next.open
    || previous.previewOpen !== next.previewOpen;
}

export function companionLayout(width: number, open: boolean, previewOpen: boolean): CompanionLayout {
  const overlay = open && width < COMPANION_DOCKED_MIN_WIDTH;
  const reviewFocus = open && previewOpen && width < COMPANION_WIDE_REVIEW_MIN_WIDTH;
  const panel = open && !overlay
    ? Math.min(COMPANION_PANEL_WIDTH, Math.max(0, width - 480))
    : 0;
  const preview = open && previewOpen && !reviewFocus ? COMPANION_PREVIEW_WIDTH : 0;
  return { overlay, reviewFocus, reservedWidth: panel + preview };
}

export function harnessContentBounds(
  contentSize: Pick<Rectangle, 'width' | 'height'>,
  reservedRightWidth = 0,
): Rectangle {
  return {
    x: 0,
    y: DESKTOP_TOOLBAR_HEIGHT,
    width: Math.max(0, contentSize.width - reservedRightWidth),
    height: Math.max(0, contentSize.height - DESKTOP_TOOLBAR_HEIGHT),
  };
}

export function animatedReservedWidth(
  from: number,
  to: number,
  progress: number,
): number {
  const bounded = Math.max(0, Math.min(1, progress));
  const eased = 1 - ((1 - bounded) ** 3);
  return Math.round(from + ((to - from) * eased));
}
