import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import semver from 'semver';

const MAX_LOCK_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGES = 2_048;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const DEFAULT_LOCK_URL = new URL('../../../package-lock.json', import.meta.url);

export function createRuntimeSnapshot(options = {}) {
  const readLock = options.readLock ?? (() => readBoundedFile(DEFAULT_LOCK_URL));
  let pending;

  return Object.freeze({
    async read() {
      pending ??= Promise.resolve(readLock()).then(normalizeLock).catch((error) => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
  });
}

async function readBoundedFile(url) {
  const bytes = await readFile(url);
  if (bytes.length > MAX_LOCK_BYTES) throw snapshotError('budget', 'Runtime lock exceeded size budget');
  return bytes.toString('utf8');
}

function normalizeLock(source) {
  let lock;
  try {
    lock = typeof source === 'string' ? JSON.parse(source) : source;
  } catch {
    throw snapshotError('invalid', 'Runtime lock is invalid JSON');
  }
  if (!isRecord(lock) || lock.lockfileVersion !== 3 || !isRecord(lock.packages)) {
    throw snapshotError('invalid', 'Runtime lock has an unsupported schema');
  }
  const packages = [];
  for (const [path, manifest] of Object.entries(lock.packages)) {
    const name = topLevelPackageName(path);
    if (name === undefined) continue;
    if (!isRecord(manifest) || typeof manifest.version !== 'string' || semver.valid(manifest.version) === null) {
      throw snapshotError('invalid', 'Runtime package has an invalid version');
    }
    packages.push(Object.freeze({ name, version: manifest.version }));
    if (packages.length > MAX_PACKAGES) throw snapshotError('budget', 'Runtime package snapshot exceeded budget');
  }
  packages.sort((left, right) => left.name.localeCompare(right.name));
  if (packages.length === 0 || new Set(packages.map((entry) => entry.name)).size !== packages.length) {
    throw snapshotError('invalid', 'Runtime package snapshot is empty or ambiguous');
  }
  const hash = `sha256:${createHash('sha256').update(JSON.stringify({ schemaVersion: 1, packages })).digest('hex')}`;
  return Object.freeze({ schemaVersion: 1, hash, packages: Object.freeze(packages) });
}

function topLevelPackageName(path) {
  if (typeof path !== 'string' || !path.startsWith('node_modules/')) return undefined;
  const remainder = path.slice('node_modules/'.length);
  const segments = remainder.split('/');
  const name = remainder.startsWith('@') && segments.length === 2
    ? `${segments[0]}/${segments[1]}`
    : segments.length === 1 ? segments[0] : undefined;
  return name !== undefined && PACKAGE_NAME_PATTERN.test(name) ? name : undefined;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapshotError(code, message) {
  const error = new Error(message);
  error.code = `catalog:runtime-snapshot-${code}`;
  error.check = 'peer-compatibility';
  return error;
}
