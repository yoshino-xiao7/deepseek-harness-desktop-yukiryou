import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
} from 'electron';
import { createProductWebPreferences } from './product-web-preferences.js';

export type DesktopPlatform = 'darwin' | 'win32';
export type DesktopColorScheme = 'light' | 'dark';

export interface ProductWindowBaseOptions {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly preloadPath: string;
}

export interface WindowChromeDescriptor {
  readonly platform: DesktopPlatform;
  readonly captionHeight: number;
  readonly leadingSafeWidth: number;
  readonly trailingSafeWidth: number;
  readonly material: 'vibrancy' | 'mica' | 'opaque';
}

export interface WindowChromeAdapter {
  createOptions(
    base: ProductWindowBaseOptions,
  ): BrowserWindowConstructorOptions;
  describe(): WindowChromeDescriptor;
  refreshMaterial(window: BrowserWindow, scheme: DesktopColorScheme): void;
}

export function createMacWindowChromeAdapter(): WindowChromeAdapter {
  const descriptor: WindowChromeDescriptor = {
    platform: 'darwin',
    captionHeight: 32,
    leadingSafeWidth: 80,
    trailingSafeWidth: 0,
    material: 'vibrancy',
  };
  return {
    createOptions: (base) => ({
      ...baseWindowOptions(base),
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }),
    describe: () => descriptor,
    refreshMaterial: (window) => window.setVibrancy('sidebar'),
  };
}

export function createWindowsWindowChromeAdapter(
  micaAvailable = true,
): WindowChromeAdapter {
  const material = micaAvailable ? 'mica' : 'opaque';
  const descriptor: WindowChromeDescriptor = {
    platform: 'win32',
    captionHeight: 44,
    leadingSafeWidth: 0,
    trailingSafeWidth: 138,
    material,
  };
  return {
    createOptions: (base) => ({
      ...baseWindowOptions(base),
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: descriptor.captionHeight,
      },
      backgroundColor: micaAvailable ? '#00000000' : '#f5f7fb',
      backgroundMaterial: micaAvailable ? 'mica' : 'none',
      roundedCorners: true,
      thickFrame: true,
      hasShadow: true,
      autoHideMenuBar: true,
    }),
    describe: () => descriptor,
    refreshMaterial: (window) => {
      window.setBackgroundMaterial(micaAvailable ? 'mica' : 'none');
    },
  };
}

export function createWindowChromeAdapter(
  platform: NodeJS.Platform,
): WindowChromeAdapter {
  if (platform === 'darwin') return createMacWindowChromeAdapter();
  if (platform === 'win32') return createWindowsWindowChromeAdapter();
  throw new Error(`Unsupported desktop platform: ${platform}`);
}

function baseWindowOptions(
  base: ProductWindowBaseOptions,
): BrowserWindowConstructorOptions {
  return {
    width: base.width,
    height: base.height,
    minWidth: base.minWidth,
    minHeight: base.minHeight,
    show: false,
    webPreferences: createProductWebPreferences(base.preloadPath),
  };
}
