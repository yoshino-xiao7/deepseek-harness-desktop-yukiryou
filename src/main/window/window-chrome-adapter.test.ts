import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  createMacWindowChromeAdapter,
  createWindowChromeAdapter,
  createWindowsWindowChromeAdapter,
} from './window-chrome-adapter.js';

const base = {
  width: 1440,
  height: 900,
  minWidth: 820,
  minHeight: 600,
  preloadPath: '/tmp/product-preload.cjs',
};

describe('window chrome adapters', () => {
  it('describes and creates the macOS integrated chrome', () => {
    const adapter = createMacWindowChromeAdapter();
    const options = adapter.createOptions(base);

    expect(adapter.describe()).toEqual({
      platform: 'darwin',
      captionHeight: 32,
      leadingSafeWidth: 80,
      trailingSafeWidth: 0,
      material: 'vibrancy',
    });
    expect(options).toMatchObject({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      transparent: true,
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    });
  });

  it('uses native Windows caption controls and a DPI-safe fallback inset', () => {
    const adapter = createWindowsWindowChromeAdapter();
    const options = adapter.createOptions(base);

    expect(adapter.describe()).toEqual({
      platform: 'win32',
      captionHeight: 44,
      leadingSafeWidth: 0,
      trailingSafeWidth: 138,
      material: 'mica',
    });
    expect(options).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: 44 },
      backgroundMaterial: 'mica',
      roundedCorners: true,
      thickFrame: true,
    });
  });

  it('degrades Windows material without changing caption geometry', () => {
    const adapter = createWindowsWindowChromeAdapter(false);
    expect(adapter.describe()).toMatchObject({
      material: 'opaque',
      trailingSafeWidth: 138,
    });
    expect(adapter.createOptions(base)).toMatchObject({
      backgroundColor: '#f5f7fb',
      backgroundMaterial: 'none',
    });
  });

  it('refreshes only native material through the platform adapter', () => {
    const setVibrancy = vi.fn();
    const setBackgroundMaterial = vi.fn();
    const window = { setVibrancy, setBackgroundMaterial } as unknown as BrowserWindow;

    createMacWindowChromeAdapter().refreshMaterial(window, 'dark');
    createWindowsWindowChromeAdapter().refreshMaterial(window, 'light');

    expect(setVibrancy).toHaveBeenCalledWith('sidebar');
    expect(setBackgroundMaterial).toHaveBeenCalledWith('mica');
  });

  it('selects only supported production platforms', () => {
    expect(createWindowChromeAdapter('darwin').describe().platform).toBe('darwin');
    expect(createWindowChromeAdapter('win32').describe().platform).toBe('win32');
    expect(() => createWindowChromeAdapter('linux')).toThrow(
      'Unsupported desktop platform: linux',
    );
  });
});
