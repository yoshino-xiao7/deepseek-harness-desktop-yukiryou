import type { PetMotion } from './pet-package.js';
import {
  validatePetLayeredRigManifest,
  type PetLayeredRigKeyframe,
  type PetLayeredRigManifest,
  type PetLayeredRigTransform,
} from './pet-layered-rig.js';

export interface PetLayeredRigPose {
  readonly nodeId: string;
  readonly transform: PetLayeredRigTransform;
}

export interface PetLayeredRigTimeline {
  sample(motion: PetMotion, elapsedMs: number): readonly PetLayeredRigPose[];
}

export function createPetLayeredRigTimeline(input: unknown): PetLayeredRigTimeline | undefined {
  const manifest = validatePetLayeredRigManifest(input);
  return manifest === undefined ? undefined : new Timeline(manifest);
}

class Timeline implements PetLayeredRigTimeline {
  constructor(private readonly manifest: PetLayeredRigManifest) {}

  sample(motion: PetMotion, elapsedMs: number): readonly PetLayeredRigPose[] {
    if (!Number.isFinite(elapsedMs)) throw new Error('invalid pet timeline time');
    const definition = this.manifest.motions[motion];
    const timeMs = definition.loop
      ? modulo(elapsedMs, definition.durationMs)
      : Math.max(0, Math.min(definition.durationMs, elapsedMs));
    const tracks = new Map(definition.tracks.map((track) => [track.nodeId, track.keyframes]));
    return this.manifest.nodes.map((node) => ({
      nodeId: node.id,
      transform: tracks.has(node.id) ? sampleTrack(tracks.get(node.id)!, timeMs) : { ...node.rest },
    }));
  }
}

function sampleTrack(keyframes: readonly PetLayeredRigKeyframe[], timeMs: number): PetLayeredRigTransform {
  if (timeMs <= 0) return { ...keyframes[0]!.transform };
  if (timeMs >= keyframes.at(-1)!.timeMs) return { ...keyframes.at(-1)!.transform };
  const rightIndex = keyframes.findIndex((keyframe) => keyframe.timeMs >= timeMs);
  const left = keyframes[rightIndex - 1]!;
  const right = keyframes[rightIndex]!;
  const linear = (timeMs - left.timeMs) / (right.timeMs - left.timeMs);
  const amount = cubicBezierProgress(linear, left.easing);
  return {
    x: mix(left.transform.x, right.transform.x, amount),
    y: mix(left.transform.y, right.transform.y, amount),
    rotation: mix(left.transform.rotation, right.transform.rotation, amount),
    scaleX: mix(left.transform.scaleX, right.transform.scaleX, amount),
    scaleY: mix(left.transform.scaleY, right.transform.scaleY, amount),
    opacity: mix(left.transform.opacity, right.transform.opacity, amount),
  };
}

function cubicBezierProgress(progress: number, easing: readonly [number, number, number, number]): number {
  const [x1, y1, x2, y2] = easing;
  let lower = 0;
  let upper = 1;
  let parameter = progress;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const x = bezier(parameter, x1, x2);
    if (Math.abs(x - progress) < 1e-6) break;
    if (x < progress) lower = parameter;
    else upper = parameter;
    parameter = (lower + upper) / 2;
  }
  return bezier(parameter, y1, y2);
}

function bezier(parameter: number, first: number, second: number): number {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * first
    + 3 * inverse * parameter * parameter * second
    + parameter * parameter * parameter;
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
