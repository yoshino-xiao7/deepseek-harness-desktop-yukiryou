import { PET_MOTIONS, type PetMotion } from './pet-package.js';

export const PET_LAYERED_RIG_LIMITS = Object.freeze({
  assets: 64,
  nodes: 48,
  tracksPerMotion: 64,
  keyframesPerTrack: 96,
  canvasWidth: 192,
  canvasHeight: 208,
} as const);

export interface PetLayeredRigAsset {
  readonly id: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

export interface PetLayeredRigNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly assetId: string;
  readonly zIndex: number;
  readonly pivot: Readonly<{ x: number; y: number }>;
  readonly rest: PetLayeredRigTransform;
}

export interface PetLayeredRigTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly opacity: number;
}

export interface PetLayeredRigKeyframe {
  readonly timeMs: number;
  readonly transform: PetLayeredRigTransform;
  readonly easing: readonly [number, number, number, number];
}

export interface PetLayeredRigMotion {
  readonly durationMs: number;
  readonly loop: boolean;
  readonly tracks: readonly Readonly<{ nodeId: string; keyframes: readonly PetLayeredRigKeyframe[] }>[];
}

export interface PetLayeredRigManifest {
  readonly schemaVersion: 0;
  readonly renderer: 'canvas2d-layered-rig';
  readonly canvas: Readonly<{ width: 192; height: 208; baseline: number }>;
  readonly assets: readonly PetLayeredRigAsset[];
  readonly nodes: readonly PetLayeredRigNode[];
  readonly motions: Readonly<Record<PetMotion, PetLayeredRigMotion>>;
}

export function validatePetLayeredRigManifest(input: unknown): PetLayeredRigManifest | undefined {
  if (!record(input) || !exact(input, ['schemaVersion', 'renderer', 'canvas', 'assets', 'nodes', 'motions'])) return undefined;
  if (input.schemaVersion !== 0 || input.renderer !== 'canvas2d-layered-rig') return undefined;
  if (!record(input.canvas) || !exact(input.canvas, ['width', 'height', 'baseline'])) return undefined;
  if (
    input.canvas.width !== PET_LAYERED_RIG_LIMITS.canvasWidth
    || input.canvas.height !== PET_LAYERED_RIG_LIMITS.canvasHeight
    || !integer(input.canvas.baseline, 1, PET_LAYERED_RIG_LIMITS.canvasHeight)
  ) return undefined;
  if (!Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > PET_LAYERED_RIG_LIMITS.assets) return undefined;
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > PET_LAYERED_RIG_LIMITS.nodes) return undefined;
  const assets = new Set<string>();
  for (const asset of input.assets) {
    if (!record(asset) || !exact(asset, ['id', 'path', 'width', 'height']) || !safeId(asset.id) || assets.has(asset.id)) return undefined;
    if (!safeAssetPath(asset.path) || !integer(asset.width, 1, 2048) || !integer(asset.height, 1, 2048)) return undefined;
    assets.add(asset.id);
  }
  const nodes = new Map<string, string | null>();
  for (const node of input.nodes) {
    if (!record(node) || !exact(node, ['id', 'parentId', 'assetId', 'zIndex', 'pivot', 'rest'])) return undefined;
    if (!safeId(node.id) || nodes.has(node.id) || !assets.has(String(node.assetId))) return undefined;
    if (node.parentId !== null && !safeId(node.parentId)) return undefined;
    if (!integer(node.zIndex, -128, 128) || !point(node.pivot) || !transform(node.rest)) return undefined;
    nodes.set(node.id, node.parentId);
  }
  if (![...nodes.values()].some((parent) => parent === null) || hasParentCycle(nodes)) return undefined;
  if ([...nodes.values()].some((parent) => parent !== null && !nodes.has(parent))) return undefined;
  if (!record(input.motions) || !exact(input.motions, PET_MOTIONS)) return undefined;
  for (const motion of PET_MOTIONS) if (!validMotion(input.motions[motion], nodes)) return undefined;
  return input as unknown as PetLayeredRigManifest;
}

function validMotion(input: unknown, nodes: ReadonlyMap<string, string | null>): input is PetLayeredRigMotion {
  if (!record(input) || !exact(input, ['durationMs', 'loop', 'tracks'])) return false;
  if (!integer(input.durationMs, 100, 60_000) || typeof input.loop !== 'boolean' || !Array.isArray(input.tracks)) return false;
  if (input.tracks.length < 1 || input.tracks.length > PET_LAYERED_RIG_LIMITS.tracksPerMotion) return false;
  const tracked = new Set<string>();
  for (const track of input.tracks) {
    if (!record(track) || !exact(track, ['nodeId', 'keyframes']) || !nodes.has(String(track.nodeId)) || tracked.has(String(track.nodeId))) return false;
    if (!Array.isArray(track.keyframes) || track.keyframes.length < 2 || track.keyframes.length > PET_LAYERED_RIG_LIMITS.keyframesPerTrack) return false;
    tracked.add(String(track.nodeId));
    let previous = -1;
    for (const keyframe of track.keyframes) {
      if (!record(keyframe) || !exact(keyframe, ['timeMs', 'transform', 'easing'])) return false;
      if (!integer(keyframe.timeMs, 0, input.durationMs as number) || (keyframe.timeMs as number) <= previous) return false;
      if (!transform(keyframe.transform) || !easing(keyframe.easing)) return false;
      previous = keyframe.timeMs as number;
    }
    if (track.keyframes[0]?.timeMs !== 0 || track.keyframes.at(-1)?.timeMs !== input.durationMs) return false;
  }
  return true;
}

function transform(input: unknown): input is PetLayeredRigTransform {
  return record(input) && exact(input, ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'])
    && finite(input.x, -512, 512) && finite(input.y, -512, 512)
    && finite(input.rotation, -Math.PI * 4, Math.PI * 4)
    && finite(input.scaleX, -4, 4) && finite(input.scaleY, -4, 4)
    && finite(input.opacity, 0, 1);
}

function point(input: unknown): boolean {
  return record(input) && exact(input, ['x', 'y']) && finite(input.x, 0, 1) && finite(input.y, 0, 1);
}

function easing(input: unknown): boolean {
  return Array.isArray(input) && input.length === 4 && input.every((value) => finite(value, -2, 2));
}

function hasParentCycle(nodes: ReadonlyMap<string, string | null>): boolean {
  for (const id of nodes.keys()) {
    const visited = new Set<string>();
    let current: string | null | undefined = id;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = nodes.get(current);
    }
  }
  return false;
}

function safeAssetPath(value: unknown): boolean {
  return typeof value === 'string' && /^parts\/[a-z0-9][a-z0-9._-]{0,63}\.(png|webp)$/.test(value);
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
