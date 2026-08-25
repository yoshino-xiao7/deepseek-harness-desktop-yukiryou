import type { BrowserWindowConstructorOptions } from 'electron';
import { createWindowChromeAdapter } from './window-chrome-adapter.js';
import type { DesktopWindowState } from './window-state.js';

export function createDesktopWindowOptions(
  shellPreloadPath: string,
  platform: NodeJS.Platform = process.platform,
  initialState?: DesktopWindowState,
): BrowserWindowConstructorOptions {
  return createWindowChromeAdapter(platform).createOptions({
    width: initialState?.bounds.width ?? 1440,
    height: initialState?.bounds.height ?? 900,
    ...(initialState === undefined
      ? {}
      : { x: initialState.bounds.x, y: initialState.bounds.y }),
    minWidth: 820,
    minHeight: 600,
    preloadPath: shellPreloadPath,
  });
}
