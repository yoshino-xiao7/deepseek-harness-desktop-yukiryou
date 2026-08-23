import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeMarketClient } from './runtime-market-client.js';

const token = 'private-runtime-token-that-is-long-enough';
const generation = `gen-${'a'.repeat(64)}`;
const candidate = {
  packageName: '@community/example', version: '1.2.3', integrity: 'sha512-example',
  sourceId: 'dshfind', bundlePath: 'cordis.patch.yml',
  graphHash: `sha256:${'b'.repeat(64)}`, lockHash: `sha256:${'c'.repeat(64)}`,
};
const cacheDigests = [`sha512:${'d'.repeat(128)}`];

afterEach(() => vi.unstubAllGlobals());

describe('RuntimeMarketClient', () => {
  it('uses the private token and accepts only bounded normalized previews', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: {
        previewId: 'preview-11111111-1111-4111-8111-111111111111',
        profileGeneration: generation,
        expiresInSeconds: 300,
        candidate,
        inspection: { status: 'artifact-verified', executionReady: false },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createRuntimeMarketClient(token);

    await expect(client.preview('http://127.0.0.1:31337', {
      sourceRecordId: 'dshfind', itemId: 'example',
      versionPreference: 'latest',
    })).resolves.toMatchObject({ profileGeneration: generation, expiresInSeconds: 300 });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:31337/plugins/@dsh-desktop/market/managed-rpc'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-dsh-desktop-companion-token': token }),
        body: JSON.stringify({
          kind: 'preview', sourceRecordId: 'dshfind', itemId: 'example', versionPreference: 'latest',
        }),
      }),
    );
  });

  it('rejects malformed Host responses and invalid preview IDs before staging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { profileGeneration: generation, expiresInSeconds: 301, candidate, inspection: {} },
    }), { status: 200 })));
    const client = createRuntimeMarketClient(token);

    await expect(client.preview('http://127.0.0.1:31337', {
      sourceRecordId: 'dshfind', itemId: 'example',
      versionPreference: 'catalog',
    })).rejects.toThrow('invalid managed preview');
    await expect(client.stage('http://127.0.0.1:31337', '../invalid')).rejects
      .toThrow('Invalid Runtime staging preview');
  });

  it('validates the generation and candidate returned after staging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { status: 'staged', stagingStatus: 'reused', profileGeneration: generation, candidate, cacheDigests },
    }), { status: 200 })));
    const client = createRuntimeMarketClient(token);

    await expect(client.stage(
      'http://127.0.0.1:31337',
      'preview-22222222-2222-4222-8222-222222222222',
    )).resolves.toEqual({ status: 'reused', profileGeneration: generation, candidate, cacheDigests });
  });

  it('rejects staging without bounded cache references', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { status: 'staged', profileGeneration: generation, candidate },
    }), { status: 200 })));
    const client = createRuntimeMarketClient(token);

    await expect(client.stage(
      'http://127.0.0.1:31337',
      'preview-33333333-3333-4333-8333-333333333333',
    )).rejects.toThrow('invalid cache references');
  });
});
