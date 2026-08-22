import { describe, expect, it, vi } from 'vitest';

async function loadStoreFactory() {
  return (await import(
    new URL('../../../runtime/desktop-market-plugin/catalog-cache.js', import.meta.url).href
  )).createCatalogSnapshotStore as (options?: Record<string, unknown>) => {
    load(sourceId: string): Promise<unknown>;
    save(sourceId: string, snapshot: unknown, storedAt: number): Promise<void>;
  };
}

describe('desktop market persistent cache', () => {
  it('uses a fixed source path and atomically replaces the cache file', async () => {
    const createStore = await loadStoreFactory();
    const io = {
      lstat: vi.fn(async () => ({ isDirectory: () => true, isSymbolicLink: () => false })),
      readFile: vi.fn(), mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined), rename: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    };
    const store = createStore({ root: '/trusted/runtime-home', io });

    await store.save('dshfind', { schemaVersion: 2 }, 42);

    expect(io.mkdir).toHaveBeenCalledWith('/trusted/runtime-home/desktop-market-cache', {
      recursive: true, mode: 0o700,
    });
    expect(io.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/trusted\/runtime-home\/desktop-market-cache\/catalog-v2-dshfind\.json\..+\.tmp$/u),
      expect.any(String),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
    expect(io.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/u),
      '/trusted/runtime-home/desktop-market-cache/catalog-v2-dshfind.json',
    );
  });

  it('rejects source ids that could escape the cache directory', async () => {
    const createStore = await loadStoreFactory();
    const store = createStore({ root: '/trusted/runtime-home', io: {} });

    await expect(store.load('../outside')).rejects.toMatchObject({ code: 'catalog:invalid-source' });
  });

  it('ignores symbolic links and oversized files', async () => {
    const createStore = await loadStoreFactory();
    const readFile = vi.fn();
    const store = createStore({
      root: '/trusted/runtime-home',
      io: {
        lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => true, size: 10 })),
        readFile,
      },
    });

    await expect(store.load('dshfind')).resolves.toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('loads a bounded cache envelope from a regular file', async () => {
    const createStore = await loadStoreFactory();
    const store = createStore({
      root: '/trusted/runtime-home',
      io: {
        lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100 })),
        readFile: vi.fn(async () => JSON.stringify({
          schemaVersion: 1, storedAt: 42, snapshot: { schemaVersion: 2 },
        })),
      },
    });

    await expect(store.load('dshfind')).resolves.toEqual({
      storedAt: 42, snapshot: { schemaVersion: 2 },
    });
  });

  it('removes only the temporary file when atomic replacement fails', async () => {
    const createStore = await loadStoreFactory();
    const unlink = vi.fn(async (path: string) => { void path; });
    const store = createStore({
      root: '/trusted/runtime-home',
      io: {
        mkdir: vi.fn(async () => undefined),
        lstat: vi.fn(async () => ({ isDirectory: () => true, isSymbolicLink: () => false })),
        writeFile: vi.fn(async () => undefined),
        rename: vi.fn(async () => { throw new Error('replace failed'); }),
        unlink,
      },
    });

    await expect(store.save('dshfind', { schemaVersion: 2 }, 42)).rejects.toThrow('replace failed');
    expect(unlink).toHaveBeenCalledOnce();
    expect(unlink.mock.calls[0]?.[0]).toMatch(/\.tmp$/u);
    expect(unlink.mock.calls[0]?.[0]).not.toBe('/trusted/runtime-home/desktop-market-cache/catalog-v2-dshfind.json');
  });
});
