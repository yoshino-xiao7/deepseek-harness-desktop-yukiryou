import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const FILE_NAME = 'desktop-market-sources.json';
const MAX_FILE_BYTES = 64 * 1024;
const MAX_SOURCES = 20;
const CUSTOM_SOURCE_ID = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function createSourceRegistry(options = {}) {
  const store = options.store ?? createFileStore(options.root);
  const createId = options.createId ?? (() => `custom-${randomUUID()}`);
  let state;
  let queue = Promise.resolve();

  async function load() {
    if (state !== undefined) return state;
    state = normalizeRecords(await store.load());
    return state;
  }

  return Object.freeze({
    async list() {
      return load();
    },
    mutate(operation) {
      const task = queue.then(async () => {
        const current = await load();
        const next = applyMutation(current, operation, createId);
        await store.save(next);
        state = next;
        return next;
      });
      queue = task.catch(() => undefined);
      return task;
    },
  });
}

function applyMutation(current, operation, createId) {
  if (!isRecord(operation) || typeof operation.kind !== 'string') throw sourceError('invalid-operation', 'Invalid source operation');
  if (operation.kind === 'add') {
    if (current.length >= MAX_SOURCES) throw sourceError('source-limit', 'Custom source limit reached');
    const displayName = boundedString(operation.displayName, 80);
    const url = normalizeCatalogUrl(operation.url);
    if (!displayName || !url) throw sourceError('invalid-source', 'Invalid custom source');
    if (current.some((entry) => entry.url === url)) throw sourceError('duplicate-source', 'Catalog URL already exists');
    const id = createId();
    if (!CUSTOM_SOURCE_ID.test(id) || current.some((entry) => entry.id === id)) throw sourceError('invalid-source-id', 'Invalid generated source id');
    return freezeRecords([...current, { id, displayName, url, enabled: true }]);
  }
  const sourceId = typeof operation.sourceId === 'string' ? operation.sourceId : '';
  const index = current.findIndex((entry) => entry.id === sourceId);
  if (index < 0) throw sourceError('source-not-found', 'Custom source not found');
  if (operation.kind === 'set-enabled' && typeof operation.enabled === 'boolean') {
    return freezeRecords(current.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, enabled: operation.enabled }
      : entry));
  }
  if (operation.kind === 'remove') return freezeRecords(current.filter((_, entryIndex) => entryIndex !== index));
  if (operation.kind === 'move' && (operation.direction === 'up' || operation.direction === 'down')) {
    const destination = operation.direction === 'up' ? index - 1 : index + 1;
    if (destination < 0 || destination >= current.length) return current;
    const next = [...current];
    [next[index], next[destination]] = [next[destination], next[index]];
    return freezeRecords(next);
  }
  throw sourceError('invalid-operation', 'Invalid source operation');
}

function normalizeRecords(raw) {
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw) || raw.length > MAX_SOURCES) throw sourceError('invalid-storage', 'Invalid source registry');
  const ids = new Set();
  const urls = new Set();
  const records = raw.map((entry) => {
    if (!isRecord(entry) || !CUSTOM_SOURCE_ID.test(entry.id ?? '') || typeof entry.enabled !== 'boolean') {
      throw sourceError('invalid-storage', 'Invalid stored source');
    }
    const displayName = boundedString(entry.displayName, 80);
    const url = normalizeCatalogUrl(entry.url);
    if (!displayName || !url || ids.has(entry.id) || urls.has(url)) throw sourceError('invalid-storage', 'Invalid stored source identity');
    ids.add(entry.id);
    urls.add(url);
    return { id: entry.id, displayName, url, enabled: entry.enabled };
  });
  return freezeRecords(records);
}

function freezeRecords(records) {
  return Object.freeze(records.map((entry, order) => Object.freeze({ ...entry, order })));
}

function normalizeCatalogUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return undefined;
    if (!url.pathname || url.pathname === '/') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function createFileStore(root = process.env.DSH_HOME) {
  if (typeof root !== 'string' || root.length === 0) return memoryStore();
  const path = join(root, FILE_NAME);
  return Object.freeze({
    async load() {
      try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES) {
          throw sourceError('invalid-storage', 'Stored source registry is unsafe');
        }
        const encoded = await readFile(path, 'utf8');
        if (Buffer.byteLength(encoded, 'utf8') > MAX_FILE_BYTES) throw sourceError('invalid-storage', 'Stored source registry is too large');
        const envelope = JSON.parse(encoded);
        if (!isRecord(envelope) || envelope.schemaVersion !== 1) throw sourceError('invalid-storage', 'Stored source registry is invalid');
        return envelope.sources;
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        if (typeof error?.code === 'string' && error.code.startsWith('catalog:')) throw error;
        throw sourceError('invalid-storage', 'Could not read stored source registry');
      }
    },
    async save(sources) {
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      const encoded = JSON.stringify({ schemaVersion: 1, sources });
      if (Buffer.byteLength(encoded, 'utf8') > MAX_FILE_BYTES) throw sourceError('storage-limit', 'Source registry exceeds storage budget');
      const rootMetadata = await lstat(root);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw sourceError('invalid-storage-path', 'Runtime Home is unsafe');
      try {
        await writeFile(temporaryPath, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporaryPath, path);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    },
  });
}

function memoryStore() {
  let state;
  return Object.freeze({ load: async () => state, save: async (value) => { state = value; } });
}

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceError(code, message) {
  const error = new Error(message);
  error.code = `catalog:${code}`;
  return error;
}
