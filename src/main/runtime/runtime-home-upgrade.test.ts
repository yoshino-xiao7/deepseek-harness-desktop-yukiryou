import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureRc8RuntimeHomeBackup } from './runtime-home-upgrade.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('rc.8 Runtime Home upgrade backup', () => {
  it('copies an existing Runtime Home once without following symlinks', async () => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    await mkdir(join(runtimeHome, 'sessions'), { recursive: true });
    await writeFile(join(runtimeHome, 'sessions', 'history.db'), 'rc.7-data');
    await symlink('../sessions', join(runtimeHome, 'session-link'));

    const first = await ensureRc8RuntimeHomeBackup(runtimeHome);
    expect(first.status).toBe('created');
    if (first.status !== 'created') throw new Error('expected a backup');
    await expect(
      readFile(join(first.backupPath, 'sessions', 'history.db'), 'utf8'),
    ).resolves.toBe('rc.7-data');
    expect(
      (await lstat(join(first.backupPath, 'session-link'))).isSymbolicLink(),
    ).toBe(true);

    await writeFile(join(runtimeHome, 'sessions', 'history.db'), 'rc.8-data');
    await expect(ensureRc8RuntimeHomeBackup(runtimeHome)).resolves.toEqual({
      status: 'already-prepared',
    });
    await expect(
      readFile(join(first.backupPath, 'sessions', 'history.db'), 'utf8'),
    ).resolves.toBe('rc.7-data');
  });

  it('marks an empty Runtime Home without creating a backup directory', async () => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    await mkdir(runtimeHome);

    await expect(ensureRc8RuntimeHomeBackup(runtimeHome)).resolves.toEqual({
      status: 'empty',
    });
    await expect(ensureRc8RuntimeHomeBackup(runtimeHome)).resolves.toEqual({
      status: 'already-prepared',
    });
    if (process.platform !== 'win32') {
      expect(
        (await lstat(join(userData, '.dsh-0.1.0-rc.8-storage-v1.json'))).mode &
          0o777,
      ).toBe(0o600);
    }
  });

  it('publishes only one complete marker across concurrent empty-home attempts', async () => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    await mkdir(runtimeHome);

    const results = await Promise.all([
      ensureRc8RuntimeHomeBackup(runtimeHome),
      ensureRc8RuntimeHomeBackup(runtimeHome),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([
      'already-prepared',
      'empty',
    ]);
    await expect(
      readFile(join(userData, '.dsh-0.1.0-rc.8-storage-v1.json'), 'utf8'),
    ).resolves.toBe(`${JSON.stringify({
      upgrade: 'dsh-0.1.0-rc.8-storage-v1',
      backupName: null,
    }, null, 2)}\n`);
  });

  it('retries safely when an interrupted attempt left a partial temp file', async () => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    const markerPath = join(userData, '.dsh-0.1.0-rc.8-storage-v1.json');
    const abandonedTempPath = `${markerPath}.abandoned.tmp`;
    await mkdir(runtimeHome);
    await writeFile(abandonedTempPath, '{"upgrade":');

    await expect(ensureRc8RuntimeHomeBackup(runtimeHome)).resolves.toEqual({
      status: 'empty',
    });

    await expect(readFile(abandonedTempPath, 'utf8')).resolves.toBe('{"upgrade":');
    await expect(readFile(markerPath, 'utf8')).resolves.toContain(
      '"backupName": null',
    );
  });

  it('does not expose a formal marker when atomic publication fails', async () => {
    const actualFileSystem = await vi.importActual('node:fs/promises');
    vi.resetModules();
    vi.doMock('node:fs/promises', () => ({
      ...actualFileSystem,
      link: async () => {
        throw Object.assign(new Error('injected link failure'), { code: 'EIO' });
      },
    }));

    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    await mkdir(runtimeHome);
    try {
      const isolatedModule = await import('./runtime-home-upgrade.js');
      await expect(
        isolatedModule.ensureRc8RuntimeHomeBackup(runtimeHome),
      ).rejects.toMatchObject({ code: 'EIO' });
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }

    await expect(
      lstat(join(userData, '.dsh-0.1.0-rc.8-storage-v1.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(userData)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it.each([
    ['zero-length', ''],
    ['truncated JSON', '{"upgrade":"dsh-0.1.0-rc.8-storage-v1"'],
    ['missing backup intent', '{"upgrade":"dsh-0.1.0-rc.8-storage-v1"}\n'],
  ])('fails closed for a %s formal marker', async (_name, marker) => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    const markerPath = join(userData, '.dsh-0.1.0-rc.8-storage-v1.json');
    const backupPath = join(userData, 'runtime.pre-dsh-0.1.0-rc.8');
    await mkdir(runtimeHome);
    await writeFile(join(runtimeHome, 'generation.txt'), 'must-be-preserved');
    await writeFile(markerPath, marker);

    await expect(ensureRc8RuntimeHomeBackup(runtimeHome)).rejects.toThrow(
      /Invalid.*rc\.8 Runtime Home/i,
    );

    await expect(readFile(markerPath, 'utf8')).resolves.toBe(marker);
    await expect(lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(runtimeHome, 'generation.txt'), 'utf8'),
    ).resolves.toBe('must-be-preserved');
  });

  it('creates a new numbered rollback copy after a documented rc.7 restore', async () => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    await mkdir(runtimeHome);
    await writeFile(join(runtimeHome, 'generation.txt'), 'first-rc7');

    const first = await ensureRc8RuntimeHomeBackup(runtimeHome);
    expect(first.status).toBe('created');
    await rm(join(userData, '.dsh-0.1.0-rc.8-storage-v1.json'));
    await writeFile(join(runtimeHome, 'generation.txt'), 'restored-rc7-new-data');

    const retry = await ensureRc8RuntimeHomeBackup(runtimeHome);
    expect(retry.status).toBe('created');
    if (first.status !== 'created' || retry.status !== 'created') {
      throw new Error('expected two rollback copies');
    }
    expect(retry.backupPath).toBe(`${first.backupPath}.1`);
    await expect(
      readFile(join(first.backupPath, 'generation.txt'), 'utf8'),
    ).resolves.toBe('first-rc7');
    await expect(
      readFile(join(retry.backupPath, 'generation.txt'), 'utf8'),
    ).resolves.toBe('restored-rc7-new-data');
  });

  it('resumes an interrupted backup intent without allocating a numbered duplicate', async () => {
    const userData = await createTemporaryDirectory();
    const runtimeHome = join(userData, 'runtime');
    await mkdir(runtimeHome);
    await writeFile(join(runtimeHome, 'generation.txt'), 'interrupted-copy');
    await writeFile(
      join(userData, '.dsh-0.1.0-rc.8-storage-v1.json'),
      `${JSON.stringify({
        upgrade: 'dsh-0.1.0-rc.8-storage-v1',
        backupName: 'runtime.pre-dsh-0.1.0-rc.8',
      })}\n`,
    );

    const resumed = await ensureRc8RuntimeHomeBackup(runtimeHome);

    expect(resumed).toEqual({
      status: 'created',
      backupPath: join(userData, 'runtime.pre-dsh-0.1.0-rc.8'),
    });
    await expect(
      readFile(join(userData, 'runtime.pre-dsh-0.1.0-rc.8', 'generation.txt'), 'utf8'),
    ).resolves.toBe('interrupted-copy');
    await expect(
      lstat(join(userData, 'runtime.pre-dsh-0.1.0-rc.8.1')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-rc8-upgrade-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
