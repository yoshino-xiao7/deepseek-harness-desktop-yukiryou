import type {
  ManagedPluginSetEnabledRequest,
  ManagedPluginSetEnabledResult,
} from '../../shared/managed-plugin-inventory.js';
import type { PluginProfileBootstrap } from './plugin-profile-bootstrap.js';

interface ManagedPluginActivationOptions {
  readonly bootstrap: Pick<PluginProfileBootstrap, 'inventory' | 'prepareEnabled'>;
  readonly confirm: (summary: {
    readonly packageName: string;
    readonly version: string;
    readonly enabled: boolean;
  }) => Promise<boolean>;
  readonly runtimeAvailable: () => boolean;
  readonly scheduleRestart: () => void;
}

export interface ManagedPluginActivation {
  execute(request: ManagedPluginSetEnabledRequest): Promise<ManagedPluginSetEnabledResult>;
}

/** Owns exact-receipt revalidation, native confirmation, and enabled-state preparation. */
export function createManagedPluginActivation(
  options: ManagedPluginActivationOptions,
): ManagedPluginActivation {
  let active = false;
  return Object.freeze({
    async execute(
      request: ManagedPluginSetEnabledRequest,
    ): Promise<ManagedPluginSetEnabledResult> {
      if (active) return unavailable(request.requestId, 'busy');
      if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
      active = true;
      try {
        const snapshot = await options.bootstrap.inventory();
        const receipt = snapshot.entries.find((entry) => entry.packageName === request.packageName);
        if (receipt === undefined || receipt.version !== request.version ||
          receipt.generation !== request.generation || receipt.enabled === request.enabled) {
          return unavailable(request.requestId, 'receipt-mismatch');
        }
        if (!(await options.confirm({
          packageName: receipt.packageName,
          version: receipt.version,
          enabled: request.enabled,
        }))) {
          return { requestId: request.requestId, status: 'cancelled' };
        }
        if (!options.runtimeAvailable()) return unavailable(request.requestId, 'runtime-unavailable');
        const current = await options.bootstrap.inventory();
        const confirmedReceipt = current.entries.find(
          (entry) => entry.packageName === request.packageName,
        );
        if (confirmedReceipt === undefined || confirmedReceipt.version !== request.version ||
          confirmedReceipt.generation !== request.generation ||
          confirmedReceipt.enabled === request.enabled) {
          return unavailable(request.requestId, 'receipt-mismatch');
        }
        await options.bootstrap.prepareEnabled({
          packageName: request.packageName,
          version: request.version,
          generation: request.generation,
          enabled: request.enabled,
        });
        options.scheduleRestart();
        return { requestId: request.requestId, status: 'prepared', restartScheduled: true };
      } catch (error) {
        const mismatch = error instanceof Error &&
          (error.message.includes('receipt no longer matches') ||
            error.message.includes('enabled state already matches'));
        return unavailable(request.requestId, mismatch ? 'receipt-mismatch' : 'failed');
      } finally {
        active = false;
      }
    },
  });
}

function unavailable(
  requestId: string,
  reason: Extract<ManagedPluginSetEnabledResult, { status: 'unavailable' }>['reason'],
): ManagedPluginSetEnabledResult {
  return { requestId, status: 'unavailable', reason };
}
