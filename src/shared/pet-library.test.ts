import { describe, expect, it, vi } from 'vitest';

import {
  createPetLibraryFake,
  parsePetLibraryCommand,
  validatedPetLibrarySnapshot,
  type PetAssetSummary,
} from './pet-library.js';

const builtInPet: PetAssetSummary = {
  id: 'builtin.default',
  name: 'Default Pet',
  author: 'YukiRyou',
  origin: 'built-in',
  status: 'ready',
  thumbnailUrl: 'dsh-pet://thumbnail/builtin.default',
  thumbnailRevision: 'sha256:default',
  license: 'Bundled asset license',
  source: 'bundled',
};

const importedPet: PetAssetSummary = {
  ...builtInPet,
  id: 'imported.example',
  name: 'Imported Pet',
  origin: 'imported',
  thumbnailUrl: 'dsh-pet://thumbnail/imported.example',
};

describe('pet library command boundary', () => {
  it('rejects an import request that attempts to smuggle a filesystem path', () => {
    expect(parsePetLibraryCommand({
      kind: 'import',
      expectedRevision: 0,
      path: '/Users/example/pet.yukipet',
    })).toBeUndefined();
  });

  it('rejects stale revisions without changing library state', async () => {
    const library = createPetLibraryFake({ assets: [builtInPet, importedPet] });

    await expect(library.request({
      kind: 'select',
      petId: importedPet.id,
      expectedRevision: 1,
    })).resolves.toEqual({ status: 'rejected', code: 'revision-conflict' });
    expect(library.getSnapshot()).toMatchObject({ revision: 0, activePetId: builtInPet.id });
  });

  it('keeps built-in pets immutable', async () => {
    const library = createPetLibraryFake({ assets: [builtInPet] });

    await expect(library.request({
      kind: 'remove',
      petId: builtInPet.id,
      expectedRevision: 0,
    })).resolves.toEqual({ status: 'rejected', code: 'built-in-immutable' });
  });

  it('publishes one new immutable snapshot after selecting a ready pet', async () => {
    const library = createPetLibraryFake({ assets: [builtInPet, importedPet] });
    const listener = vi.fn();
    library.subscribe(listener);

    await expect(library.request({
      kind: 'select',
      petId: importedPet.id,
      expectedRevision: 0,
    })).resolves.toMatchObject({ status: 'accepted', snapshot: { revision: 1, activePetId: importedPet.id } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(library.getSnapshot())).toBe(true);
  });

  it('rejects snapshots that expose a filesystem thumbnail URL', () => {
    const library = createPetLibraryFake({ assets: [builtInPet] });

    expect(validatedPetLibrarySnapshot({
      ...library.getSnapshot(),
      assets: [{ ...builtInPet, thumbnailUrl: 'file:///private/pet.png' }],
    })).toBeUndefined();
    expect(validatedPetLibrarySnapshot(library.getSnapshot())).toEqual(library.getSnapshot());
  });

  it('rechecks revision after an asynchronous import finishes', async () => {
    let finishImport: ((value: {
      status: 'accepted';
      item: {
        id: string; packageId: string; name: { 'zh-CN': string; en: string }; author: string;
        status: 'awaiting-runtime-validation'; archiveHash: string; packageContentHash: string;
      };
    }) => void) | undefined;
    const importResult = new Promise<Parameters<NonNullable<typeof finishImport>>[0]>((resolve) => {
      finishImport = resolve;
    });
    const library = createPetLibraryFake({
      assets: [builtInPet],
      importPet: () => importResult,
    });
    const pendingImport = library.request({ kind: 'import', expectedRevision: 0 });
    await library.request({ kind: 'set-enabled', enabled: false, expectedRevision: 0 });
    const hash = 'a'.repeat(64);
    finishImport?.({
      status: 'accepted',
      item: {
        id: hash,
        packageId: 'author.example',
        name: { 'zh-CN': '示例', en: 'Example' },
        author: 'Author',
        status: 'awaiting-runtime-validation',
        archiveHash: hash,
        packageContentHash: hash,
      },
    });

    await expect(pendingImport).resolves.toEqual({ status: 'rejected', code: 'revision-conflict' });
    expect(library.getSnapshot()).toMatchObject({ revision: 1, inbox: [] });
  });
});
