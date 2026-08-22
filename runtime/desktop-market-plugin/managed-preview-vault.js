import { randomUUID } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEWS = 32;
const PREVIEW_PATTERN = /^preview-[a-f0-9-]{36}$/u;
const GENERATION_PATTERN = /^gen-[a-f0-9]{64}$/u;

export function createManagedPreviewVault(options) {
  const inspector = options.inspector;
  const installer = options.installer;
  const artifactCache = options.artifactCache;
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return timer;
  });
  const cancel = options.cancel ?? clearTimeout;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > DEFAULT_TTL_MS) {
    throw vaultError('invalid-options', 'Invalid managed preview lifetime');
  }
  const previews = new Map();
  let mutationActive = false;

  return Object.freeze({
    async issue(identity) {
      pruneExpired(previews, now(), cancel);
      const inspected = await inspector.inspectVerified(identity);
      if (!isRecord(inspected) || !isRecord(inspected.value) || !isRecord(inspected.installation)) {
        throw vaultError('not-installable', 'Inspection did not produce a verified installation');
      }
      const installation = inspected.installation;
      if (!GENERATION_PATTERN.test(installation.generation ?? '') || !isRecord(installation.candidate) ||
        !isRecord(installation.plan)) {
        throw vaultError('invalid-installation', 'Verified installation is invalid');
      }
      for (const [previewId, entry] of previews) {
        if (entry.generation === installation.generation) {
          previews.delete(previewId);
          cancel(entry.timer);
          entry.release();
        }
      }
      if (previews.size >= MAX_PREVIEWS) throw vaultError('preview-limit', 'Too many managed install previews');
      const previewId = `preview-${randomId()}`;
      if (!PREVIEW_PATTERN.test(previewId) || previews.has(previewId)) {
        throw vaultError('invalid-preview-id', 'Could not allocate managed install preview');
      }
      const cacheDigests = frozenDigests(installation.plan);
      const release = artifactCache?.hold?.(cacheDigests) ?? (() => undefined);
      const entry = {
        generation: installation.generation,
        candidate: installation.candidate,
        plan: installation.plan,
        cacheDigests,
        release,
        expiresAt: now() + ttlMs,
        timer: undefined,
      };
      previews.set(previewId, entry);
      entry.timer = schedule(() => {
        if (previews.get(previewId) !== entry) return;
        previews.delete(previewId);
        release();
      }, ttlMs);
      Object.freeze(entry);
      return Object.freeze({
        previewId,
        profileGeneration: installation.generation,
        expiresInSeconds: Math.floor(ttlMs / 1_000),
        candidate: installation.candidate,
        inspection: inspected.value,
      });
    },

    async stage(previewId) {
      if (!PREVIEW_PATTERN.test(previewId ?? '')) throw vaultError('invalid-preview-id', 'Invalid managed install preview');
      pruneExpired(previews, now(), cancel);
      const entry = previews.get(previewId);
      if (entry === undefined) throw vaultError('preview-unavailable', 'Managed install preview expired or was consumed');
      if (mutationActive) throw vaultError('busy', 'Another managed plugin mutation is active');
      previews.delete(previewId);
      cancel(entry.timer);
      mutationActive = true;
      try {
        const staged = await installer.stage({ generation: entry.generation, plan: entry.plan });
        return Object.freeze({
          status: 'staged',
          profileGeneration: entry.generation,
          candidate: entry.candidate,
          cacheDigests: entry.cacheDigests,
          stagingStatus: staged.status,
        });
      } catch (error) {
        if (error?.code?.startsWith('catalog:')) throw error;
        throw vaultError('stage-failed', 'Managed preview could not be staged', error);
      } finally {
        entry.release();
        mutationActive = false;
      }
    },
  });
}

function pruneExpired(previews, timestamp, cancel) {
  for (const [previewId, entry] of previews) {
    if (entry.expiresAt <= timestamp) {
      previews.delete(previewId);
      cancel(entry.timer);
      entry.release();
    }
  }
}

function frozenDigests(plan) {
  if (!Array.isArray(plan?.artifacts)) return Object.freeze([]);
  const values = plan.artifacts.map((artifact) => artifact?.digest);
  if (values.length > 256 || values.some((digest) => !/^sha512:[a-f0-9]{128}$/u.test(digest ?? ''))) {
    throw vaultError('invalid-installation', 'Verified installation has invalid cache references');
  }
  return Object.freeze([...new Set(values)].sort());
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function vaultError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = `catalog:vault-${code}`;
  return error;
}
