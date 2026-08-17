import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { prepareUserDataLocation } from './user-data-location.js';

describe('branded user data location', () => {
  it('copies legacy application data without removing the backup', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'deepseek-yukiryou-data-'));
    const legacy = join(appData, 'DSH Desktop');
    await mkdir(legacy);
    await writeFile(join(legacy, 'desktop.json'), 'preserved');

    const result = await prepareUserDataLocation(appData);

    expect(result).toBe(join(appData, 'DeepSeek YukiRyou'));
    await expect(readFile(join(result, 'desktop.json'), 'utf8')).resolves.toBe(
      'preserved',
    );
    await expect(
      readFile(join(legacy, 'desktop.json'), 'utf8'),
    ).resolves.toBe('preserved');
  });

  it('merges into Electron bootstrap data before marking migration complete', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'deepseek-yukiryou-data-'));
    const legacy = join(appData, 'DSH Desktop');
    const product = join(appData, 'DeepSeek YukiRyou');
    await mkdir(legacy);
    await mkdir(product);
    await writeFile(join(legacy, 'session.json'), 'legacy-session');
    await writeFile(join(product, 'Local State'), 'new-bootstrap');

    await prepareUserDataLocation(appData);

    await expect(readFile(join(product, 'session.json'), 'utf8')).resolves.toBe(
      'legacy-session',
    );
    await expect(readFile(join(product, 'Local State'), 'utf8')).resolves.toBe(
      'new-bootstrap',
    );
    await expect(
      readFile(join(product, '.migrated-from-dsh-desktop'), 'utf8'),
    ).resolves.toContain('legacy directory was preserved');
  });
});
