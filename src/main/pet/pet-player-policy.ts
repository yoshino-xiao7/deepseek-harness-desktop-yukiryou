import type { WebPreferences } from 'electron';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PET_PLAYER_PARTITION = 'dsh-pet-player';

export function createPetPlayerWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    partition: PET_PLAYER_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: false,
  };
}

export function isPetPlayerNavigationAllowed(entryUrl: string, targetUrl: string): boolean {
  return targetUrl === entryUrl;
}

export function isPetPlayerRequestAllowed(entryUrl: string, requestUrl: string): boolean {
  try {
    const entry = new URL(entryUrl);
    const request = new URL(requestUrl);
    if (entry.protocol === 'file:') return isPackagedFileRequest(entry, request);
    if (!isLoopback(entry.hostname) || (entry.protocol !== 'http:' && entry.protocol !== 'https:')) return false;
    return normalizedNetworkOrigin(request) === entry.origin;
  } catch {
    return false;
  }
}

function isPackagedFileRequest(entry: URL, request: URL): boolean {
  if (request.protocol !== 'file:' || request.search !== '' || request.hash !== '') return false;
  const entryDirectory = dirname(fileURLToPath(entry));
  const requestedPath = fileURLToPath(request);
  return requestedPath === fileURLToPath(entry) || requestedPath.startsWith(`${entryDirectory}${sep}`);
}

function normalizedNetworkOrigin(url: URL): string {
  const normalized = new URL(url);
  if (normalized.protocol === 'ws:') normalized.protocol = 'http:';
  else if (normalized.protocol === 'wss:') normalized.protocol = 'https:';
  if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') return '';
  return normalized.origin;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
