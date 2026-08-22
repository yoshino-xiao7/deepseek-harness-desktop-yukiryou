import type { WebPreferences } from 'electron';

/** Security contract shared by every Harness product carrier. */
export function createProductWebPreferences(preloadPath: string): WebPreferences {
  if (preloadPath.trim() === '') {
    throw new Error('Product preload path must not be empty');
  }
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    // Harness agents must keep running while the product view is hidden by
    // the startup shell or while the desktop window is in the background.
    backgroundThrottling: false,
  };
}
