import type { WebPreferences } from 'electron';

export function createPetMediaWorkerWebPreferences(preloadPath: string, partition: string): WebPreferences {
  if (!partition.startsWith('dsh-pet-media-') || partition.startsWith('persist:')) throw new Error('invalid pet media partition');
  return {
    preload: preloadPath,
    partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: false,
  };
}
