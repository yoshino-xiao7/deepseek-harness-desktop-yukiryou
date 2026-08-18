import type { Rectangle } from 'electron';

export const DESKTOP_TOOLBAR_HEIGHT = 44;
export const COMPANION_LAYOUT_ANIMATION_MS = 220;

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
