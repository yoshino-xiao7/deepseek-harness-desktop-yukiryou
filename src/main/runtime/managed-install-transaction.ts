import { randomUUID } from 'node:crypto';

import {
  createPluginProfileGeneration,
  type PluginProfileBootstrap,
  type PluginProfileCandidate,
} from './plugin-profile-bootstrap.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEWS = 32;
const PREVIEW_PATTERN = /^preview-[a-f0-9-]{36}$/u;

interface ManagedInstaller {
  stage(input: { readonly generation: string; readonly previewId: string }): Promise<{
    readonly status: string;
    readonly profileGeneration: string;
    readonly candidate: PluginProfileCandidate;
    readonly cacheDigests: readonly string[];
  }>;
}

interface PreviewEntry {
  readonly previewId: string;
  readonly generation: string;
  readonly candidate: PluginProfileCandidate;
  readonly stagingPreviewId: string;
  readonly expectedReceipt: ManagedInstallExpectedReceipt;
  readonly expiresAt: number;
}

export type ManagedInstallExpectedReceipt = null | {
  readonly packageName: string;
  readonly version: string;
  readonly generation: string;
};

export interface ManagedInstallTransaction {
  issue(input: {
    readonly generation: string;
    readonly candidate: PluginProfileCandidate;
    readonly stagingPreviewId: string;
    readonly expectedReceipt: ManagedInstallExpectedReceipt;
  }): {
    readonly previewId: string;
    readonly profileGeneration: string;
    readonly expiresInSeconds: number;
  };
  execute(previewId: string): Promise<{
    readonly status: 'prepared';
    readonly profileGeneration: string;
    readonly stagingStatus: string;
  }>;
}

interface ManagedInstallTransactionOptions {
  readonly installer: ManagedInstaller;
  readonly bootstrap: Pick<PluginProfileBootstrap, 'prepare'>;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly ttlMs?: number;
}

/**
 * Owns the one-shot seam between a verified Host preview, offline generation
 * staging, and the pre-Runtime profile transaction. It never exposes the
 * frozen plan and consumes a preview before the first filesystem mutation.
 */
export function createManagedInstallTransaction(
  options: ManagedInstallTransactionOptions,
): ManagedInstallTransaction {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > DEFAULT_TTL_MS) {
    throw transactionError('invalid-options', 'Invalid managed preview lifetime');
  }
  const previews = new Map<string, PreviewEntry>();
  let mutationActive = false;

  return Object.freeze({
    issue(input: {
      readonly generation: string;
      readonly candidate: PluginProfileCandidate;
      readonly stagingPreviewId: string;
      readonly expectedReceipt: ManagedInstallExpectedReceipt;
    }) {
      pruneExpired(previews, now());
      if (previews.size >= MAX_PREVIEWS) {
        throw transactionError('preview-limit', 'Too many managed install previews');
      }
      if (createPluginProfileGeneration(input.candidate) !== input.generation) {
        throw transactionError(
          'generation-mismatch',
          'Preview generation does not match candidate',
        );
      }
      if (!PREVIEW_PATTERN.test(input.stagingPreviewId)) {
        throw transactionError(
          'invalid-preview-id',
          'Managed install transaction has no staging capability',
        );
      }
      for (const [previewId, entry] of previews) {
        if (entry.generation === input.generation) previews.delete(previewId);
      }
      const previewId = `preview-${randomId()}`;
      if (!PREVIEW_PATTERN.test(previewId) || previews.has(previewId)) {
        throw transactionError('invalid-preview-id', 'Could not allocate managed install preview');
      }
      previews.set(
        previewId,
        Object.freeze({
          previewId,
          generation: input.generation,
          candidate: Object.freeze({ ...input.candidate }),
          stagingPreviewId: input.stagingPreviewId,
          expectedReceipt:
            input.expectedReceipt === null ? null : Object.freeze({ ...input.expectedReceipt }),
          expiresAt: now() + ttlMs,
        }),
      );
      return Object.freeze({
        previewId,
        profileGeneration: input.generation,
        expiresInSeconds: Math.floor(ttlMs / 1_000),
      });
    },

    async execute(previewId: string) {
      if (!PREVIEW_PATTERN.test(previewId)) {
        throw transactionError('invalid-preview-id', 'Invalid managed install preview');
      }
      const timestamp = now();
      pruneExpired(previews, timestamp);
      const entry = previews.get(previewId);
      if (entry === undefined) {
        throw transactionError(
          'preview-unavailable',
          'Managed install preview expired or was already consumed',
        );
      }
      if (mutationActive) {
        throw transactionError('busy', 'Another managed plugin mutation is active');
      }
      previews.delete(previewId);
      mutationActive = true;
      try {
        const staged = await options.installer.stage({
          generation: entry.generation,
          previewId: entry.stagingPreviewId,
        });
        if (
          staged.profileGeneration !== entry.generation ||
          createPluginProfileGeneration(staged.candidate) !== entry.generation ||
          !sameCandidate(staged.candidate, entry.candidate)
        ) {
          throw transactionError('generation-mismatch', 'Staged generation does not match preview');
        }
        await options.bootstrap.prepare(
          entry.generation,
          staged.candidate,
          staged.cacheDigests,
          entry.expectedReceipt,
        );
        return Object.freeze({
          status: 'prepared' as const,
          profileGeneration: entry.generation,
          stagingStatus: staged.status,
        });
      } catch (error) {
        if (isTransactionError(error)) throw error;
        throw transactionError(
          'execute-failed',
          'Managed plugin transaction could not be prepared',
          error,
        );
      } finally {
        mutationActive = false;
      }
    },
  });
}

function sameCandidate(left: PluginProfileCandidate, right: PluginProfileCandidate): boolean {
  return (
    left.packageName === right.packageName &&
    left.version === right.version &&
    left.integrity === right.integrity &&
    left.sourceId === right.sourceId &&
    left.bundlePath === right.bundlePath &&
    left.graphHash === right.graphHash &&
    left.lockHash === right.lockHash
  );
}

function pruneExpired(previews: Map<string, PreviewEntry>, timestamp: number): void {
  for (const [previewId, entry] of previews) {
    if (entry.expiresAt <= timestamp) previews.delete(previewId);
  }
}

function isTransactionError(value: unknown): value is Error & { readonly code: string } {
  return (
    value instanceof Error &&
    'code' in value &&
    typeof value.code === 'string' &&
    value.code.startsWith('catalog:transaction-')
  );
}

function transactionError(
  code: string,
  message: string,
  cause?: unknown,
): Error & { code: string } {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as Error & {
    code: string;
  };
  error.code = `catalog:transaction-${code}`;
  return error;
}
