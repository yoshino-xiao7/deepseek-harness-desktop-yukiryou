import { PET_MOTIONS } from './pet-package.js';
import type { PetLayeredRigManifest, PetLayeredRigTransform } from './pet-layered-rig.js';

const REST: PetLayeredRigTransform = Object.freeze({ x: 96, y: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });

export function validLayeredRigManifest(): PetLayeredRigManifest {
  const motion = {
    durationMs: 1_000,
    loop: true,
    tracks: [{
      nodeId: 'body',
      keyframes: [
        { timeMs: 0, transform: REST, easing: [0.42, 0, 0.58, 1] as const },
        { timeMs: 1_000, transform: { ...REST, y: 196 }, easing: [0.42, 0, 0.58, 1] as const },
      ],
    }],
  } as const;
  return {
    schemaVersion: 0,
    renderer: 'canvas2d-layered-rig',
    canvas: { width: 192, height: 208, baseline: 204 },
    assets: [{ id: 'body', path: 'parts/body.png', width: 64, height: 96 }],
    nodes: [{ id: 'body', parentId: null, assetId: 'body', zIndex: 0, pivot: { x: 0.5, y: 1 }, rest: REST }],
    motions: Object.fromEntries(PET_MOTIONS.map((name) => [name, motion])) as unknown as PetLayeredRigManifest['motions'],
  };
}
