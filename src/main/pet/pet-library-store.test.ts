import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PetAssetSummary } from '../../shared/pet-library.js';
import { openPetLibraryStore } from './pet-library-store.js';
import { createDraftPetArchive } from './pet-package-test-helper.js';
import type { PetRuntimeValidator } from './pet-runtime-validator.js';

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

describe('pet library store', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('persists enabled state and revision through the PetLibrary interface', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-store-'));
    temporaryDirectories.push(rootDirectory);
    const library = await openPetLibraryStore({ rootDirectory, builtInAssets: [builtInPet] });

    await expect(library.request({
      kind: 'set-enabled',
      enabled: false,
      expectedRevision: 0,
    })).resolves.toMatchObject({ status: 'accepted', snapshot: { enabled: false, revision: 1 } });

    const reopened = await openPetLibraryStore({ rootDirectory, builtInAssets: [builtInPet] });
    expect(reopened.getSnapshot()).toMatchObject({
      enabled: false,
      activePetId: builtInPet.id,
      revision: 1,
    });
    await expect(readFile(join(rootDirectory, 'library.json'), 'utf8')).resolves.toContain('"schemaVersion": 0');
  });

  it('returns cancellation without changing state when the system picker yields no archive', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-store-'));
    temporaryDirectories.push(rootDirectory);
    const library = await openPetLibraryStore({
      rootDirectory,
      builtInAssets: [builtInPet],
      developmentInboxEnabled: true,
      chooseArchive: async () => undefined,
    });

    await expect(library.request({ kind: 'import', expectedRevision: 0 })).resolves.toEqual({ status: 'cancelled' });
    expect(library.getSnapshot()).toMatchObject({ revision: 0, inbox: [] });
  });

  it('keeps a malformed archive out of both the library and development Inbox', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-store-'));
    temporaryDirectories.push(rootDirectory);
    const library = await openPetLibraryStore({
      rootDirectory,
      builtInAssets: [builtInPet],
      developmentInboxEnabled: true,
      chooseArchive: async () => Buffer.from('not a zip'),
    });

    await expect(library.request({ kind: 'import', expectedRevision: 0 })).resolves.toEqual({
      status: 'rejected',
      code: 'package-invalid',
    });
    expect(library.getSnapshot()).toMatchObject({ revision: 0, assets: [builtInPet], inbox: [] });
  });

  it('turns picker/read failures into a bounded result instead of rejecting IPC', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-store-'));
    temporaryDirectories.push(rootDirectory);
    const library = await openPetLibraryStore({
      rootDirectory,
      builtInAssets: [builtInPet],
      developmentInboxEnabled: true,
      chooseArchive: async () => {
        throw new Error('selected file disappeared');
      },
    });

    await expect(library.request({ kind: 'import', expectedRevision: 0 })).resolves.toEqual({
      status: 'rejected',
      code: 'package-invalid',
    });
  });

  it('keeps a preflighted draft package in the development Inbox after restart', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-store-'));
    temporaryDirectories.push(rootDirectory);
    const archive = createDraftPetArchive();
    const library = await openPetLibraryStore({
      rootDirectory,
      builtInAssets: [builtInPet],
      developmentInboxEnabled: true,
      chooseArchive: async () => archive,
    });

    await expect(library.request({ kind: 'import', expectedRevision: 0 })).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        revision: 1,
        assets: [builtInPet],
        inbox: [{ packageId: 'author.example-pet', status: 'awaiting-runtime-validation' }],
      },
    });

    const reopened = await openPetLibraryStore({
      rootDirectory,
      builtInAssets: [builtInPet],
      developmentInboxEnabled: true,
    });
    expect(reopened.getSnapshot()).toMatchObject({ revision: 1, inbox: [{ packageId: 'author.example-pet' }] });
  });

  it('records an isolated runtime-compatible result without promoting it to a ready asset', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'yukiryou-pet-store-'));
    temporaryDirectories.push(rootDirectory);
    const archive = createDraftPetArchive();
    const runtimeValidator: PetRuntimeValidator = {
      async validate() {
        return {
          status: 'accepted',
          package: {
            schemaVersion: 0,
            id: 'author.example-pet',
            name: { 'zh-CN': '示例宠物', en: 'Example Pet' },
            author: 'Example Author',
            license: 'MIT',
            source: 'local-original',
            packageContentHash: 'a'.repeat(64),
            fileCount: 3,
            expandedBytes: 1024,
          },
          playerAsset: {
            runtime: 'rive-canvas-lite',
            assetSha256: 'b'.repeat(64),
            assetBytes: new Uint8Array([1]).buffer,
          },
        };
      },
    };
    const library = await openPetLibraryStore({
      rootDirectory,
      builtInAssets: [builtInPet],
      developmentInboxEnabled: true,
      chooseArchive: async () => archive,
      runtimeValidator,
    });

    await expect(library.request({ kind: 'import', expectedRevision: 0 })).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        assets: [builtInPet],
        inbox: [{ packageId: 'author.example-pet', status: 'runtime-compatible' }],
      },
    });
  });
});
