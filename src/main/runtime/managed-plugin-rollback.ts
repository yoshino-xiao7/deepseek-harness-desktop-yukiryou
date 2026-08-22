import type {
  ManagedPluginRollbackRequest,
  ManagedPluginRollbackResult,
} from '../../shared/managed-plugin-inventory.js';
import type { PluginProfileBootstrap } from './plugin-profile-bootstrap.js';

interface ManagedPluginRollbackOptions {
  readonly bootstrap: Pick<PluginProfileBootstrap, 'inventory' | 'prepareRollback'>;
  readonly confirm: (summary: {
    readonly packageName: string;
    readonly currentVersion: string;
    readonly targetVersion: string;
  }) => Promise<boolean>;
  readonly runtimeAvailable: () => boolean;
  readonly scheduleRestart: () => void;
}

export interface ManagedPluginRollback {
  execute(request: ManagedPluginRollbackRequest): Promise<ManagedPluginRollbackResult>;
}

/** Owns exact-receipt revalidation, native confirmation, and rollback preparation. */
export function createManagedPluginRollback(
  options: ManagedPluginRollbackOptions,
): ManagedPluginRollback {
  let active = false;
  return Object.freeze({
    async execute(request: ManagedPluginRollbackRequest): Promise<ManagedPluginRollbackResult> {
      if (active) return unavailable(request.requestId, 'busy');
      if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
      active = true;
      try {
        const snapshot = await options.bootstrap.inventory();
        const receipt = snapshot.entries.find((entry) => entry.packageName === request.packageName);
        if (receipt === undefined || receipt.version !== request.version ||
          receipt.generation !== request.generation || receipt.rollbackTarget === null) {
          return unavailable(request.requestId, 'receipt-mismatch');
        }
        if (!(await options.confirm({
          packageName: receipt.packageName,
          currentVersion: receipt.version,
          targetVersion: receipt.rollbackTarget.version,
        }))) {
          return { requestId: request.requestId, status: 'cancelled' };
        }
        if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
        const current = await options.bootstrap.inventory();
        const confirmed = current.entries.find((entry) => entry.packageName === request.packageName);
        if (confirmed === undefined || confirmed.version !== request.version ||
          confirmed.generation !== request.generation || confirmed.rollbackTarget === null ||
          confirmed.rollbackTarget.generation !== receipt.rollbackTarget.generation) {
          return unavailable(request.requestId, 'receipt-mismatch');
        }
        await options.bootstrap.prepareRollback({
          packageName: request.packageName,
          version: request.version,
          generation: request.generation,
        });
        options.scheduleRestart();
        return { requestId: request.requestId, status: 'prepared', restartScheduled: true };
      } catch (error) {
        const mismatch = error instanceof Error &&
          (error.message.includes('receipt no longer matches') ||
            error.message.includes('rollback target is unavailable'));
        return unavailable(request.requestId, mismatch ? 'receipt-mismatch' : 'failed');
      } finally {
        active = false;
      }
    },
  });
}

function unavailable(
  requestId: string,
  reason: Extract<ManagedPluginRollbackResult, { status: 'unavailable' }>['reason'],
): ManagedPluginRollbackResult {
  return { requestId, status: 'unavailable', reason };
}
