import { describe, expect, it, vi } from 'vitest';

async function loadFactory() {
  return (await import(
    new URL('../../../runtime/desktop-market-plugin/source-registry.js', import.meta.url).href
  )).createSourceRegistry as (options?: Record<string, unknown>) => {
    list(): Promise<readonly Record<string, unknown>[]>;
    mutate(operation: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  };
}

describe('desktop market source registry', () => {
  it('adds, reorders, disables, and removes validated HTTPS sources', async () => {
    const createSourceRegistry = await loadFactory();
    const save = vi.fn(async () => undefined);
    const ids = [
      'custom-00000000-0000-4000-8000-000000000001',
      'custom-00000000-0000-4000-8000-000000000002',
    ];
    const registry = createSourceRegistry({
      createId: () => ids.shift(),
      store: { load: async () => undefined, save },
    });

    await registry.mutate({ kind: 'add', displayName: ' One ', url: 'https://plugins.example.com/catalog.json' });
    await registry.mutate({ kind: 'add', displayName: 'Two', url: 'https://two.example.com/dsh/catalog.json' });
    await registry.mutate({ kind: 'move', sourceId: 'custom-00000000-0000-4000-8000-000000000002', direction: 'up' });
    const disabled = await registry.mutate({ kind: 'set-enabled', sourceId: 'custom-00000000-0000-4000-8000-000000000001', enabled: false });

    expect(disabled).toMatchObject([
      { displayName: 'Two', order: 0, enabled: true },
      { displayName: 'One', order: 1, enabled: false },
    ]);
    await expect(registry.mutate({ kind: 'remove', sourceId: 'custom-00000000-0000-4000-8000-000000000001' }))
      .resolves.toMatchObject([{ displayName: 'Two', order: 0 }]);
    expect(save).toHaveBeenCalledTimes(5);
  });

  it('rejects unsafe, duplicate, and built-in source mutations', async () => {
    const createSourceRegistry = await loadFactory();
    const registry = createSourceRegistry({
      createId: () => 'custom-00000000-0000-4000-8000-000000000001',
      store: { load: async () => undefined, save: async () => undefined },
    });

    await expect(registry.mutate({ kind: 'add', displayName: 'Local', url: 'http://127.0.0.1/catalog.json' }))
      .rejects.toMatchObject({ code: 'catalog:invalid-source' });
    await registry.mutate({ kind: 'add', displayName: 'One', url: 'https://plugins.example.com/catalog.json' });
    await expect(registry.mutate({ kind: 'add', displayName: 'Again', url: 'https://plugins.example.com/catalog.json' }))
      .rejects.toMatchObject({ code: 'catalog:duplicate-source' });
    await expect(registry.mutate({ kind: 'remove', sourceId: 'dshfind' }))
      .rejects.toMatchObject({ code: 'catalog:source-not-found' });
  });

  it('serializes concurrent mutations without losing records', async () => {
    const createSourceRegistry = await loadFactory();
    let counter = 0;
    const registry = createSourceRegistry({
      createId: () => `custom-00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
      store: { load: async () => undefined, save: async () => undefined },
    });

    await Promise.all([
      registry.mutate({ kind: 'add', displayName: 'One', url: 'https://one.example.com/catalog.json' }),
      registry.mutate({ kind: 'add', displayName: 'Two', url: 'https://two.example.com/catalog.json' }),
    ]);
    await expect(registry.list()).resolves.toHaveLength(2);
  });

  it('fails closed when persisted source records are malformed', async () => {
    const createSourceRegistry = await loadFactory();
    const registry = createSourceRegistry({
      store: {
        load: async () => [{ id: '../escape', displayName: 'Bad', url: 'https://example.com/catalog.json', enabled: true }],
        save: async () => undefined,
      },
    });

    await expect(registry.list()).rejects.toMatchObject({ code: 'catalog:invalid-storage' });
  });
});
