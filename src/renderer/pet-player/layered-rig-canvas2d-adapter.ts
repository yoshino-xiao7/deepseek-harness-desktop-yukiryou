import { parsePetLayeredRigBundle } from '../../shared/pet-layered-rig-bundle.js';
import { createPetLayeredRigTimeline } from '../../shared/pet-layered-rig-timeline.js';
import type { PetLayeredRigManifest, PetLayeredRigTransform } from '../../shared/pet-layered-rig.js';
import type { PetMotion } from '../../shared/pet-package.js';
import type {
  PetRuntimeAdapter,
  PetRuntimeLoadResult,
  PetRuntimePresentation,
  PetRuntimePresentResult,
} from './rive-canvas-lite-adapter.js';

export interface DecodedPetRigPart {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface LayeredRigCanvasRuntime {
  decode(mediaType: 'image/png' | 'image/webp', bytes: ArrayBuffer): Promise<DecodedPetRigPart>;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

export function createBrowserLayeredRigCanvasRuntime(): LayeredRigCanvasRuntime {
  return {
    async decode(mediaType, bytes): Promise<DecodedPetRigPart> {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }));
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

export function createLayeredRigCanvas2dAdapter(runtime: LayeredRigCanvasRuntime): PetRuntimeAdapter {
  let manifest: PetLayeredRigManifest | undefined;
  let parts: ReadonlyMap<string, DecodedPetRigPart> | undefined;
  let timeline: ReturnType<typeof createPetLayeredRigTimeline>;
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | undefined;
  let frameHandle: number | undefined;
  let motion: PetMotion = 'standing';
  let motionStartedAt: number | undefined;
  let disposed = false;
  let loadGeneration = 0;

  return {
    async load(input): Promise<PetRuntimeLoadResult> {
      if (disposed) return { status: 'rejected', code: 'runtime-unavailable' };
      const generation = ++loadGeneration;
      stopRendering();
      cleanup(parts);
      manifest = undefined;
      parts = undefined;
      timeline = undefined;
      const parsed = parsePetLayeredRigBundle(input.assetBytes);
      const nextContext = input.canvas.getContext('2d', { alpha: true });
      if (parsed === undefined || nextContext === null) return { status: 'rejected', code: 'asset-incompatible' };
      const nextTimeline = createPetLayeredRigTimeline(parsed.manifest);
      if (nextTimeline === undefined) return { status: 'rejected', code: 'asset-incompatible' };
      const decoded = new Map<string, DecodedPetRigPart>();
      try {
        for (const definition of parsed.manifest.assets) {
          const encoded = parsed.assets.get(definition.id)!;
          const part = await runtime.decode(encoded.mediaType, encoded.bytes);
          if (part.width !== definition.width || part.height !== definition.height) {
            part.close();
            throw new Error('decoded rig part dimensions mismatch');
          }
          decoded.set(definition.id, part);
        }
      } catch {
        cleanup(decoded);
        return { status: 'rejected', code: 'asset-incompatible' };
      }
      if (disposed || generation !== loadGeneration) {
        cleanup(decoded);
        return { status: 'rejected', code: 'asset-incompatible' };
      }
      manifest = parsed.manifest;
      parts = decoded;
      timeline = nextTimeline;
      canvas = input.canvas;
      context = nextContext;
      motion = 'standing';
      motionStartedAt = undefined;
      return { status: 'ready' };
    },
    present(input: PetRuntimePresentation): PetRuntimePresentResult {
      if (manifest === undefined || parts === undefined || timeline === undefined || canvas === undefined || context === undefined || disposed || !safePresentation(input)) {
        return { status: 'not-ready' };
      }
      resize(canvas, context, input.viewport);
      if (!input.visible) {
        stopRendering();
        return { status: 'presented' };
      }
      if (input.reducedMotion) {
        stopRendering();
        motion = 'standing';
        draw(0);
        return { status: 'presented' };
      }
      if (motion !== input.state) {
        motion = input.state;
        motionStartedAt = undefined;
      }
      startRendering();
      return { status: 'presented' };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loadGeneration += 1;
      stopRendering();
      cleanup(parts);
      manifest = undefined;
      parts = undefined;
      timeline = undefined;
      canvas = undefined;
      context = undefined;
    },
  };

  function startRendering(): void {
    if (frameHandle === undefined) frameHandle = runtime.requestFrame(tick);
  }

  function stopRendering(): void {
    if (frameHandle !== undefined) runtime.cancelFrame(frameHandle);
    frameHandle = undefined;
    motionStartedAt = undefined;
  }

  function tick(timestamp: number): void {
    frameHandle = undefined;
    if (disposed || timeline === undefined) return;
    motionStartedAt ??= timestamp;
    draw(Math.max(0, timestamp - motionStartedAt));
    frameHandle = runtime.requestFrame(tick);
  }

  function draw(elapsedMs: number): void {
    if (manifest === undefined || parts === undefined || timeline === undefined || canvas === undefined || context === undefined) return;
    const poses = new Map(timeline.sample(motion, elapsedMs).map((pose) => [pose.nodeId, pose.transform]));
    const logicalWidth = canvas.width / currentScale(context);
    const logicalHeight = canvas.height / currentScale(context);
    const fit = Math.min(logicalWidth / manifest.canvas.width, logicalHeight / manifest.canvas.height);
    const offsetX = (logicalWidth - manifest.canvas.width * fit) / 2;
    const offsetY = logicalHeight - manifest.canvas.height * fit;
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    const world = resolveWorldTransforms(manifest, poses);
    for (const node of [...manifest.nodes].sort((left, right) => left.zIndex - right.zIndex)) {
      const part = parts.get(node.assetId)!;
      const transform = world.get(node.id)!;
      context.save();
      context.translate(offsetX, offsetY);
      context.scale(fit, fit);
      context.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
      context.globalAlpha *= transform.opacity;
      context.drawImage(part.source, -node.pivot.x * part.width, -node.pivot.y * part.height, part.width, part.height);
      context.restore();
    }
  }
}

interface WorldTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
  readonly opacity: number;
}

function resolveWorldTransforms(
  manifest: PetLayeredRigManifest,
  poses: ReadonlyMap<string, PetLayeredRigTransform>,
): ReadonlyMap<string, WorldTransform> {
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  const output = new Map<string, WorldTransform>();
  const resolve = (id: string): WorldTransform => {
    const cached = output.get(id);
    if (cached !== undefined) return cached;
    const node = nodes.get(id)!;
    const local = matrix(poses.get(id) ?? node.rest);
    const result = node.parentId === null ? local : multiply(resolve(node.parentId), local);
    output.set(id, result);
    return result;
  };
  for (const node of manifest.nodes) resolve(node.id);
  return output;
}

function matrix(value: PetLayeredRigTransform): WorldTransform {
  const cosine = Math.cos(value.rotation);
  const sine = Math.sin(value.rotation);
  return {
    a: cosine * value.scaleX,
    b: sine * value.scaleX,
    c: -sine * value.scaleY,
    d: cosine * value.scaleY,
    e: value.x,
    f: value.y,
    opacity: value.opacity,
  };
}

function multiply(parent: WorldTransform, child: WorldTransform): WorldTransform {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
    opacity: parent.opacity * child.opacity,
  };
}

function resize(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, viewport: PetRuntimePresentation['viewport']): void {
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

function cleanup(parts: ReadonlyMap<string, DecodedPetRigPart> | undefined): void {
  for (const part of parts?.values() ?? []) part.close();
}

function safePresentation(input: PetRuntimePresentation): boolean {
  return Number.isSafeInteger(input.viewport.width) && input.viewport.width >= 64 && input.viewport.width <= 560
    && Number.isSafeInteger(input.viewport.height) && input.viewport.height >= 64 && input.viewport.height <= 320
    && Number.isFinite(input.viewport.devicePixelRatio) && input.viewport.devicePixelRatio >= 0.5 && input.viewport.devicePixelRatio <= 4;
}
