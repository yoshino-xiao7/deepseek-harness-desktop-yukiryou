import type { BrowserWindowConstructorOptions } from 'electron';

export function createDesktopWindowOptions(
  shellPreloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#f5f7fb',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: shellPreloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}
