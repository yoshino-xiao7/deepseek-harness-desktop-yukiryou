import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPngHeader } from './pet-package-test-helper.js';
import { openPetThumbnailStore } from './pet-thumbnail-store.js';

describe('pet thumbnail store', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'pet-thumbnail-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  it('only resolves the exact registered opaque id and revision', async () => {
    const directory = await temporaryDirectory();
      const thumbnailPath = join(directory, 'thumbnail.png');
      const data = createPngHeader({ width: 256, height: 256 });
      await writeFile(thumbnailPath, data);
      const store = openPetThumbnailStore([{ id: 'builtin.pet', revision: 'draft-0', mediaType: 'image/png', path: thumbnailPath }]);

      await expect(store.resolve('dsh-pet://thumbnail/builtin.pet/draft-0')).resolves.toMatchObject({
        status: 'ok',
        mediaType: 'image/png',
        data,
      });
      await expect(store.resolve('dsh-pet://thumbnail/builtin.pet/wrong')).resolves.toEqual({ status: 'not-found' });
      await expect(store.resolve('dsh-pet://thumbnail/missing/draft-0')).resolves.toEqual({ status: 'not-found' });
  });

  it('rejects malformed URLs, traversal spellings, query strings, and symlink targets', async () => {
    const directory = await temporaryDirectory();
      const outsidePath = join(directory, 'outside.png');
      const assetDirectory = join(directory, 'assets');
      const linkPath = join(assetDirectory, 'thumbnail.png');
      await mkdir(assetDirectory);
      await writeFile(outsidePath, createPngHeader({ width: 64, height: 64 }));
      await symlink(outsidePath, linkPath);
      const store = openPetThumbnailStore([{ id: 'builtin.pet', revision: 'draft-0', mediaType: 'image/png', path: linkPath }]);

      for (const url of [
        'https://thumbnail/builtin.pet/draft-0',
        'dsh-pet://other/builtin.pet/draft-0',
        'dsh-pet://thumbnail/builtin.pet/draft-0?cache=no',
        'dsh-pet://thumbnail/%2e%2e%2foutside/draft-0',
        'dsh-pet://thumbnail/builtin.pet/draft-0/extra',
      ]) {
        await expect(store.resolve(url)).resolves.toEqual({ status: 'not-found' });
      }
      await expect(store.resolve('dsh-pet://thumbnail/builtin.pet/draft-0')).resolves.toEqual({ status: 'not-found' });
  });

  it('rejects mismatched media bytes, oversized dimensions, and oversized files', async () => {
    const directory = await temporaryDirectory();
      const invalidPath = join(directory, 'invalid.png');
      const hugeDimensionsPath = join(directory, 'huge.png');
      const oversizedPath = join(directory, 'oversized.png');
      await writeFile(invalidPath, Buffer.from('not a png'));
      await writeFile(hugeDimensionsPath, createPngHeader({ width: 2048, height: 2048 }));
      await writeFile(oversizedPath, Buffer.alloc(1024 * 1024 + 1));
      const store = openPetThumbnailStore([
        { id: 'invalid', revision: '1', mediaType: 'image/png', path: invalidPath },
        { id: 'dimensions', revision: '1', mediaType: 'image/png', path: hugeDimensionsPath },
        { id: 'oversized', revision: '1', mediaType: 'image/png', path: oversizedPath },
      ]);

      for (const id of ['invalid', 'dimensions', 'oversized']) {
        await expect(store.resolve(`dsh-pet://thumbnail/${id}/1`)).resolves.toEqual({ status: 'not-found' });
      }
  });
});
