import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { PetImportInboxItem } from '../../shared/pet-library.js';
import { PET_PACKAGE_LIMITS, type DraftPetPackageSummary } from '../../shared/pet-package.js';

export interface PetImportInbox {
  list(): readonly PetImportInboxItem[];
  seal(archive: Uint8Array, packageSummary: DraftPetPackageSummary): Promise<PetImportInboxItem>;
  setRuntimeStatus(id: string, status: 'runtime-compatible' | 'runtime-rejected'): Promise<PetImportInboxItem>;
}

export async function openPetImportInbox(rootDirectory: string): Promise<PetImportInbox> {
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const indexPath = join(rootDirectory, 'index.json');
  let items = await readIndex(indexPath);

  return {
    list: () => items,
    async seal(archive, packageSummary) {
      if (archive.byteLength > PET_PACKAGE_LIMITS.archiveBytes) throw new Error('pet archive exceeds preflight limit');
      const archiveBuffer = Buffer.from(archive);
      const archiveHash = createHash('sha256').update(archiveBuffer).digest('hex');
      const existing = items.find((item) => item.archiveHash === archiveHash);
      if (existing !== undefined) return existing;
      const item: PetImportInboxItem = Object.freeze({
        id: archiveHash,
        packageId: packageSummary.id,
        name: Object.freeze({ ...packageSummary.name }),
        author: packageSummary.author,
        status: 'awaiting-runtime-validation',
        archiveHash,
        packageContentHash: packageSummary.packageContentHash,
      });
      const archivePath = join(rootDirectory, `${archiveHash}.yukipet`);
      await atomicWrite(archivePath, archiveBuffer);
      const nextItems = Object.freeze([...items, item].sort((left, right) => left.id.localeCompare(right.id)));
      await atomicWrite(indexPath, Buffer.from(`${JSON.stringify({ schemaVersion: 0, items: nextItems }, null, 2)}\n`));
      items = nextItems;
      return item;
    },
    async setRuntimeStatus(id, status) {
      const existing = items.find((item) => item.id === id);
      if (existing === undefined) throw new Error('pet inbox item not found');
      if (existing.status === status) return existing;
      const updated = Object.freeze({ ...existing, status });
      const nextItems = Object.freeze(items.map((item) => item.id === id ? updated : item));
      await atomicWrite(indexPath, Buffer.from(`${JSON.stringify({ schemaVersion: 0, items: nextItems }, null, 2)}\n`));
      items = nextItems;
      return updated;
    },
  };
}

async function atomicWrite(targetPath: string, data: Buffer): Promise<void> {
  const temporaryPath = `${targetPath}.staging-${randomUUID()}`;
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readIndex(indexPath: string): Promise<readonly PetImportInboxItem[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    return Object.freeze([]);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 0 || !Array.isArray(parsed.items)) return Object.freeze([]);
  const items: PetImportInboxItem[] = [];
  for (const value of parsed.items) {
    const item = parseItem(value);
    if (item === undefined) return Object.freeze([]);
    items.push(item);
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) return Object.freeze([]);
  return Object.freeze(items.sort((left, right) => left.id.localeCompare(right.id)));
}

function parseItem(value: unknown): PetImportInboxItem | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'packageId', 'name', 'author', 'status', 'archiveHash', 'packageContentHash',
  ])) return undefined;
  if (
    typeof value.id !== 'string'
    || typeof value.packageId !== 'string'
    || typeof value.author !== 'string'
    || (value.status !== 'awaiting-runtime-validation'
      && value.status !== 'runtime-compatible'
      && value.status !== 'runtime-rejected')
    || typeof value.archiveHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.archiveHash)
    || value.id !== value.archiveHash
    || typeof value.packageContentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.packageContentHash)
    || !isRecord(value.name)
    || !hasExactKeys(value.name, ['zh-CN', 'en'])
    || typeof value.name['zh-CN'] !== 'string'
    || typeof value.name.en !== 'string'
  ) return undefined;
  return Object.freeze({
    id: value.id,
    packageId: value.packageId,
    name: Object.freeze({ 'zh-CN': value.name['zh-CN'], en: value.name.en }),
    author: value.author,
    status: value.status,
    archiveHash: value.archiveHash,
    packageContentHash: value.packageContentHash,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
