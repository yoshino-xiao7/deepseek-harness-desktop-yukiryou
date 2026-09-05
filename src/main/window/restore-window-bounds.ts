import type { BrowserWindow } from 'electron';
import type { WindowRectangle } from './window-state.js';

/** Restore saved outer bounds before showing a Windows window. */
export function restoreWindowBounds(
  window: Pick<BrowserWindow, 'getBounds' | 'setBounds'>,
  bounds: WindowRectangle,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return;
  // Electron's Windows constructor and setBounds round native resize insets
  // differently at fractional display scales (electron/electron#51572). Use
  // the measured residual, never a hard-coded DPI/frame correction. Limit the
  // attempts for rectangles the current display cannot represent exactly.
  let requested = { ...bounds };
  for (let attempt = 0; attempt < 4; attempt++) {
    window.setBounds(requested);
    const actual = window.getBounds();
    if (actual.x === bounds.x && actual.y === bounds.y &&
        actual.width === bounds.width && actual.height === bounds.height) return;
    requested = {
      x: requested.x + bounds.x - actual.x,
      y: requested.y + bounds.y - actual.y,
      width: Math.max(1, requested.width + bounds.width - actual.width),
      height: Math.max(1, requested.height + bounds.height - actual.height),
    };
  }
}
