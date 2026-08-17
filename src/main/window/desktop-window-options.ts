import type { BrowserWindowConstructorOptions } from 'electron';

export function createDesktopWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#f5f7fb',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}
