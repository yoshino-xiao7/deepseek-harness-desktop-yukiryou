import type { PetMotion } from '../../shared/pet-package.js';
import { parsePetFrameSequenceBundle, type PetFrameSequenceMotionAsset } from '../../shared/pet-frame-sequence-bundle.js';
import type {
  PetRuntimeAdapter,
  PetRuntimeLoadResult,
  PetRuntimePresentation,
  PetRuntimePresentResult,
} from './rive-canvas-lite-adapter.js';

export interface DecodedPetAtlas {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface FrameSequenceCanvasRuntime {
  decode(mediaType: 'image/png' | 'image/webp', bytes: ArrayBuffer): Promise<DecodedPetAtlas>;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

export function createBrowserFrameSequenceCanvasRuntime(): FrameSequenceCanvasRuntime {
  return {
    async decode(mediaType, bytes): Promise<DecodedPetAtlas> {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }));
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

export function createFrameSequenceCanvas2dAdapter(runtime: FrameSequenceCanvasRuntime): PetRuntimeAdapter {
  let bundle: ReturnType<typeof parsePetFrameSequenceBundle>;
  let active: { readonly motion: PetMotion; readonly metadata: PetFrameSequenceMotionAsset; readonly atlas: DecodedPetAtlas } | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | undefined;
  let frameHandle: number | undefined;
  let requestedMotion: PetMotion = 'standing';
  let motionStartedAt: number | undefined;
  let visible = false;
  let reducedMotion = false;
  let disposed = false;
  let loadGeneration = 0;
  let switchGeneration = 0;

  return {
    async load(input): Promise<PetRuntimeLoadResult> {
      if (disposed) return { status: 'rejected', code: 'runtime-unavailable' };
      const generation = ++loadGeneration;
      switchGeneration += 1;
      stopRendering();
      active?.atlas.close();
      active = undefined;
      bundle = undefined;
      const parsed = parsePetFrameSequenceBundle(input.assetBytes);
      const nextContext = input.canvas.getContext('2d', { alpha: true });
      if (parsed === undefined || nextContext === null) return { status: 'rejected', code: 'asset-incompatible' };
      let standing: DecodedPetAtlas | undefined;
      try {
        const metadata = parsed.motions.standing;
        standing = await runtime.decode(metadata.mediaType, metadata.bytes);
        if (standing.width !== metadata.width || standing.height !== metadata.height) {
          standing.close();
          standing = undefined;
          throw new Error('decoded atlas dimensions mismatch');
        }
      } catch {
        standing?.close();
        return { status: 'rejected', code: 'asset-incompatible' };
      }
      if (disposed || generation !== loadGeneration) {
        standing?.close();
        return { status: 'rejected', code: 'asset-incompatible' };
      }
      if (standing === undefined) return { status: 'rejected', code: 'asset-incompatible' };
      canvas = input.canvas;
      context = nextContext;
      bundle = parsed;
      active = { motion: 'standing', metadata: parsed.motions.standing, atlas: standing };
      requestedMotion = 'standing';
      motionStartedAt = undefined;
      return { status: 'ready' };
    },
    present(input: PetRuntimePresentation): PetRuntimePresentResult {
      if (active === undefined || bundle === undefined || canvas === undefined || context === undefined || disposed || !safePresentation(input)) {
        return { status: 'not-ready' };
      }
      resizeCanvas(canvas, context, input.viewport);
      visible = input.visible;
      reducedMotion = input.reducedMotion;
      if (!input.visible) {
        stopRendering();
        return { status: 'presented' };
      }
      if (input.reducedMotion) {
        stopRendering();
        requestMotion('standing');
        if (active.motion === 'standing') drawFrame(0);
        return { status: 'presented' };
      }
      requestMotion(input.state);
      startRendering();
      return { status: 'presented' };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loadGeneration += 1;
      switchGeneration += 1;
      stopRendering();
      active?.atlas.close();
      active = undefined;
      bundle = undefined;
      canvas = undefined;
      context = undefined;
    },
  };

  function startRendering(): void {
    if (frameHandle !== undefined) return;
    frameHandle = runtime.requestFrame(tick);
  }

  function stopRendering(): void {
    if (frameHandle !== undefined) runtime.cancelFrame(frameHandle);
    frameHandle = undefined;
    motionStartedAt = undefined;
  }

  function tick(timestamp: number): void {
    frameHandle = undefined;
    const entry = active;
    if (entry === undefined || disposed) return;
    motionStartedAt ??= timestamp;
    const elapsed = Math.max(0, timestamp - motionStartedAt);
    const frame = Math.floor((elapsed % entry.metadata.durationMs) / entry.metadata.durationMs * entry.metadata.frameCount);
    drawFrame(frame);
    frameHandle = runtime.requestFrame(tick);
  }

  function drawFrame(frame: number): void {
    const entry = active;
    if (entry === undefined || canvas === undefined || context === undefined) return;
    const { metadata, atlas } = entry;
    const sourceWidth = metadata.width / metadata.columns;
    const sourceHeight = metadata.height / metadata.rows;
    const sourceX = frame % metadata.columns * sourceWidth;
    const sourceY = Math.floor(frame / metadata.columns) * sourceHeight;
    const logicalWidth = canvas.width / currentScale(context);
    const logicalHeight = canvas.height / currentScale(context);
    const scale = Math.min(logicalWidth / sourceWidth, logicalHeight / sourceHeight);
    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;
    const targetX = (logicalWidth - targetWidth) / 2;
    const targetY = logicalHeight - targetHeight;
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    context.drawImage(atlas.source, sourceX, sourceY, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight);
  }

  function requestMotion(motion: PetMotion): void {
    requestedMotion = motion;
    if (active?.motion === motion || bundle === undefined) return;
    const generation = ++switchGeneration;
    const metadata = bundle.motions[motion];
    void runtime.decode(metadata.mediaType, metadata.bytes).then((atlas) => {
      if (atlas.width !== metadata.width || atlas.height !== metadata.height) {
        atlas.close();
        return;
      }
      if (disposed || generation !== switchGeneration || requestedMotion !== motion) {
        atlas.close();
        return;
      }
      stopRendering();
      active?.atlas.close();
      active = { motion, metadata, atlas };
      motionStartedAt = undefined;
      if (!visible) return;
      if (reducedMotion) drawFrame(0);
      else startRendering();
    }).catch(() => undefined);
  }
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  viewport: PetRuntimePresentation['viewport'],
): void {
  const pixelWidth = Math.max(1, Math.round(viewport.width * viewport.devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(viewport.height * viewport.devicePixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(viewport.devicePixelRatio, 0, 0, viewport.devicePixelRatio, 0, 0);
}

function currentScale(context: CanvasRenderingContext2D): number {
  const scale = context.getTransform().a;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function safePresentation(input: PetRuntimePresentation): boolean {
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
