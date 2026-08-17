import type { Rectangle } from 'electron';

export const DESKTOP_TOOLBAR_HEIGHT = 44;

export function harnessContentBounds(
  contentSize: Pick<Rectangle, 'width' | 'height'>,
): Rectangle {
  return {
    x: 0,
    y: DESKTOP_TOOLBAR_HEIGHT,
    width: contentSize.width,
    height: Math.max(0, contentSize.height - DESKTOP_TOOLBAR_HEIGHT),
  };
}
