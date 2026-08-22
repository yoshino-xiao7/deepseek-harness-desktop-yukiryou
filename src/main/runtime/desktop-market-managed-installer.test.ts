import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface ArtifactVerifier {
  verify(input: { readonly graph: Record<string, unknown>; readonly rootBundlePath: string }): Promise<{
    readonly installationPlan: Record<string, unknown>;
  }>;
}

interface ManagedInstaller {
  stage(input: { readonly generation: string; readonly plan: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

async function modules(): Promise<{
  createArtifactVerifier: (options: Record<string, unknown>) => ArtifactVerifier;
  createManagedPluginInstaller: (options: Record<string, unknown>) => ManagedInstaller;
}> {
  const [verifier, installer] = await Promise.all([
    import(new URL('../../../runtime/desktop-market-plugin/artifact-verifier.js', import.meta.url).href),
    import(new URL('../../../runtime/desktop-market-plugin/managed-installer.js', import.meta.url).href),
  ]);
  return {
    createArtifactVerifier: verifier.createArtifactVerifier as (options: Record<string, unknown>) => ArtifactVerifier,
    createManagedPluginInstaller: installer.createManagedPluginInstaller as (options: Record<string, unknown>) => ManagedInstaller,
  };
}

describe('desktop market managed installer', () => {
  it('assembles a multi-version-safe offline generation and reuses its exact publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-installer-'));
    const fixture = await verifiedFixture(root);
    const generation = `gen-${'d'.repeat(64)}`;

    const first = await fixture.installer.stage({ generation, plan: fixture.plan });
    expect(first).toMatchObject({ status: 'staged', generation, packageCount: 2 });
    const generationPath = first.path as string;
    const rootPackage = await realpath(join(generationPath, 'node_modules', '@community', 'example'));
    const dependency = await realpath(join(rootPackage, 'node_modules', 'alpha'));
    await expect(readFile(join(rootPackage, 'index.js'), 'utf8')).resolves.toBe('export const root = true;');
    await expect(readFile(join(dependency, 'index.js'), 'utf8')).resolves.toBe('export const alpha = true;');
    expect((await lstat(join(rootPackage, 'node_modules', 'alpha'))).isSymbolicLink()).toBe(true);

    await expect(fixture.installer.stage({ generation, plan: fixture.plan })).resolves
      .toMatchObject({ status: 'reused', generation });
  });

  it('fails closed without publishing when a verified cache object is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-installer-'));
    const fixture = await verifiedFixture(root);
    const generation = `gen-${'e'.repeat(64)}`;
    const installerModule = await modules();
    const installer = installerModule.createManagedPluginInstaller({
      root,
      artifactStore: { read: async () => undefined },
    });

    await expect(installer.stage({ generation, plan: fixture.plan })).rejects
      .toMatchObject({ code: 'catalog:installer-cache-miss' });
    await expect(lstat(join(root, 'user-plugins', 'generations', generation)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(join(root, 'user-plugins', '.staging'))).resolves.toEqual([]);
  });

  it('rechecks cached bytes instead of trusting the artifact store adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-installer-'));
    const fixture = await verifiedFixture(root);
    const installerModule = await modules();
    const installer = installerModule.createManagedPluginInstaller({
      root,
      artifactStore: { read: async () => Buffer.alloc(1) },
    });

    await expect(installer.stage({
      generation: `gen-${'b'.repeat(64)}`,
      plan: fixture.plan,
    })).rejects.toMatchObject({ code: 'catalog:installer-cache-integrity' });
    await expect(readdir(join(root, 'user-plugins', '.staging'))).resolves.toEqual([]);
  });

  it('rejects dependency targets that are absent from the frozen plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-installer-'));
    const fixture = await verifiedFixture(root);
    const plan = structuredClone(fixture.plan) as {
      artifacts: Array<{ dependencies: Array<{ to: string }> }>;
    };
    const firstDependency = plan.artifacts[0]?.dependencies[0];
    if (firstDependency === undefined) throw new Error('fixture dependency missing');
    firstDependency.to = 'missing@1.0.0';

    await expect(fixture.installer.stage({
      generation: `gen-${'f'.repeat(64)}`,
      plan,
    })).rejects.toMatchObject({ code: 'catalog:installer-invalid-plan' });
  });

  it('rejects package identities that do not match their frozen node IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-installer-'));
    const fixture = await verifiedFixture(root);
    const plan = structuredClone(fixture.plan) as {
      artifacts: Array<{ id: string }>;
    };
    if (plan.artifacts[0] === undefined) throw new Error('fixture artifact missing');
    plan.artifacts[0].id = 'forged@1.0.0';

    await expect(fixture.installer.stage({
      generation: `gen-${'c'.repeat(64)}`,
      plan,
    })).rejects.toMatchObject({ code: 'catalog:installer-invalid-plan' });
  });

  it('links exact Runtime peers from the bundled node_modules snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'managed-installer-'));
    const runtimeModulesRoot = join(root, 'bundled-node_modules');
    const reactRoot = join(runtimeModulesRoot, 'react');
    await mkdir(reactRoot, { recursive: true });
    await writeFile(join(reactRoot, 'package.json'), JSON.stringify({ name: 'react', version: '18.3.1' }));
    await writeFile(join(reactRoot, 'index.js'), 'export const runtime = true;');
    const rootBytes = archive([
      {
        path: 'package/package.json',
        body: JSON.stringify({
          name: '@community/example', version: '1.2.3', peerDependencies: { react: '^18.0.0' },
        }),
      },
      { path: 'package/cordis.patch.yml', body: '[]\n' },
    ]);
    const cache = new Map<string, Buffer>();
    const artifactStore = {
      enabled: true,
      read: async (digest: string) => cache.get(digest),
      put: async ({ digest, bytes }: { digest: string; bytes: Buffer }) => { cache.set(digest, bytes); },
    };
    const loaded = await modules();
    const verifier = loaded.createArtifactVerifier({
      store: artifactStore,
      requestTarball: async () => rootBytes,
    });
    const graph = {
      status: 'frozen', root: '@community/example@1.2.3', hash: `sha256:${'a'.repeat(64)}`,
      optionalSkipped: [], edges: [], nodes: [node('@community/example', '1.2.3', rootBytes)],
      peerRequirements: [{ from: '@community/example@1.2.3', name: 'react', range: '^18.0.0', optional: false }],
      peerCompatibility: {
        status: 'compatible', runtimeSnapshotHash: `sha256:${'b'.repeat(64)}`,
        resolutions: [{
          from: '@community/example@1.2.3', name: 'react', range: '^18.0.0', optional: false,
          state: 'satisfied', provider: 'runtime', version: '18.3.1',
        }],
      },
    };
    const verified = await verifier.verify({ graph, rootBundlePath: 'cordis.patch.yml' });
    const installer = loaded.createManagedPluginInstaller({ root, artifactStore, runtimeModulesRoot });
    const staged = await installer.stage({
      generation: `gen-${'7'.repeat(64)}`,
      plan: verified.installationPlan,
    });
    const pluginRoot = await realpath(join(
      staged.path as string, 'node_modules', '@community', 'example',
    ));

    await expect(realpath(join(pluginRoot, 'node_modules', 'react'))).resolves.toBe(await realpath(reactRoot));
  });
});

