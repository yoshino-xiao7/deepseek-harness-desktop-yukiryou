import type {
  ManagedPluginRemoveRequest,
  ManagedPluginRemoveResult,
} from '../../shared/managed-plugin-inventory.js';
import type { PluginProfileBootstrap } from './plugin-profile-bootstrap.js';

interface ManagedPluginRemovalOptions {
  readonly bootstrap: Pick<PluginProfileBootstrap, 'inventory' | 'prepareRemoval'>;
  readonly confirm: (summary: {
    readonly packageName: string;
    readonly version: string;
    readonly installedAt: string;
  }) => Promise<boolean>;
  readonly runtimeAvailable: () => boolean;
  readonly scheduleRestart: () => void;
}

export interface ManagedPluginRemoval {
  execute(request: ManagedPluginRemoveRequest): Promise<ManagedPluginRemoveResult>;
}

/** Owns exact-receipt revalidation, native confirmation, and removal preparation. */
export function createManagedPluginRemoval(
  options: ManagedPluginRemovalOptions,
): ManagedPluginRemoval {
  let active = false;
  return Object.freeze({
    async execute(request: ManagedPluginRemoveRequest): Promise<ManagedPluginRemoveResult> {
      if (active) return unavailable(request.requestId, 'busy');
      if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
      active = true;
      try {
        const snapshot = await options.bootstrap.inventory();
        const receipt = snapshot.entries.find((entry) => entry.packageName === request.packageName);
        if (receipt === undefined || receipt.version !== request.version ||
          receipt.generation !== request.generation) {
          return unavailable(request.requestId, 'receipt-mismatch');
        }
        if (!(await options.confirm({
          packageName: receipt.packageName,
          version: receipt.version,
          installedAt: receipt.installedAt,
        }))) {
          return { requestId: request.requestId, status: 'cancelled' };
        }
        if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
        await options.bootstrap.prepareRemoval({
          packageName: receipt.packageName,
          version: receipt.version,
          generation: receipt.generation,
        });
        options.scheduleRestart();
        return { requestId: request.requestId, status: 'prepared', restartScheduled: true };
      } catch (error) {
        const mismatch = error instanceof Error && error.message.includes('receipt no longer matches');
        return unavailable(request.requestId, mismatch ? 'receipt-mismatch' : 'failed');
      } finally {
        active = false;
      }
    },
  });
}

function unavailable(
  requestId: string,
  reason: Extract<ManagedPluginRemoveResult, { status: 'unavailable' }>['reason'],
): ManagedPluginRemoveResult {
  return { requestId, status: 'unavailable', reason };
}
