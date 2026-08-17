import { describe, expect, it } from 'vitest';

import { createDesktopWindowOptions } from './desktop-window-options.js';

describe('desktop window chrome', () => {
  it('integrates macOS traffic lights into a custom draggable shell', () => {
    const options = createDesktopWindowOptions('/tmp/preload.cjs');

    expect(options.frame).not.toBe(false);
    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 14 });
  });
});
