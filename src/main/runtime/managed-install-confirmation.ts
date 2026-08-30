import type {
  ManagedPluginExecuteRequest,
  ManagedPluginExecuteResult,
  ManagedPluginInstallOperation,
  ManagedPluginPreviewSummary,
} from '../../shared/managed-plugin-preview.js';
import type { PluginProfileCandidate } from './plugin-profile-bootstrap.js';
import type {
  ManagedInstallExpectedExternal,
  ManagedInstallTransaction,
} from './managed-install-transaction.js';

interface ManagedInstallConfirmationOptions {
  readonly transaction: ManagedInstallTransaction;
  readonly confirm: (
    summary: ManagedPluginPreviewSummary,
    operation: ManagedPluginInstallOperation,
  ) => Promise<boolean>;
  readonly runtimeAvailable: () => boolean;
  readonly scheduleRestart: () => void;
  readonly now?: () => number;
}

interface ConfirmationEntry {
  readonly summary: ManagedPluginPreviewSummary;
  readonly operation: ManagedPluginInstallOperation;
  readonly expiresAt: number;
}

export interface ManagedInstallConfirmation {
  issue(input: {
    readonly generation: string;
    readonly candidate: PluginProfileCandidate;
    readonly stagingPreviewId: string;
    readonly expiresInSeconds: number;
    readonly summary: ManagedPluginPreviewSummary;
    readonly operation: ManagedPluginInstallOperation;
    readonly expectedReceipt: null | {
      readonly packageName: string;
      readonly version: string;
      readonly generation: string;
    };
    readonly expectedExternal?: ManagedInstallExpectedExternal;
  }): {
    readonly previewId: string;
    readonly profileGeneration: string;
    readonly expiresInSeconds: number;
    readonly summary: ManagedPluginPreviewSummary;
    readonly operation: ManagedPluginInstallOperation;
  };
  execute(request: ManagedPluginExecuteRequest): Promise<ManagedPluginExecuteResult>;
}

/** Owns the user-confirmation seam before any managed plugin filesystem mutation. */
export function createManagedInstallConfirmation(
  options: ManagedInstallConfirmationOptions,
): ManagedInstallConfirmation {
  const now = options.now ?? Date.now;
  const entries = new Map<string, ConfirmationEntry>();
  let active = false;

  const prune = (): void => {
    const timestamp = now();
    for (const [previewId, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(previewId);
    }
  };

  return Object.freeze({
    issue(
      input: Parameters<ManagedInstallConfirmation['issue']>[0],
    ): ReturnType<ManagedInstallConfirmation['issue']> {
      prune();
      if (
        !Number.isSafeInteger(input.expiresInSeconds) ||
        input.expiresInSeconds < 1 ||
        input.expiresInSeconds > 300
      ) {
        throw new Error('Managed confirmation lifetime is invalid');
      }
      const capability = options.transaction.issue({
        generation: input.generation,
        candidate: input.candidate,
        stagingPreviewId: input.stagingPreviewId,
        expectedReceipt: input.expectedReceipt,
        ...(input.expectedExternal === undefined
          ? {}
          : { expectedExternal: input.expectedExternal }),
      });
      const expiresInSeconds = Math.min(capability.expiresInSeconds, input.expiresInSeconds);
      entries.set(
        capability.previewId,
        Object.freeze({
          summary: input.summary,
          operation: input.operation,
          expiresAt: now() + expiresInSeconds * 1_000,
        }),
      );
      return Object.freeze({
        ...capability,
        expiresInSeconds,
        operation: input.operation,
        summary: input.summary,
      });
    },

    async execute(request: ManagedPluginExecuteRequest): Promise<ManagedPluginExecuteResult> {
      prune();
      const entry = entries.get(request.previewId);
      if (entry === undefined) {
        return unavailable(request.requestId, 'preview-unavailable');
      }
      if (active) return unavailable(request.requestId, 'busy');
      if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
      active = true;
      try {
        if (!(await options.confirm(entry.summary, entry.operation))) {
          return { requestId: request.requestId, status: 'cancelled' };
        }
        prune();
        if (entries.get(request.previewId) !== entry) {
          return unavailable(request.requestId, 'preview-unavailable');
        }
        if (!options.runtimeAvailable()) {
          return unavailable(request.requestId, 'runtime-unavailable');
        }
        entries.delete(request.previewId);
        await options.transaction.execute(request.previewId);
        options.scheduleRestart();
        return {
          requestId: request.requestId,
          status: 'prepared',
          restartScheduled: true,
        };
      } catch (error) {
        const code =
          error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : '';
        return unavailable(
          request.requestId,
          code.endsWith('preview-unavailable') ? 'preview-unavailable' : 'failed',
        );
      } finally {
        active = false;
      }
    },
  });
}

function unavailable(
  requestId: string,
  reason: Extract<ManagedPluginExecuteResult, { status: 'unavailable' }>['reason'],
): ManagedPluginExecuteResult {
  return { requestId, status: 'unavailable', reason };
}
