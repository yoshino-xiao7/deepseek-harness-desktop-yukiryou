import { describe, expect, it } from 'vitest';

import { createDesktopWindowOptions } from './desktop-window-options.js';

describe('desktop window chrome', () => {
  it('integrates macOS traffic lights into a custom draggable shell', () => {
    const options = createDesktopWindowOptions('/tmp/preload.cjs', 'darwin');

    expect(options.frame).not.toBe(false);
    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 14 });
    expect(options.minWidth).toBe(820);
    expect(options.minHeight).toBe(600);
  });

  it('uses the production Windows custom caption instead of the native menu bar', () => {
    const options = createDesktopWindowOptions('/tmp/preload.cjs', 'win32');

    expect(options.titleBarStyle).toBe('hidden');
    expect(options.titleBarOverlay).toMatchObject({ height: 44 });
    expect(options.autoHideMenuBar).toBe(true);
    expect(options.trafficLightPosition).toBeUndefined();
  });
});
