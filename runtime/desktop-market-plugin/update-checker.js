import { requestNpmPackument } from './catalog-network.js';

const CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 512;
const MAX_CONCURRENT_REQUESTS = 8;
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function createUpdateChecker(options = {}) {
  const now = options.now ?? (() => Date.now());
  const requestPackument = options.requestPackument ?? requestNpmPackument;
  const cache = new Map();
  const inFlight = new Map();

  return Object.freeze({
    async check(identity) {
      const packageName = identity?.packageName;
      const installedVersion = identity?.installedVersion;
      if (!NPM_PACKAGE_PATTERN.test(packageName ?? '') || !STABLE_VERSION_PATTERN.test(installedVersion ?? '')) {
        throw updateError('invalid-request', 'Invalid installed package identity');
      }
      const timestamp = now();
      const cached = cache.get(packageName);
      if (cached !== undefined && timestamp - cached.storedAt < CACHE_MS) {
        return result(packageName, installedVersion, cached.latestVersion);
      }
      const pending = inFlight.get(packageName);
      if (pending === undefined && inFlight.size >= MAX_CONCURRENT_REQUESTS) {
        throw updateError('busy', 'Too many update checks are in flight');
      }
      const latestVersion = pending === undefined
        ? await startRequest(packageName, requestPackument, cache, inFlight, now)
        : await pending;
      return result(packageName, installedVersion, latestVersion);
    },
  });
}

function startRequest(packageName, requestPackument, cache, inFlight, now) {
  const request = (async () => {
    const packument = await requestPackument(packageName);
    const tags = isRecord(packument) && isRecord(packument['dist-tags']) ? packument['dist-tags'] : undefined;
    const latestVersion = tags?.latest;
    if (typeof latestVersion !== 'string' || !STABLE_VERSION_PATTERN.test(latestVersion)) {
      throw updateError('invalid-metadata', 'npm latest stable version is unavailable');
    }
    cache.set(packageName, { latestVersion, storedAt: now() });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return latestVersion;
  })();
  inFlight.set(packageName, request);
  void request.finally(() => {
    if (inFlight.get(packageName) === request) inFlight.delete(packageName);
  }).catch(() => undefined);
  return request;
}

function result(packageName, installedVersion, latestVersion) {
  return Object.freeze({
    packageName,
    installedVersion,
    latestVersion,
    updateAvailable: compareStableVersions(latestVersion, installedVersion) > 0,
  });
}

function compareStableVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function updateError(code, message) {
  const error = new Error(message);
  error.code = `update-check:${code}`;
  return error;
}
