import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const CACHE_DIRECTORY = 'desktop-market-cache';
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const SOURCE_IDS = new Set(['dshfind', 'yukiryou-curated', 'dsh-1024store', 'github-topic-dsh-plugin']);
const CUSTOM_SOURCE_ID = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function createCatalogSnapshotStore(options = {}) {
  const root = options.root ?? process.env.DSH_HOME;
  const io = options.io ?? { lstat, mkdir, readFile, rename, unlink, writeFile };
  if (typeof root !== 'string' || root.length === 0) return disabledStore();
  const directory = join(root, CACHE_DIRECTORY);

  return Object.freeze({
    async load(sourceId) {
      const path = cachePath(directory, sourceId);
      try {
        const metadata = await io.lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_CACHE_BYTES) return undefined;
        const encoded = await io.readFile(path, 'utf8');
        if (Buffer.byteLength(encoded, 'utf8') > MAX_CACHE_BYTES) return undefined;
        const envelope = JSON.parse(encoded);
        if (
          !isRecord(envelope) || envelope.schemaVersion !== 1 ||
          !Number.isSafeInteger(envelope.storedAt) || envelope.storedAt < 0 ||
          !isRecord(envelope.snapshot)
        ) return undefined;
        return Object.freeze({ storedAt: envelope.storedAt, snapshot: envelope.snapshot });
      } catch {
        return undefined;
      }
    },
    async save(sourceId, snapshot, storedAt) {
      const path = cachePath(directory, sourceId);
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      const encoded = JSON.stringify({ schemaVersion: 1, storedAt, snapshot });
      if (Buffer.byteLength(encoded, 'utf8') > MAX_CACHE_BYTES) return;
      await io.mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryMetadata = await io.lstat(directory);
      if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
        throw catalogError('invalid-cache-path', 'Catalog cache directory is unsafe');
      }
      try {
        await io.writeFile(temporaryPath, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await io.rename(temporaryPath, path);
      } catch (error) {
        await io.unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    },
  });
}

function cachePath(directory, sourceId) {
  if (!SOURCE_IDS.has(sourceId) && !CUSTOM_SOURCE_ID.test(sourceId)) throw catalogError('invalid-source', 'Unknown catalog cache source');
  return join(directory, `catalog-v2-${sourceId}.json`);
}

function disabledStore() {
  return Object.freeze({ load: async () => undefined, save: async () => undefined });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function catalogError(code, message) {
  const error = new Error(message);
  error.code = `catalog:${code}`;
  return error;
}
