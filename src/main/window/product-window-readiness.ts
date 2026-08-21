import type { DesktopFrameHealth } from '../../shared/desktop-frame-health.js';
import type { DesktopCarrierMode } from './desktop-carrier-mode.js';
import type { TrustedHarnessOrigin } from './trusted-navigation.js';

export type ProductWindowState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading'; readonly origin: TrustedHarnessOrigin }
  | { readonly kind: 'ready'; readonly origin: TrustedHarnessOrigin }
  | { readonly kind: 'crashed'; readonly reason: string };

export interface ProductWindowReadiness {
  begin(origin: TrustedHarnessOrigin): ProductWindowState;
  documentLoaded(): ProductWindowState;
  acceptFrameHealth(health: DesktopFrameHealth): ProductWindowState;
  crash(reason: string): ProductWindowState;
  hide(): ProductWindowState;
  getSnapshot(): ProductWindowState;
}

export function createProductWindowReadiness(
  mode: DesktopCarrierMode,
): ProductWindowReadiness {
  let state: ProductWindowState = { kind: 'hidden' };
  let documentReady = false;
  let frameReady = false;

  const reconcile = (): ProductWindowState => {
    if (
      state.kind === 'loading' &&
      documentReady &&
      (mode === 'legacy' || frameReady)
    ) {
      state = { kind: 'ready', origin: state.origin };
    }
    return state;
  };

  return {
    begin(origin) {
      documentReady = false;
      frameReady = false;
      state = { kind: 'loading', origin };
      return state;
    },
    documentLoaded() {
      if (state.kind === 'loading') documentReady = true;
      return reconcile();
    },
    acceptFrameHealth(health) {
      if (state.kind !== 'loading') return state;
      if (health.status === 'incompatible') {
        state = { kind: 'crashed', reason: health.reason };
        return state;
      }
      frameReady = true;
      return reconcile();
    },
    crash(reason) {
      state = { kind: 'crashed', reason };
      return state;
    },
    hide() {
      documentReady = false;
      frameReady = false;
      state = { kind: 'hidden' };
      return state;
    },
    getSnapshot: () => state,
  };
}
