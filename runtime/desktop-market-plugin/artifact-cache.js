import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  statfs,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const CACHE_DIRECTORY = 'desktop-market-artifacts-v1';
const DEFAULT_QUOTA_BYTES = 512 * 1024 * 1024;
const DEFAULT_MINIMUM_FREE_BYTES = 256 * 1024 * 1024;
const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_PROFILE_STATE_BYTES = 1024 * 1024;
const DIGEST_PATTERN = /^sha512:[0-9a-f]{128}$/u;
const FILE_PATTERN = /^([0-9a-f]{128})\.tgz$/u;

/**
 * Owns content-addressed artifact persistence, disk budgets, LRU eviction and
 * reference protection behind one narrow Interface.
 */
export function createArtifactCache(options = {}) {
  const root = options.root ?? process.env.DSH_HOME;
  if (typeof root !== 'string' || root.length === 0) return disabledCache();
  const io = options.io ?? {
    lstat, mkdir, readFile, readdir, rename, statfs, unlink, utimes, writeFile,
  };
  const quotaBytes = boundedBudget(options.quotaBytes, DEFAULT_QUOTA_BYTES, 1);
  const minimumFreeBytes = boundedBudget(options.minimumFreeBytes, DEFAULT_MINIMUM_FREE_BYTES, 0);
  const now = options.now ?? Date.now;
  const protectedDigests = options.protectedDigests ?? (() => readProfileReferences(root, io));
  const directory = join(root, CACHE_DIRECTORY);
  const leases = new Map();
  let operation = Promise.resolve();

  const exclusive = (work) => {
    const result = operation.then(work, work);
    operation = result.then(() => undefined, () => undefined);
    return result;
  };

  return Object.freeze({
    enabled: true,
    async read(digest) {
      assertDigest(digest);
      return exclusive(async () => {
        const path = objectPath(directory, digest);
        try {
          const metadata = await io.lstat(path);
          assertCacheObject(metadata, MAX_TARBALL_BYTES);
          const bytes = await io.readFile(path);
          if (!Buffer.isBuffer(bytes) || sha512(bytes) !== digest) {
            throw cacheError('invalid-object', 'Artifact cache entry failed integrity');
          }
          const timestamp = new Date(now());
          await io.utimes(path, timestamp, timestamp);
          return bytes;
        } catch (error) {
          if (error?.code === 'ENOENT') return undefined;
          throw error;
        }
      });
    },
    async put({ digest, bytes }) {
      assertDigest(digest);
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_TARBALL_BYTES ||
        sha512(bytes) !== digest) {
        throw cacheError('invalid-object', 'Invalid artifact cache object');
      }
      return exclusive(async () => {
        await ensureSafeDirectory(directory, io);
        const path = objectPath(directory, digest);
        const existing = await readExisting(path, digest, bytes.length, io);
        if (existing) {
          const timestamp = new Date(now());
          await io.utimes(path, timestamp, timestamp);
          return;
        }
        await assertFreeDisk(directory, bytes.length, minimumFreeBytes, io);
        const entries = await scanCache(directory, io);
        const persistent = await protectedDigests();
        const protectedSet = new Set([...leases.keys(), ...normalizeDigests(persistent)]);
        let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
        const candidates = entries
          .filter((entry) => !protectedSet.has(entry.digest))
          .sort((left, right) => left.lastAccess - right.lastAccess || left.digest.localeCompare(right.digest));
        while (totalBytes + bytes.length > quotaBytes && candidates.length > 0) {
          const entry = candidates.shift();
          await io.unlink(entry.path);
          totalBytes -= entry.size;
        }
        if (totalBytes + bytes.length > quotaBytes) {
          throw cacheError('quota-exhausted', 'Artifact cache quota is held by referenced objects');
        }
        const temporaryPath = `${path}.${randomUUID()}.tmp`;
        try {
          await io.writeFile(temporaryPath, bytes, { mode: 0o600, flag: 'wx' });
          const timestamp = new Date(now());
          await io.utimes(temporaryPath, timestamp, timestamp);
          await io.rename(temporaryPath, path);
        } catch (error) {
          await io.unlink(temporaryPath).catch(() => undefined);
          throw cacheError('write', 'Could not persist verified artifact', error);
        }
      });
    },
    hold(digests) {
      const normalized = normalizeDigests(digests);
      for (const digest of normalized) leases.set(digest, (leases.get(digest) ?? 0) + 1);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        for (const digest of normalized) {
          const count = leases.get(digest) ?? 0;
          if (count <= 1) leases.delete(digest);
          else leases.set(digest, count - 1);
        }
      };
    },
    async collect() {
      return exclusive(async () => {
        await ensureSafeDirectory(directory, io);
        const entries = await scanCache(directory, io);
        const persistent = await protectedDigests();
        const protectedSet = new Set([...leases.keys(), ...normalizeDigests(persistent)]);
        let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
        let removedObjects = 0;
        let removedBytes = 0;
        for (const entry of entries
          .filter((item) => !protectedSet.has(item.digest))
          .sort((left, right) => left.lastAccess - right.lastAccess || left.digest.localeCompare(right.digest))) {
          if (totalBytes <= quotaBytes) break;
          await io.unlink(entry.path);
          totalBytes -= entry.size;
          removedObjects += 1;
          removedBytes += entry.size;
        }
        return Object.freeze({ totalBytes, removedBytes, removedObjects, quotaBytes });
      });
    },
  });
}

