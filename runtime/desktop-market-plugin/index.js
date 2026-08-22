import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';

import { createCatalog } from './catalog.js';
import { createCatalogSnapshotStore } from './catalog-cache.js';
import { createMediaProxy } from './media.js';
import { createInstallInspector } from './install-inspector.js';
import { createManagedPluginInstaller } from './managed-installer.js';
import { createManagedPreviewVault } from './managed-preview-vault.js';
import { createSourceRegistry } from './source-registry.js';
import { createArtifactCache } from './artifact-cache.js';
import { createArtifactVerifier } from './artifact-verifier.js';
import {
  createDevelopmentCatalogAdapter,
  createDevelopmentFixture,
  createDevelopmentInspectorAdapter,
} from './development-fixture.js';

const CATALOG_ROUTE = '/plugins/@dsh-desktop/market/catalog';
const SOURCES_ROUTE = '/plugins/@dsh-desktop/market/sources';
const MEDIA_ROUTE = '/plugins/@dsh-desktop/market/media';
const INSPECTION_ROUTE = '/plugins/@dsh-desktop/market/install-inspection';
const MANAGED_ROUTE = '/plugins/@dsh-desktop/market/managed-rpc';
const PRIVATE_TOKEN_HEADER = 'x-dsh-desktop-companion-token';
const MUTATION_HEADER = 'x-dsh-desktop-market-mutation';
const INSPECTION_HEADER = 'x-dsh-desktop-market-inspection';
const MAX_REQUEST_BYTES = 8 * 1024;
const sourceRegistry = createSourceRegistry();
const mediaProxy = createMediaProxy();
const artifactCache = createArtifactCache();
const artifactVerifier = createArtifactVerifier({ store: artifactCache });
const developmentFixture = createDevelopmentFixture({
  enabled: process.env.DSH_DESKTOP_DEVELOPMENT_PLUGIN_FIXTURE === '1',
  artifactStore: artifactCache,
});
const catalog = createDevelopmentCatalogAdapter(
  createCatalog({ snapshotStore: createCatalogSnapshotStore(), sourceRegistry, mediaProxy }),
  developmentFixture,
);
const installInspector = createDevelopmentInspectorAdapter(createInstallInspector({
  catalog,
  artifactVerifier,
}), developmentFixture);
const managedPreviewVault = createManagedPreviewVault({
  inspector: installInspector,
  installer: createManagedPluginInstaller({ artifactStore: artifactCache }),
  artifactCache,
});

export const inject = ['webServer'];

