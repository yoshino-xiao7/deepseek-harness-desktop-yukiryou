import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

interface DevelopmentFixture {
  readonly sourceId: string;
  readonly itemId: string;
  readonly crashItemId: string;
  readonly source: Readonly<Record<string, unknown>>;
  inspectVerified(identity: { readonly sourceRecordId: string; readonly itemId: string }): Promise<{
    readonly value: Readonly<Record<string, unknown>>;
    readonly installation: Readonly<Record<string, unknown>>;
  }>;
}

interface FixtureModule {
  createDevelopmentFixture(options: Record<string, unknown>): DevelopmentFixture | undefined;
  createDevelopmentCatalogAdapter(catalog: Record<string, unknown>, fixture: DevelopmentFixture | undefined): {
    listSources(): Promise<readonly Readonly<Record<string, unknown>>[]>;
    read(request: { readonly sourceId?: string }): Promise<Readonly<Record<string, unknown>>>;
  };
  createDevelopmentInspectorAdapter(inspector: Record<string, unknown>, fixture: DevelopmentFixture | undefined): {
    inspectVerified(identity: { readonly sourceRecordId: string; readonly itemId: string }): Promise<{
      readonly value: Readonly<Record<string, unknown>>;
      readonly installation: Readonly<Record<string, unknown>>;
    }>;
  };
}

async function loadFixtureModule(): Promise<FixtureModule> {
  return import(
    new URL('../../../runtime/desktop-market-plugin/development-fixture.js', import.meta.url).href
  ) as Promise<FixtureModule>;
}

describe('desktop market development fixture', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('is completely absent unless the host explicitly enables development mode', async () => {
    const module = await loadFixtureModule();
    expect(module.createDevelopmentFixture({ enabled: false })).toBeUndefined();
    expect(module.createDevelopmentFixture({})).toBeUndefined();
  });

  it('appears as a local source and traverses verification, cache, preview, and staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-market-development-fixture-'));
    roots.push(root);
    const [{ createArtifactCache }, { createManagedPluginInstaller }, { createManagedPreviewVault }, module] =
      await Promise.all([
        import(new URL('../../../runtime/desktop-market-plugin/artifact-cache.js', import.meta.url).href),
        import(new URL('../../../runtime/desktop-market-plugin/managed-installer.js', import.meta.url).href),
        import(new URL('../../../runtime/desktop-market-plugin/managed-preview-vault.js', import.meta.url).href),
        loadFixtureModule(),
      ]);
    const artifactCache = createArtifactCache({ root });
    const fixture = module.createDevelopmentFixture({ enabled: true, artifactStore: artifactCache });
    expect(fixture).toBeDefined();
    if (fixture === undefined) throw new Error('fixture missing');
    const baseCatalog = {
      listSources: async () => Object.freeze([Object.freeze({ id: 'community', enabled: true })]),
      read: async () => Object.freeze({ source: Object.freeze({ id: 'community' }), items: Object.freeze([]) }),
    };
    const catalog = module.createDevelopmentCatalogAdapter(baseCatalog, fixture);

    await expect(catalog.listSources()).resolves.toEqual([
      expect.objectContaining({ id: fixture.sourceId, developmentOnly: true }),
      expect.objectContaining({ id: 'community' }),
    ]);
    const snapshot = await catalog.read({ sourceId: fixture.sourceId }) as {
      readonly source: Readonly<Record<string, unknown>>;
      readonly items: readonly Readonly<Record<string, unknown>>[];
    };
    expect(snapshot.source).toMatchObject({ id: fixture.sourceId, indexedTotal: 2 });
    expect(snapshot.items[0]).toMatchObject({
      id: fixture.itemId,
      installability: { state: 'candidate' },
    });

    const vault = createManagedPreviewVault({
      inspector: fixture,
      installer: createManagedPluginInstaller({ root, artifactStore: artifactCache }),
      artifactCache,
      randomId: () => '00000000-0000-4000-8000-000000000001',
      schedule: () => undefined,
      cancel: () => undefined,
    });
    const preview = await vault.issue({ sourceRecordId: fixture.sourceId, itemId: fixture.itemId });
    expect(preview).toMatchObject({
      candidate: { packageName: '@dsh-desktop/development-install-fixture', version: '1.0.3' },
      inspection: { status: 'artifact-verified', blockers: [] },
    });
    const staged = await vault.stage(preview.previewId);
    expect(staged).toMatchObject({ status: 'staged', stagingStatus: 'staged' });
    const patch = join(
      root,
      'user-plugins',
      'generations',
      staged.profileGeneration,
      'node_modules',
      '@dsh-desktop',
      'development-install-fixture',
      'fixture.patch.yml',
    );
    await expect(readFile(patch, 'utf8')).resolves.toContain('development-install-fixture');
  });

  it('stages a higher development version that deterministically fails during module loading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-market-development-crash-fixture-'));
    roots.push(root);
    const [{ createArtifactCache }, { createManagedPluginInstaller }, { createManagedPreviewVault }, module] =
      await Promise.all([
        import(new URL('../../../runtime/desktop-market-plugin/artifact-cache.js', import.meta.url).href),
        import(new URL('../../../runtime/desktop-market-plugin/managed-installer.js', import.meta.url).href),
        import(new URL('../../../runtime/desktop-market-plugin/managed-preview-vault.js', import.meta.url).href),
        loadFixtureModule(),
      ]);
    const artifactCache = createArtifactCache({ root });
    const fixture = module.createDevelopmentFixture({ enabled: true, artifactStore: artifactCache });
    if (fixture === undefined) throw new Error('fixture missing');
    const communityInspector = {
      inspectVerified: async () => {
        throw new Error('community inspector must not receive development fixture identities');
      },
    };
    const inspector = module.createDevelopmentInspectorAdapter(communityInspector, fixture);
    const vault = createManagedPreviewVault({
      inspector,
      installer: createManagedPluginInstaller({ root, artifactStore: artifactCache }),
      artifactCache,
      randomId: () => '00000000-0000-4000-8000-000000000002',
      schedule: () => undefined,
      cancel: () => undefined,
    });

    const preview = await vault.issue({
      sourceRecordId: fixture.sourceId,
      itemId: fixture.crashItemId,
    });
    expect(preview).toMatchObject({
      candidate: {
        packageName: '@dsh-desktop/development-install-fixture',
        version: '1.0.4-failure.1',
      },
    });
    const staged = await vault.stage(preview.previewId);
    const entry = join(
      root,
      'user-plugins',
      'generations',
      staged.profileGeneration,
      'node_modules',
      '@dsh-desktop',
      'development-install-fixture',
      'index.js',
    );
    await expect(readFile(entry, 'utf8')).resolves.toContain(
      'intentional development fixture startup failure',
    );
  });
});
