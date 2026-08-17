import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  invalidPreferenceReason,
  recoverInvalidPreferences,
} from './preferences-recovery.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('preference recovery', () => {
  it('accepts an empty document or map and rejects other roots', () => {
    expect(invalidPreferenceReason('')).toBeUndefined();
    expect(invalidPreferenceReason('ui-theme:\n  preference: dark\n')).toBeUndefined();
    expect(invalidPreferenceReason('- dark\n- light\n')).toMatch(/root must be a map/);
    expect(invalidPreferenceReason('ui-theme: [\n')).toMatch(/line \d+, column \d+/);
  });

  it('leaves missing and valid preference files untouched', async () => {
    const directory = await createTemporaryDirectory();
    const settingsPath = join(directory, 'settings.yaml');

    await expect(recoverInvalidPreferences(settingsPath)).resolves.toEqual({
      status: 'missing',
    });
    await writeFile(settingsPath, 'ui-theme:\n  preference: system\n');
    await expect(recoverInvalidPreferences(settingsPath)).resolves.toEqual({
      status: 'healthy',
    });
    await expect(readFile(settingsPath, 'utf8')).resolves.toContain('system');
  });

  it('backs up an invalid document and restores empty defaults', async () => {
    const directory = await createTemporaryDirectory();
    const settingsPath = join(directory, 'settings.yaml');
    const invalid = 'ui-theme: [broken\n';
    await writeFile(settingsPath, invalid, { mode: 0o600 });

    const result = await recoverInvalidPreferences(
      settingsPath,
      () => new Date('2026-08-17T09:00:00.000Z'),
    );

    expect(result.status).toBe('recovered');
    if (result.status !== 'recovered') {
      throw new Error('expected preferences to be recovered');
    }
    expect(result.backupPath).toBe(
      `${settingsPath}.corrupt-2026-08-17T09-00-00-000Z`,
    );
    await expect(readFile(result.backupPath, 'utf8')).resolves.toBe(invalid);
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe('');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yukiryou-preferences-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
