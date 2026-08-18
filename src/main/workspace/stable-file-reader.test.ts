import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readStableRegularFile } from './stable-file-reader.js';

describe('stable workspace file reader', () => {
  it('refuses a symlink even when its target is a regular file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stable-file-reader-'));
    const outside = await mkdtemp(join(tmpdir(), 'stable-file-reader-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'swapped.txt'));

    await expect(readStableRegularFile(join(root, 'swapped.txt'), 1024)).resolves.toEqual({ kind: 'unsafe-type' });
  });
});
