import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

interface Resolver {
  resolve(input: { readonly name: string; readonly version: string; readonly manifest: Record<string, unknown> }): Promise<GraphResult>;
}

interface GraphResult {
  readonly status: string;
  readonly hash: string;
  readonly summary: Record<string, number>;
  readonly nodes: readonly { readonly id: string }[];
  readonly optionalSkipped: readonly Record<string, string>[];
  readonly peerCompatibility: { readonly status: string };
}

const integrity = `sha512-${Buffer.alloc(64, 5).toString('base64')}`;

function manifest(name: string, version: string, extra: Record<string, unknown> = {}) {
  const baseName = name.slice(name.lastIndexOf('/') + 1);
  return {
    name,
    version,
    dist: {
      integrity,
      tarball: `https://registry.npmjs.org/${name}/-/${baseName}-${version}.tgz`,
      unpackedSize: 100,
      fileCount: 2,
    },
    ...extra,
  };
}

async function createResolver(manifests: Record<string, Record<string, unknown>>, options: Record<string, unknown> = {}): Promise<Resolver> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/dependency-graph.js', import.meta.url).href
  ) as { readonly createDependencyGraphResolver: (options: Record<string, unknown>) => Resolver };
  return module.createDependencyGraphResolver({
    platform: 'darwin',
    architecture: 'arm64',
    nodeVersion: '22.19.0',
    requestPackument: async (name: string) => ({
      name,
      versions: Object.fromEntries(Object.values(manifests)
        .filter((entry) => entry.name === name)
        .map((entry) => [entry.version, { deprecated: entry.deprecated }])),
    }),
    requestManifest: async (name: string, version: string) => manifests[`${name}@${version}`],
    runtimeSnapshot: {
      read: async () => ({
        hash: `sha256:${'b'.repeat(64)}`,
        packages: [{ name: 'react', version: '18.3.1' }],
      }),
    },
    ...options,
  });
}

describe('desktop market dependency graph', () => {
  it('selects exact stable versions and freezes a deterministic transitive graph', async () => {
    const root = manifest('root-package', '1.0.0', {
      dependencies: { alpha: '^1.0.0' },
      peerDependencies: { react: '^18.0.0' },
    });
    const manifests = {
      'alpha@1.0.0': manifest('alpha', '1.0.0'),
      'alpha@1.2.0': manifest('alpha', '1.2.0', { dependencies: { beta: '~2.0.0' } }),
      'alpha@2.0.0': manifest('alpha', '2.0.0'),
      'beta@2.0.1': manifest('beta', '2.0.1'),
    };
    const resolver = await createResolver(manifests);
    const first = await resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root });
    const second = await resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root });

    expect(first).toMatchObject({
      status: 'frozen',
      summary: { nodes: 3, edges: 2, direct: 1, peers: 1, peerRequirements: 1, peerSatisfied: 1, peerBlocked: 0, maxDepth: 2 },
    });
    expect(first.nodes.map((entry: { id: string }) => entry.id)).toEqual(['alpha@1.2.0', 'beta@2.0.1', 'root-package@1.0.0']);
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second.hash).toBe(first.hash);
  });

  it('handles cycles once and skips only platform-incompatible optional dependencies', async () => {
    const root = manifest('root-package', '1.0.0', {
      dependencies: { alpha: '1.0.0' }, optionalDependencies: { 'linux-only': '1.0.0' },
    });
    const manifests = {
      'alpha@1.0.0': manifest('alpha', '1.0.0', { dependencies: { 'root-package': '1.0.0' } }),
      'root-package@1.0.0': root,
      'linux-only@1.0.0': manifest('linux-only', '1.0.0', { os: ['linux'] }),
    };
    const resolver = await createResolver(manifests);
    const result = await resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root });

    expect(result.summary).toMatchObject({ nodes: 2, edges: 2, optionalSkipped: 1 });
    expect(result.optionalSkipped).toEqual([
      { from: 'root-package@1.0.0', name: 'linux-only', requested: '1.0.0' },
    ]);
  });

  it('fails closed on lifecycle scripts and incompatible Node engines', async () => {
    const root = manifest('root-package', '1.0.0', { dependencies: { unsafe: '1.0.0' } });
    const unsafe = manifest('unsafe', '1.0.0', { scripts: { install: 'node install.js', prepare: 'node build.js' } });
    const resolver = await createResolver({ 'unsafe@1.0.0': unsafe });
    await expect(resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root }))
      .rejects.toMatchObject({ code: 'catalog:graph-policy', check: 'lifecycle-scripts' });

    const engineRoot = manifest('root-package', '1.0.0', { engines: { node: '>=30' } });
    await expect(resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: engineRoot }))
      .rejects.toMatchObject({ code: 'catalog:graph-policy', check: 'node-engine' });
  });

  it('does not treat registry-only prepare metadata as an install-time script', async () => {
    const root = manifest('root-package', '1.0.0', { scripts: { prepare: 'node build.js' } });
    const resolver = await createResolver({});
    await expect(resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root }))
      .resolves.toMatchObject({ status: 'frozen', summary: { nodes: 1 } });
  });

  it('fails closed on missing or incompatible required peers but allows missing optional peers', async () => {
    const root = manifest('root-package', '1.0.0', {
      peerDependencies: { react: '^19.0.0', missing: '^1.0.0', optional: '^2.0.0' },
      peerDependenciesMeta: { optional: { optional: true } },
    });
    const resolver = await createResolver({});
    const result = await resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root });

    expect(result.summary).toMatchObject({
      peerRequirements: 3, peerSatisfied: 0, peerOptionalMissing: 1, peerBlocked: 2,
    });
    expect(result.peerCompatibility.status).toBe('blocked');
  });

  it('enforces graph budgets and coalesces repeated packument reads inside one resolution', async () => {
    const root = manifest('root-package', '1.0.0', { dependencies: { alpha: '1.0.0', beta: '1.0.0' } });
    const manifests = {
      'alpha@1.0.0': manifest('alpha', '1.0.0', { dependencies: { shared: '1.0.0' } }),
      'beta@1.0.0': manifest('beta', '1.0.0', { dependencies: { shared: '1.0.0' } }),
      'shared@1.0.0': manifest('shared', '1.0.0'),
    };
    const requestPackument = vi.fn(async (name: string) => ({ name, versions: { '1.0.0': {} } }));
    const resolver = await createResolver(manifests, { requestPackument });
    await resolver.resolve({ name: 'root-package', version: '1.0.0', manifest: root });
    expect(requestPackument.mock.calls.filter(([name]) => name === 'shared')).toHaveLength(1);

    const limited = await createResolver(manifests, { maxNodes: 2 });
    await expect(limited.resolve({ name: 'root-package', version: '1.0.0', manifest: root }))
      .rejects.toMatchObject({ code: 'catalog:graph-budget', check: 'dependency-graph' });
  });
});
