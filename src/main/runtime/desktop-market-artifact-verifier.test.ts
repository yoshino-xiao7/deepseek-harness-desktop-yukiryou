import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

interface ArtifactVerifier {
  verify(input: { readonly graph: Record<string, unknown>; readonly rootBundlePath: string }): Promise<Record<string, unknown>>;
}

async function loadVerifier(options: Record<string, unknown>): Promise<ArtifactVerifier> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/artifact-verifier.js', import.meta.url).href
  ) as { readonly createArtifactVerifier: (options: Record<string, unknown>) => ArtifactVerifier };
  return module.createArtifactVerifier(options);
}

function archive(entries: ReadonlyArray<{ readonly path: string; readonly body?: string; readonly type?: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? '0').charCodeAt(0);
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

function graph(bytes: Buffer, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'frozen',
    root: '@community/example@1.2.3',
    hash: `sha256:${'a'.repeat(64)}`,
    edges: [],
    optionalSkipped: [],
    peerRequirements: [],
    peerCompatibility: {
      status: 'compatible',
      runtimeSnapshotHash: `sha256:${'b'.repeat(64)}`,
      resolutions: [],
    },
    nodes: [{
      id: '@community/example@1.2.3', name: '@community/example', version: '1.2.3',
      tarball: 'https://registry.npmjs.org/@community/example/-/example-1.2.3.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    }],
    ...overrides,
  };
}

describe('desktop market artifact verifier', () => {
  it('checks archive identity and bundle, persists by content hash, and creates a deterministic frozen lock', async () => {
    const bytes = archive([
      { path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) },
      { path: 'package/cordis.patch.yml', body: 'plugins: {}' },
      { path: 'package/index.js', body: 'export {}' },
    ]);
    const put = vi.fn(async () => undefined);
    const release = vi.fn();
    const hold = vi.fn(() => release);
    const requestTarball = vi.fn(async () => bytes);
    const verifier = await loadVerifier({ requestTarball, store: { enabled: true, put, hold } });
    const first = await verifier.verify({ graph: graph(bytes), rootBundlePath: 'cordis.patch.yml' });
    const second = await verifier.verify({ graph: graph(bytes), rootBundlePath: 'cordis.patch.yml' });

    expect(first).toMatchObject({
      status: 'verified',
      lockHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      installationPlan: {
        root: '@community/example@1.2.3',
        rootBundlePath: 'cordis.patch.yml',
        artifacts: [expect.objectContaining({
          name: '@community/example',
          version: '1.2.3',
          archiveBytes: expect.any(Number),
          dependencies: [],
        })],
      },
      summary: { artifacts: 1, compressedBytes: bytes.length, fileCount: 3, cache: 'content-addressed' },
    });
    expect(second.lockHash).toBe(first.lockHash);
    expect(requestTarball).toHaveBeenCalledWith({
      packageName: '@community/example', version: '1.2.3',
      tarball: 'https://registry.npmjs.org/@community/example/-/example-1.2.3.tgz',
    });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ digest: expect.stringMatching(/^sha512:[0-9a-f]{128}$/u), bytes }));
    expect(hold).toHaveBeenCalledWith([expect.stringMatching(/^sha512:[0-9a-f]{128}$/u)]);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('rejects bytes that do not match the frozen integrity', async () => {
    const bytes = archive([{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }]);
    const verifier = await loadVerifier({ requestTarball: async () => bytes, store: { enabled: false, put: async () => undefined } });
    await expect(verifier.verify({
      graph: graph(bytes, { nodes: [{ ...(graph(bytes).nodes as Record<string, unknown>[])[0], integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` }] }),
      rootBundlePath: 'cordis.patch.yml',
    })).rejects.toMatchObject({ code: 'catalog:artifact-integrity', check: 'artifact-bytes' });
  });

  it('keeps root lifecycle scripts blocked while safely ignoring transitive dependency scripts', async () => {
    const rootBytes = archive([
      {
        path: 'package/package.json',
        body: JSON.stringify({
          name: '@community/example',
          version: '1.2.3',
          dependencies: { scripted: '1.0.0' },
        }),
      },
      { path: 'package/cordis.patch.yml' },
    ]);
    const dependencyBytes = archive([
      {
        path: 'scripted/package.json',
        body: JSON.stringify({
          name: 'scripted',
          version: '1.0.0',
          scripts: { postinstall: 'node scripts/postinstall.js' },
        }),
      },
      { path: 'scripted/index.js' },
    ]);
    const frozen = graph(rootBytes, {
      edges: [{
        from: '@community/example@1.2.3',
        to: 'scripted@1.0.0',
        name: 'scripted',
        requested: '1.0.0',
        kind: 'runtime',
      }],
      nodes: [
        {
          id: '@community/example@1.2.3',
          name: '@community/example',
          version: '1.2.3',
          tarball: 'https://registry.npmjs.org/@community/example/-/example-1.2.3.tgz',
          integrity: `sha512-${createHash('sha512').update(rootBytes).digest('base64')}`,
        },
        {
          id: 'scripted@1.0.0',
          name: 'scripted',
          version: '1.0.0',
          tarball: 'https://registry.npmjs.org/scripted/-/scripted-1.0.0.tgz',
          integrity: `sha512-${createHash('sha512').update(dependencyBytes).digest('base64')}`,
        },
      ],
    });
    const verifier = await loadVerifier({
      requestTarball: async ({ packageName }: { readonly packageName: string }) =>
        packageName === 'scripted' ? dependencyBytes : rootBytes,
      store: { enabled: false, put: async () => undefined },
    });

    await expect(verifier.verify({ graph: frozen, rootBundlePath: 'cordis.patch.yml' }))
      .resolves.toMatchObject({ status: 'verified', summary: { artifacts: 2 } });
  });

  it('deduplicates byte-identical npm entries that contain a harmless dot segment', async () => {
    const packageJson = JSON.stringify({ name: '@community/example', version: '1.2.3' });
    const bytes = archive([
      { path: 'package/package.json', body: packageJson },
      { path: 'package/cordis.patch.yml' },
      { path: 'package/./dist/index.js', body: 'export {}' },
      { path: 'package/dist/index.js', body: 'export {}' },
    ]);
    const verifier = await loadVerifier({
      requestTarball: async () => bytes,
      store: { enabled: false, put: async () => undefined },
    });

    await expect(verifier.verify({ graph: graph(bytes), rootBundlePath: 'cordis.patch.yml' }))
      .resolves.toMatchObject({ status: 'verified', summary: { fileCount: 3 } });
  });

  it.each([
    ['path traversal', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }, { path: 'package/../escape.js' }], 'catalog:artifact-unsafe-path'],
    ['symbolic link', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }, { path: 'package/link', type: '2' }], 'catalog:artifact-unsafe-entry'],
    ['missing bundle', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }], 'catalog:artifact-bundle-missing'],
    ['duplicate paths', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }, { path: 'package/CORDIS.patch.yml' }, { path: 'package/cordis.patch.yml' }], 'catalog:artifact-unsafe-path'],
    ['conflicting normalized paths', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }, { path: 'package/./cordis.patch.yml', body: 'first' }, { path: 'package/cordis.patch.yml', body: 'second' }], 'catalog:artifact-unsafe-path'],
    ['install lifecycle scripts', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3', scripts: { install: 'node install.js' } }) }, { path: 'package/cordis.patch.yml' }], 'catalog:artifact-lifecycle-scripts'],
    ['installer-owned node_modules', [{ path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }, { path: 'package/cordis.patch.yml' }, { path: 'package/node_modules/injected/index.js' }], 'catalog:artifact-unsafe-path'],
    ['unrelated archive root', [{ path: 'unrelated/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3' }) }, { path: 'unrelated/cordis.patch.yml' }], 'catalog:artifact-unsafe-path'],
  ])('rejects %s archives', async (_label, entries, code) => {
    const bytes = archive(entries);
    const verifier = await loadVerifier({ requestTarball: async () => bytes, store: { enabled: false, put: async () => undefined } });
    await expect(verifier.verify({ graph: graph(bytes), rootBundlePath: 'cordis.patch.yml' }))
      .rejects.toMatchObject({ code });
  });

  it('rejects tarball dependencies that differ from the frozen graph', async () => {
    const bytes = archive([
      { path: 'package/package.json', body: JSON.stringify({ name: '@community/example', version: '1.2.3', dependencies: { alpha: '^2.0.0' } }) },
      { path: 'package/cordis.patch.yml' },
    ]);
    const verifier = await loadVerifier({ requestTarball: async () => bytes, store: { enabled: false, put: async () => undefined } });
    await expect(verifier.verify({
      graph: graph(bytes, { edges: [{ from: '@community/example@1.2.3', name: 'alpha', requested: '^1.0.0', kind: 'runtime' }] }),
      rootBundlePath: 'cordis.patch.yml',
    })).rejects.toMatchObject({ code: 'catalog:artifact-dependency-mismatch' });
  });

  it('rejects peer declarations that differ from the frozen graph', async () => {
    const bytes = archive([
      {
        path: 'package/package.json',
        body: JSON.stringify({
          name: '@community/example', version: '1.2.3', peerDependencies: { react: '^19.0.0' },
        }),
      },
      { path: 'package/cordis.patch.yml' },
    ]);
    const frozen = graph(bytes, {
      peerRequirements: [{
        from: '@community/example@1.2.3', name: 'react', range: '^18.0.0', optional: false,
      }],
      peerCompatibility: {
        status: 'compatible', runtimeSnapshotHash: `sha256:${'b'.repeat(64)}`,
        resolutions: [{
          from: '@community/example@1.2.3', name: 'react', range: '^18.0.0', optional: false,
          state: 'satisfied', provider: 'runtime', version: '18.3.1',
        }],
      },
    });
    const verifier = await loadVerifier({
      requestTarball: async () => bytes,
      store: { enabled: false, put: async () => undefined },
    });

    await expect(verifier.verify({ graph: frozen, rootBundlePath: 'cordis.patch.yml' }))
      .rejects.toMatchObject({ code: 'catalog:artifact-peer-mismatch' });
  });
});
