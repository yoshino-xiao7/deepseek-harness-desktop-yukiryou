import type { PluginProfileCandidate } from './plugin-profile-bootstrap.js';
import type { RuntimeFetch } from './runtime-supervisor.js';

const ROUTE = '/plugins/@dsh-desktop/market/managed-rpc';
const MAX_RESPONSE_BYTES = 128 * 1024;
const PREVIEW_PATTERN = /^preview-[a-f0-9-]{36}$/u;
const GENERATION_PATTERN = /^gen-[a-f0-9]{64}$/u;

export interface RuntimeManagedPreview {
  readonly previewId: string;
  readonly profileGeneration: string;
  readonly expiresInSeconds: number;
  readonly candidate: PluginProfileCandidate;
  readonly inspection: Readonly<Record<string, unknown>>;
}

export interface RuntimeMarketClient {
  preview(
    origin: string,
    identity: {
      readonly sourceRecordId: string;
      readonly itemId: string;
      readonly versionPreference: 'catalog' | 'latest';
    },
  ): Promise<RuntimeManagedPreview>;
  previewExternal(
    origin: string,
    identity: {
      readonly packageName: string;
      readonly currentVersion: string;
      readonly repository: string;
      readonly versionPreference: 'catalog' | 'latest';
    },
  ): Promise<RuntimeManagedPreview>;
  stage(origin: string, previewId: string): Promise<{
    readonly status: string;
    readonly profileGeneration: string;
    readonly candidate: PluginProfileCandidate;
    readonly cacheDigests: readonly string[];
  }>;
}

export function createRuntimeMarketClient(
  token: string,
  runtimeFetch: RuntimeFetch = fetch,
): RuntimeMarketClient {
  if (token.length < 32) throw new Error('Runtime market client requires a private token');
  return Object.freeze({
    async preview(
      origin: string,
      identity: {
        readonly sourceRecordId: string;
        readonly itemId: string;
        readonly versionPreference: 'catalog' | 'latest';
      },
    ) {
      const value = await execute(origin, token, {
        kind: 'preview',
        sourceRecordId: identity.sourceRecordId,
        itemId: identity.itemId,
        versionPreference: identity.versionPreference,
      }, runtimeFetch);
      const preview = validatedPreview(value);
      if (preview === undefined) throw new Error('Runtime returned an invalid managed preview');
      return preview;
    },

    async previewExternal(
      origin: string,
      identity: {
        readonly packageName: string;
        readonly currentVersion: string;
        readonly repository: string;
        readonly versionPreference: 'catalog' | 'latest';
      },
    ) {
      const value = await execute(origin, token, {
        kind: 'preview-external',
        packageName: identity.packageName,
        currentVersion: identity.currentVersion,
        repository: identity.repository,
        versionPreference: identity.versionPreference,
      }, runtimeFetch);
      const preview = validatedPreview(value);
      if (preview === undefined) throw new Error('Runtime returned an invalid managed preview');
      return preview;
    },

    async stage(origin: string, previewId: string) {
      if (!PREVIEW_PATTERN.test(previewId)) throw new Error('Invalid Runtime staging preview');
      const value = await execute(
        origin,
        token,
        { kind: 'stage', previewId },
        runtimeFetch,
      );
      if (!isRecord(value) || value.status !== 'staged' ||
        !GENERATION_PATTERN.test(stringValue(value.profileGeneration)) ||
        !validCandidate(value.candidate)) {
        throw new Error('Runtime returned an invalid staging result');
      }
      const cacheDigests = validCacheDigests(value.cacheDigests);
      if (cacheDigests === undefined) throw new Error('Runtime returned invalid cache references');
      return Object.freeze({
        status: stringValue(value.stagingStatus) || 'staged',
        profileGeneration: value.profileGeneration as string,
        candidate: value.candidate,
        cacheDigests: Object.freeze(cacheDigests),
      });
    },
  });
}

async function execute(
  origin: string,
  token: string,
  payload: unknown,
  runtimeFetch: RuntimeFetch,
): Promise<unknown> {
  const response = await runtimeFetch(new URL(ROUTE, origin), {
    method: 'POST',
    redirect: 'error',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-dsh-desktop-companion-token': token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const envelope = JSON.parse(await readBoundedBody(response, MAX_RESPONSE_BYTES)) as unknown;
  if (!response.ok || !isRecord(envelope) || envelope.ok !== true) {
    throw new Error('Runtime managed market request failed');
  }
  return envelope.value;
}

function validatedPreview(value: unknown): RuntimeManagedPreview | undefined {
  if (!isRecord(value) || !PREVIEW_PATTERN.test(stringValue(value.previewId)) ||
    !GENERATION_PATTERN.test(stringValue(value.profileGeneration)) ||
    !Number.isSafeInteger(value.expiresInSeconds) || Number(value.expiresInSeconds) < 1 ||
    Number(value.expiresInSeconds) > 300 || !validCandidate(value.candidate) ||
    !isRecord(value.inspection) || value.inspection.executionReady !== false) return undefined;
  return Object.freeze({
    previewId: value.previewId as string,
    profileGeneration: value.profileGeneration as string,
    expiresInSeconds: value.expiresInSeconds as number,
    candidate: value.candidate,
    inspection: Object.freeze({ ...value.inspection }),
  });
}

function validCandidate(value: unknown): value is PluginProfileCandidate {
  return isRecord(value) &&
    typeof value.packageName === 'string' && value.packageName.length > 0 && value.packageName.length <= 214 &&
    typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 100 &&
    typeof value.integrity === 'string' && value.integrity.length > 0 && value.integrity.length <= 200 &&
    typeof value.sourceId === 'string' && value.sourceId.length > 0 && value.sourceId.length <= 100 &&
    typeof value.bundlePath === 'string' && value.bundlePath.length > 0 && value.bundlePath.length <= 240 &&
    /^sha256:[a-f0-9]{64}$/u.test(stringValue(value.graphHash)) &&
    /^sha256:[a-f0-9]{64}$/u.test(stringValue(value.lockHash));
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Runtime market response is too large');
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Runtime market response is too large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function validCacheDigests(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 256) return undefined;
  const result = value.filter((item): item is string =>
    typeof item === 'string' && /^sha512:[a-f0-9]{128}$/u.test(item));
  return result.length === value.length && new Set(result).size === result.length
    ? [...result].sort()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
