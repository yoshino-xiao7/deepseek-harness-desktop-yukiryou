import type { BrowserWindowConstructorOptions } from 'electron';
import { createWindowChromeAdapter } from './window-chrome-adapter.js';

export function createDesktopWindowOptions(
  shellPreloadPath: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return createWindowChromeAdapter(platform).createOptions({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    preloadPath: shellPreloadPath,
  });
}
