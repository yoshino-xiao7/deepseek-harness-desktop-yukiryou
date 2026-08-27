import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPackage, extractAll } from '@electron/asar';
import { describe, expect, it } from 'vitest';

import { patchPackagedUpdateOrigin } from '../../scripts/patch-packaged-update-origin.js';

describe('packaged update origin patch', () => {
  it('rewrites only the expected origin inside an installed app archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-update-origin-'));
    const source = join(root, 'source');
    const archive = join(root, 'app.asar');
    const extracted = join(root, 'extracted');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(source));
    await writeFile(
      join(source, 'main.js'),
      "const origin='https://download-cn.suzuki.ink';\n",
    );
    try {
      await createPackage(source, archive);
      await patchPackagedUpdateOrigin({
        archive,
        from: 'https://download-cn.suzuki.ink',
        to: 'https://127.0.0.1.nip.io:41337',
      });
      extractAll(archive, extracted);
      expect(await readFile(join(extracted, 'main.js'), 'utf8')).toBe(
        "const origin='https://127.0.0.1.nip.io:41337';\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
