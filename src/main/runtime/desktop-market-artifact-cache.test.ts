import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface ArtifactCache {
  read(digest: string): Promise<Buffer | undefined>;
  put(value: { readonly digest: string; readonly bytes: Buffer }): Promise<void>;
  hold(digests: readonly string[]): () => void;
  collect(): Promise<Record<string, number>>;
}

async function loadCache(root: string, options: Record<string, unknown> = {}): Promise<ArtifactCache> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/artifact-cache.js', import.meta.url).href
  ) as { createArtifactCache(options: Record<string, unknown>): ArtifactCache };
  return module.createArtifactCache({ root, minimumFreeBytes: 0, ...options });
}

function artifact(value: string): { digest: string; bytes: Buffer } {
  const bytes = Buffer.from(value);
  return { digest: `sha512:${createHash('sha512').update(bytes).digest('hex')}`, bytes };
}

describe('desktop market artifact cache', () => {
  it('evicts the least recently used unreferenced object under a hard quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-cache-'));
    let timestamp = Date.parse('2026-08-21T12:00:00.000Z');
    const cache = await loadCache(root, { quotaBytes: 8, now: () => timestamp });
    const first = artifact('aaaa');
    const second = artifact('bbbb');
    const third = artifact('cccc');
    await cache.put(first);
    timestamp += 1_000;
    await cache.put(second);
    const release = cache.hold([first.digest]);
    timestamp += 1_000;
    await cache.put(third);

    await expect(cache.read(first.digest)).resolves.toEqual(first.bytes);
    await expect(cache.read(second.digest)).resolves.toBeUndefined();
    await expect(cache.read(third.digest)).resolves.toEqual(third.bytes);
    release();
  });

  it('protects receipt references and fails closed when every object is held', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-cache-'));
    const first = artifact('aaaa');
    const second = artifact('bbbb');
    const third = artifact('cccc');
    const cache = await loadCache(root, { quotaBytes: 8 });
    await cache.put(first);
    await cache.put(second);
    await mkdir(join(root, 'plugin-management'), { recursive: true });
    await writeFile(join(root, 'plugin-management', 'receipts.json'), JSON.stringify({
      schemaVersion: 1,
      receipts: [{ cacheDigests: [second.digest] }],
    }));
    await cache.put(third);
    await expect(cache.read(first.digest)).resolves.toBeUndefined();
    await expect(cache.read(second.digest)).resolves.toEqual(second.bytes);

    const releaseSecond = cache.hold([second.digest]);
    const releaseThird = cache.hold([third.digest]);
    await expect(cache.put(artifact('dddd'))).rejects
      .toMatchObject({ code: 'catalog:cache-quota-exhausted' });
    releaseSecond();
    releaseThird();
  });

  it('protects the previous-version artifacts retained for managed rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-cache-'));
    const current = artifact('aaaa');
    const previous = artifact('bbbb');
    const cache = await loadCache(root, { quotaBytes: 8 });
    await cache.put(current);
    await cache.put(previous);
    await mkdir(join(root, 'plugin-management'), { recursive: true });
    await writeFile(join(root, 'plugin-management', 'receipts.json'), JSON.stringify({
      schemaVersion: 1,
      receipts: [{
        cacheDigests: [current.digest],
        rollbackTarget: { cacheDigests: [previous.digest] },
      }],
    }));

    await expect(cache.put(artifact('cccc'))).rejects
      .toMatchObject({ code: 'catalog:cache-quota-exhausted' });
    await expect(cache.read(current.digest)).resolves.toEqual(current.bytes);
    await expect(cache.read(previous.digest)).resolves.toEqual(previous.bytes);
  });

  it('rejects writes that would consume the reserved free-disk floor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-cache-'));
    const cache = await loadCache(root, {
      quotaBytes: 64,
      minimumFreeBytes: Number.MAX_SAFE_INTEGER,
    });

    await expect(cache.put(artifact('disk'))).rejects
      .toMatchObject({ code: 'catalog:cache-disk-space' });
  });

  it('fails closed on a digest-shaped symbolic link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-cache-'));
    const directory = join(root, 'desktop-market-artifacts-v1');
    const target = join(root, 'outside.tgz');
    const entry = artifact('unsafe');
    await mkdir(directory, { recursive: true });
    await writeFile(target, entry.bytes);
    await symlink(target, join(directory, `${entry.digest.slice('sha512:'.length)}.tgz`));
    const cache = await loadCache(root, { quotaBytes: 64 });

    await expect(cache.collect()).rejects
      .toMatchObject({ code: 'catalog:cache-invalid-object' });
    await expect(readFile(target)).resolves.toEqual(entry.bytes);
  });

  it('refuses eviction when persisted reference state is malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-cache-'));
    const first = artifact('aaaa');
    const cache = await loadCache(root, { quotaBytes: 4 });
    await cache.put(first);
    await mkdir(join(root, 'plugin-management'), { recursive: true });
    await writeFile(join(root, 'plugin-management', 'receipts.json'), JSON.stringify({
      schemaVersion: 1,
      receipts: [{ cacheDigests: first.digest }],
    }));

    await expect(cache.put(artifact('bbbb'))).rejects
      .toMatchObject({ code: 'catalog:cache-protection-state' });
    await expect(cache.read(first.digest)).resolves.toEqual(first.bytes);
  });
});
