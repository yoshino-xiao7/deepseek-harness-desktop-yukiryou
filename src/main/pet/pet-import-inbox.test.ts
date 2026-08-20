import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DraftPetPackageSummary } from '../../shared/pet-package.js';
import { openPetImportInbox } from './pet-import-inbox.js';

const packageSummary: DraftPetPackageSummary = {
  schemaVersion: 0,
  id: 'author.example-pet',
  name: { 'zh-CN': '示例宠物', en: 'Example Pet' },
  author: 'Example Author',
  license: 'MIT',
  source: 'local-original',
  packageContentHash: 'a'.repeat(64),
  fileCount: 3,
  expandedBytes: 1024,
};

describe('development pet import inbox', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('atomically seals a preflighted archive and restores only metadata after restart', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-inbox-'));
    temporaryDirectories.push(rootDirectory);
    const inbox = await openPetImportInbox(rootDirectory);

    const item = await inbox.seal(Buffer.from('validated archive bytes'), packageSummary);

    expect(item).toMatchObject({
      packageId: packageSummary.id,
      status: 'awaiting-runtime-validation',
      packageContentHash: packageSummary.packageContentHash,
    });
    const reopened = await openPetImportInbox(rootDirectory);
    expect(reopened.list()).toEqual([item]);
    const entries = (await readdir(rootDirectory)).sort();
    expect(entries).toEqual([`${item.archiveHash}.yukipet`, 'index.json']);
    await expect(readFile(join(rootDirectory, `${item.archiveHash}.yukipet`), 'utf8')).resolves.toBe('validated archive bytes');
  });

  it('persists the bounded runtime validation outcome without exposing payload paths', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-inbox-'));
    temporaryDirectories.push(rootDirectory);
    const inbox = await openPetImportInbox(rootDirectory);
    const item = await inbox.seal(Buffer.from('validated archive bytes'), packageSummary);

    await expect(inbox.setRuntimeStatus(item.id, 'runtime-compatible')).resolves.toMatchObject({
      id: item.id,
      status: 'runtime-compatible',
    });
    const reopened = await openPetImportInbox(rootDirectory);
    expect(reopened.list()).toMatchObject([{ id: item.id, status: 'runtime-compatible' }]);
  });
});
