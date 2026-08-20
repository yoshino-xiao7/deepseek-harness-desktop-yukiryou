import type { PetSemanticState } from '../../shared/pet-player-protocol.js';

export const RIVE_SPIKE_STATE_MACHINE = 'PetMachine';
export const RIVE_SPIKE_MOTION_INPUT = 'motion';

export const RIVE_SPIKE_MOTION_CODES = Object.freeze({
  standing: 0,
  drowsy: 1,
  'lying-down': 2,
  sleeping: 3,
  waking: 4,
  'rubbing-eyes': 5,
  'work-enter': 6,
  eating: 7,
  'work-exit': 8,
} satisfies Record<PetSemanticState, number>);

export interface RiveCanvasLiteInstance {
  setMotion(value: number): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  startRendering(): void;
  stopRendering(): void;
  drawFrame(): void;
  cleanup(): void;
}

export interface RiveCanvasLiteRuntime {
  prepare(): Promise<void>;
  create(input: {
    readonly canvas: HTMLCanvasElement;
    readonly assetBytes: ArrayBuffer;
  }): Promise<RiveCanvasLiteInstance>;
}

export interface PetRuntimePresentation {
  readonly state: PetSemanticState;
  readonly visible: boolean;
  readonly reducedMotion: boolean;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
}

export type PetRuntimeLoadResult =
  | { readonly status: 'ready' }
  | { readonly status: 'rejected'; readonly code: 'runtime-unavailable' | 'asset-incompatible' };

export type PetRuntimePresentResult =
  | { readonly status: 'presented' }
  | { readonly status: 'not-ready' };

export interface PetRuntimeAdapter {
  load(input: { readonly canvas: HTMLCanvasElement; readonly assetBytes: ArrayBuffer }): Promise<PetRuntimeLoadResult>;
  present(input: PetRuntimePresentation): PetRuntimePresentResult;
  dispose(): void;
}

export function createRiveCanvasLiteAdapter(runtime: RiveCanvasLiteRuntime): PetRuntimeAdapter {
  let active: RiveCanvasLiteInstance | undefined;
  let disposed = false;
  let loadGeneration = 0;

  return {
    async load(input): Promise<PetRuntimeLoadResult> {
      if (disposed) return { status: 'rejected', code: 'runtime-unavailable' };
      const generation = ++loadGeneration;
      active?.cleanup();
      active = undefined;
      try {
        await runtime.prepare();
      } catch {
        return { status: 'rejected', code: 'runtime-unavailable' };
      }
      try {
        const created = await runtime.create(input);
        if (disposed || generation !== loadGeneration) {
          created.cleanup();
          return { status: 'rejected', code: 'asset-incompatible' };
        }
        active = created;
        return { status: 'ready' };
      } catch {
        return { status: 'rejected', code: 'asset-incompatible' };
      }
    },
    present(input): PetRuntimePresentResult {
      if (active === undefined || disposed || !isSafePresentation(input)) return { status: 'not-ready' };
      const { width, height, devicePixelRatio } = input.viewport;
      active.resize(width, height, devicePixelRatio);
      if (!input.visible) {
        active.stopRendering();
        return { status: 'presented' };
      }
      if (input.reducedMotion) {
        active.stopRendering();
        active.setMotion(RIVE_SPIKE_MOTION_CODES.standing);
        active.drawFrame();
        return { status: 'presented' };
      }
      active.setMotion(RIVE_SPIKE_MOTION_CODES[input.state]);
      active.startRendering();
      return { status: 'presented' };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loadGeneration += 1;
      active?.cleanup();
      active = undefined;
    },
  };
}

function isSafePresentation(input: PetRuntimePresentation): boolean {
  return Number.isSafeInteger(input.viewport.width)
    && input.viewport.width >= 64
    && input.viewport.width <= 560
    && Number.isSafeInteger(input.viewport.height)
    && input.viewport.height >= 64
    && input.viewport.height <= 320
    && Number.isFinite(input.viewport.devicePixelRatio)
    && input.viewport.devicePixelRatio >= 0.5
    && input.viewport.devicePixelRatio <= 4;
}