async function verifiedFixture(root: string): Promise<{
  readonly installer: ManagedInstaller;
  readonly plan: Record<string, unknown>;
}> {
  const rootBytes = archive([
    {
      path: 'package/package.json',
      body: JSON.stringify({
        name: '@community/example',
        version: '1.2.3',
        dependencies: { alpha: '^2.0.0' },
      }),
    },
    { path: 'package/cordis.patch.yml', body: '[]\n' },
    { path: 'package/index.js', body: 'export const root = true;' },
  ]);
  const alphaBytes = archive([
    {
      path: 'package/package.json',
      body: JSON.stringify({ name: 'alpha', version: '2.1.0' }),
    },
    { path: 'package/index.js', body: 'export const alpha = true;' },
  ]);
  const bytesByName = new Map([
    ['@community/example', rootBytes],
    ['alpha', alphaBytes],
  ]);
  const cache = new Map<string, Buffer>();
  const artifactStore = {
    enabled: true,
    read: async (digest: string) => cache.get(digest),
    put: async ({ digest, bytes }: { digest: string; bytes: Buffer }) => {
      cache.set(digest, bytes);
    },
  };
  const loaded = await modules();
  const verifier = loaded.createArtifactVerifier({
    artifactStore,
    store: artifactStore,
    requestTarball: async ({ packageName }: { packageName: string }) => bytesByName.get(packageName),
  });
  const graph = {
    status: 'frozen',
    root: '@community/example@1.2.3',
    hash: `sha256:${'a'.repeat(64)}`,
    optionalSkipped: [],
    peerRequirements: [],
    peerCompatibility: {
      status: 'compatible',
      runtimeSnapshotHash: `sha256:${'b'.repeat(64)}`,
      resolutions: [],
    },
    edges: [{
      from: '@community/example@1.2.3',
      to: 'alpha@2.1.0',
      name: 'alpha',
      requested: '^2.0.0',
      kind: 'runtime',
    }],
    nodes: [
      node('@community/example', '1.2.3', rootBytes),
      node('alpha', '2.1.0', alphaBytes),
    ],
  };
  const verified = await verifier.verify({ graph, rootBundlePath: 'cordis.patch.yml' });
  return {
    installer: loaded.createManagedPluginInstaller({ root, artifactStore }),
    plan: verified.installationPlan,
  };
}

function node(name: string, version: string, bytes: Buffer): Record<string, unknown> {
  const baseName = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  return {
    id: `${name}@${version}`,
    name,
    version,
    tarball: `https://registry.npmjs.org/${name}/-/${baseName}-${version}.tgz`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}

function archive(entries: ReadonlyArray<{ readonly path: string; readonly body: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body);
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeOctal(header, 148, 8, checksum);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 2, '0');
  target.write(`${encoded}\0 `, offset, length, 'ascii');
}
