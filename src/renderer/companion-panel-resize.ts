import {
  COMPANION_PANEL_MAX_WIDTH,
  COMPANION_PANEL_MIN_WIDTH,
  normalizedCompanionPanelWidth,
} from '../shared/desktop-companion.js';

const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 40;

export type CompanionPanelDragDecision = 'resize' | 'finish' | 'ignore';

export function companionPanelDragDecision(
  activePointerId: number | undefined,
  pointerId: number,
  buttons: number,
): CompanionPanelDragDecision {
  if (activePointerId !== pointerId) return 'ignore';
  return (buttons & 1) === 1 ? 'resize' : 'finish';
}

export function companionPanelWidthFromPointer(
  viewportWidth: number,
  pointerX: number,
): number {
  return normalizedCompanionPanelWidth(viewportWidth - pointerX);
}

export function companionPanelWidthFromKey(
  currentWidth: number,
  key: string,
  largeStep = false,
): number | undefined {
  const step = largeStep ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
  if (key === 'ArrowLeft') return normalizedCompanionPanelWidth(currentWidth + step);
  if (key === 'ArrowRight') return normalizedCompanionPanelWidth(currentWidth - step);
  if (key === 'Home') return COMPANION_PANEL_MIN_WIDTH;
  if (key === 'End') return COMPANION_PANEL_MAX_WIDTH;
  return undefined;
}
