import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openCompanionPreferenceStore } from './companion-preference-store.js';

describe('companion panel preference store', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('uses the default independently from visibility and restores a persisted width', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'companion-preference-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'desktop.json');
    const store = await openCompanionPreferenceStore(path);
    expect(store.getSnapshot()).toEqual({ open: true, preferredWidth: 380 });

    await store.save({ open: false, preferredWidth: 340 });
    const reopened = await openCompanionPreferenceStore(path);
    expect(reopened.getSnapshot()).toEqual({ open: false, preferredWidth: 340 });
  });

  it('preserves unrelated desktop preferences and rejects malformed panel values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'companion-preference-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'desktop.json');
    await writeFile(path, JSON.stringify({ existing: { keep: true }, companion: { open: 'yes', preferredWidth: 1 } }));
    const store = await openCompanionPreferenceStore(path);
    expect(store.getSnapshot()).toEqual({ open: true, preferredWidth: 380 });

    await store.save({ open: true, preferredWidth: 999 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      existing: { keep: true },
      companion: { open: true, preferredWidth: 560 },
    });
  });
});