export function apply(ctx) {
  const expectedPrivateToken = process.env.DSH_DESKTOP_COMPANION_TOKEN ?? '';
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: CATALOG_ROUTE,
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          send(response, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        try {
          const url = new URL(request.url ?? CATALOG_ROUTE, 'http://localhost');
          const sourceId = url.searchParams.get('source') ?? undefined;
          const snapshot = await catalog.read({
            ...(sourceId === undefined ? {} : { sourceId }),
            refresh: url.searchParams.get('refresh') === '1',
          });
          send(response, 200, { ok: true, value: snapshot });
        } catch (error) {
          const code = typeof error?.code === 'string' && error.code.startsWith('catalog:')
            ? error.code.slice('catalog:'.length)
            : 'unavailable';
          send(response, code === 'rate-limited' ? 429 : 503, { ok: false, error: code });
        }
      },
    }),
    'deepseek-yukiryou: read-only community catalog route',
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: SOURCES_ROUTE,
      handler: async (request, response) => {
        response.setHeader('cache-control', 'no-store');
        try {
          if (request.method === 'GET') {
            send(response, 200, { ok: true, value: await catalog.listSources() });
            return;
          }
          if (
            request.method !== 'POST' ||
            request.headers[MUTATION_HEADER] !== '1' ||
            !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')
          ) {
            send(response, request.method === 'POST' ? 403 : 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          const operation = JSON.parse(await readRequest(request));
          await sourceRegistry.mutate(operation);
          send(response, 200, { ok: true, value: await catalog.listSources() });
        } catch (error) {
          const code = typeof error?.code === 'string' && error.code.startsWith('catalog:')
            ? error.code.slice('catalog:'.length)
            : 'invalid-operation';
          const conflict = code === 'duplicate-source' || code === 'source-limit';
          send(response, conflict ? 409 : 400, { ok: false, error: code });
        }
      },
    }),
    'deepseek-yukiryou: managed community source records',
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: MEDIA_ROUTE,
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          send(response, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        try {
          const url = new URL(request.url ?? MEDIA_ROUTE, 'http://localhost');
          const image = await mediaProxy.read(url.searchParams.get('id'));
          response.writeHead(200, {
            'content-type': image.contentType,
            'content-length': String(image.bytes.length),
            'cache-control': 'private, max-age=86400, immutable',
            'content-security-policy': "default-src 'none'",
            'x-content-type-options': 'nosniff',
          });
          response.end(image.bytes);
        } catch (error) {
          const notFound = error?.code === 'catalog:not-found';
          send(response, notFound ? 404 : 502, { ok: false, error: notFound ? 'not-found' : 'media-unavailable' });
        }
      },
    }),
    'deepseek-yukiryou: normalized same-origin plugin media',
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: INSPECTION_ROUTE,
      handler: async (request, response) => {
        if (
          request.method !== 'POST' || request.headers[INSPECTION_HEADER] !== '1' ||
          !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')
        ) {
          send(response, request.method === 'POST' ? 403 : 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        try {
          const identity = JSON.parse(await readRequest(request));
          const value = await installInspector.inspect(identity);
          send(response, 200, { ok: true, value });
        } catch (error) {
          const code = typeof error?.code === 'string' && error.code.startsWith('catalog:')
            ? error.code.slice('catalog:'.length)
            : 'inspection-unavailable';
          const invalid = ['invalid-request', 'item-not-found', 'not-candidate'].includes(code);
          send(response, invalid ? 400 : code === 'rate-limited' ? 429 : 503, { ok: false, error: code });
        }
      },
    }),
    'deepseek-yukiryou: read-only npm graph, Runtime, and artifact inspection',
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: MANAGED_ROUTE,
      handler: async (request, response) => {
        response.setHeader('cache-control', 'no-store');
        if (request.method !== 'POST') {
          send(response, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        if (!authorizedManagedRequest(expectedPrivateToken, request.headers[PRIVATE_TOKEN_HEADER])) {
          send(response, 403, { ok: false, error: 'forbidden' });
          return;
        }
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          send(response, 415, { ok: false, error: 'unsupported-media-type' });
          return;
        }
        try {
          const payload = JSON.parse(await readRequest(request));
          const value = payload?.kind === 'preview'
            ? await managedPreviewVault.issue({
                sourceRecordId: payload.sourceRecordId,
                itemId: payload.itemId,
              })
            : payload?.kind === 'stage'
              ? await managedPreviewVault.stage(payload.previewId)
              : undefined;
          if (value === undefined) {
            send(response, 400, { ok: false, error: 'invalid-operation' });
            return;
          }
          send(response, 200, { ok: true, value });
        } catch (error) {
          const code = typeof error?.code === 'string' && error.code.startsWith('catalog:')
            ? error.code.slice('catalog:'.length)
            : 'managed-operation-failed';
          const conflict = code === 'vault-busy' || code === 'vault-preview-limit';
          const invalid = code === 'vault-invalid-preview-id' || code === 'vault-preview-unavailable' ||
            code === 'vault-not-installable' || code === 'invalid-request' || code === 'item-not-found' ||
            code === 'not-candidate';
          send(response, conflict ? 409 : invalid ? 400 : 503, { ok: false, error: code });
        }
      },
    }),
    'deepseek-yukiryou: authenticated managed plugin preview and staging rpc',
  );
}

export function authorizedManagedRequest(expected, presented) {
  if (typeof expected !== 'string' || expected.length < 32 || typeof presented !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes);
}

async function readRequest(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('request too large');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_REQUEST_BYTES) throw new Error('request too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
