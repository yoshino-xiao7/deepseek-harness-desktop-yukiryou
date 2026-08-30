import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDesktopFeaturePreferencesPersistence } from './desktop-feature-preferences.js';

describe('desktop feature preferences persistence', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it('defaults the optional desktop workspace surface to enabled', async () => {
    directory = await mkdtemp(join(tmpdir(), 'desktop-feature-preferences-'));
    const store = await createDesktopFeaturePreferencesPersistence(join(directory, 'features.json'));
    expect(store.initialState).toEqual({ workspaceReview: true });
  });

  it('persists the workspace switch while ignoring legacy account state', async () => {
    directory = await mkdtemp(join(tmpdir(), 'desktop-feature-preferences-'));
    const path = join(directory, 'features.json');
    const store = await createDesktopFeaturePreferencesPersistence(path);
    store.update({ workspaceReview: false });
    await store.flush();
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      workspaceReview: false,
    });
    const restored = await createDesktopFeaturePreferencesPersistence(path);
    expect(restored.initialState).toEqual({ workspaceReview: false });
  });

  it('fails closed to defaults for malformed state', async () => {
    directory = await mkdtemp(join(tmpdir(), 'desktop-feature-preferences-'));
    const path = join(directory, 'features.json');
    await writeFile(path, '{"schemaVersion":1,"accountBalance":false}');
    const store = await createDesktopFeaturePreferencesPersistence(path);
    expect(store.initialState).toEqual({ workspaceReview: true });
  });
});