async function scanCache(directory, io) {
  const names = await io.readdir(directory);
  const entries = [];
  for (const name of names) {
    const match = FILE_PATTERN.exec(name);
    if (match === null) continue;
    const path = join(directory, name);
    const metadata = await io.lstat(path);
    assertCacheObject(metadata, MAX_TARBALL_BYTES);
    entries.push(Object.freeze({
      digest: `sha512:${match[1]}`,
      path,
      size: metadata.size,
      lastAccess: Number.isFinite(metadata.mtimeMs) ? metadata.mtimeMs : 0,
    }));
  }
  return entries;
}

async function readExisting(path, digest, expectedSize, io) {
  try {
    const metadata = await io.lstat(path);
    assertCacheObject(metadata, MAX_TARBALL_BYTES);
    if (metadata.size !== expectedSize) throw cacheError('invalid-object', 'Artifact cache entry size changed');
    const bytes = await io.readFile(path);
    if (!Buffer.isBuffer(bytes) || sha512(bytes) !== digest) {
      throw cacheError('invalid-object', 'Artifact cache entry failed integrity');
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureSafeDirectory(directory, io) {
  await io.mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await io.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw cacheError('unsafe-path', 'Artifact cache directory is unsafe');
  }
}

async function assertFreeDisk(directory, requiredBytes, minimumFreeBytes, io) {
  const state = await io.statfs(directory);
  const available = numericProduct(state.bavail, state.bsize);
  if (available < requiredBytes + minimumFreeBytes) {
    throw cacheError('disk-space', 'Insufficient free disk space for verified artifact');
  }
}

async function readProfileReferences(root, io) {
  const references = new Set();
  const profileRoot = join(root, 'plugin-management');
  for (const [name, collect] of [
    ['receipts.json', receiptReferences],
    ['load-state.json', pendingReferences],
  ]) {
    const path = join(profileRoot, name);
    try {
      const metadata = await io.lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_PROFILE_STATE_BYTES) {
        throw cacheError('protection-state', 'Plugin profile cache references are unsafe');
      }
      const parsed = JSON.parse(await io.readFile(path, 'utf8'));
      for (const digest of normalizeDigests(collect(parsed))) references.add(digest);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error?.code?.startsWith('catalog:cache-')) throw error;
        throw cacheError('protection-state', 'Plugin profile cache references are invalid', error);
      }
    }
  }
  return references;
}

function receiptReferences(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.receipts)) {
    throw cacheError('protection-state', 'Plugin receipt cache references are invalid');
  }
  const result = [];
  for (const receipt of value.receipts) {
    if (!isRecord(receipt)) throw cacheError('protection-state', 'Plugin receipt is invalid');
    const digests = receipt.cacheDigests ?? [];
    if (!Array.isArray(digests)) throw cacheError('protection-state', 'Plugin receipt cache references are invalid');
    result.push(...digests);
    if (receipt.rollbackTarget !== undefined && receipt.rollbackTarget !== null) {
      if (!isRecord(receipt.rollbackTarget) || !Array.isArray(receipt.rollbackTarget.cacheDigests ?? [])) {
        throw cacheError('protection-state', 'Plugin rollback cache references are invalid');
      }
      result.push(...(receipt.rollbackTarget.cacheDigests ?? []));
    }
  }
  return result;
}

function pendingReferences(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
    (value.pending !== null && !isRecord(value.pending))) {
    throw cacheError('protection-state', 'Pending plugin cache references are invalid');
  }
  if (value.pending === null) return [];
  const digests = value.pending.cacheDigests ?? [];
  if (!Array.isArray(digests)) throw cacheError('protection-state', 'Pending plugin cache references are invalid');
  return digests;
}

function disabledCache() {
  return Object.freeze({
    enabled: false,
    read: async () => undefined,
    put: async () => undefined,
    hold: () => () => undefined,
    collect: async () => Object.freeze({ totalBytes: 0, removedBytes: 0, removedObjects: 0, quotaBytes: 0 }),
  });
}

function normalizeDigests(values) {
  if (!Array.isArray(values) && !(values instanceof Set)) {
    throw cacheError('invalid-reference', 'Artifact cache references must be a collection');
  }
  const result = [...values];
  if (result.length > 256 || result.some((digest) => !DIGEST_PATTERN.test(digest ?? ''))) {
    throw cacheError('invalid-reference', 'Artifact cache reference is invalid');
  }
  return [...new Set(result)].sort();
}

function objectPath(directory, digest) {
  return join(directory, `${digest.slice('sha512:'.length)}.tgz`);
}

function assertDigest(digest) {
  if (!DIGEST_PATTERN.test(digest ?? '')) throw cacheError('invalid-object', 'Invalid artifact cache identity');
}

function assertCacheObject(metadata, maximumSize) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumSize) {
    throw cacheError('invalid-object', 'Artifact cache entry is unsafe');
  }
}

function boundedBudget(value, fallback, minimum) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > Number.MAX_SAFE_INTEGER) {
    throw cacheError('invalid-options', 'Artifact cache budget is invalid');
  }
  return result;
}

function numericProduct(left, right) {
  const value = typeof left === 'bigint' || typeof right === 'bigint'
    ? Number(BigInt(left) * BigInt(right))
    : left * right;
  return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;
}

function sha512(bytes) {
  return `sha512:${createHash('sha512').update(bytes).digest('hex')}`;
}

function cacheError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = `catalog:cache-${code}`;
  return error;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
