import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from './pet-package.js';
import { validatePetLayeredRigManifest } from './pet-layered-rig.js';

const transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

function manifest() {
  return {
    schemaVersion: 0,
    renderer: 'canvas2d-layered-rig',
    canvas: { width: 192, height: 208, baseline: 204 },
    assets: [
      { id: 'body', path: 'parts/body.png', width: 128, height: 192 },
      { id: 'tail', path: 'parts/tail.png', width: 96, height: 96 },
    ],
    nodes: [
      { id: 'root', parentId: null, assetId: 'body', zIndex: 0, pivot: { x: 0.5, y: 1 }, rest: transform },
      { id: 'tail', parentId: 'root', assetId: 'tail', zIndex: -1, pivot: { x: 0.2, y: 0.5 }, rest: transform },
    ],
    motions: Object.fromEntries(PET_MOTIONS.map((motion) => [motion, {
      durationMs: 1_000,
      loop: motion === 'standing' || motion === 'sleeping' || motion === 'eating',
      tracks: [{
        nodeId: 'root',
        keyframes: [
          { timeMs: 0, transform, easing: [0.25, 0.1, 0.25, 1] },
          { timeMs: 1_000, transform: { ...transform, y: 1 }, easing: [0.25, 0.1, 0.25, 1] },
        ],
      }],
    }])),
  };
}

describe('pet layered rig manifest', () => {
  it('accepts one bounded declarative graph with every semantic motion', () => {
    expect(validatePetLayeredRigManifest(manifest())).toMatchObject({ renderer: 'canvas2d-layered-rig' });
  });

  it('rejects cycles, unsafe assets, and incomplete motion maps', () => {
    const cycle = manifest();
    cycle.nodes[0]!.parentId = 'tail';
    expect(validatePetLayeredRigManifest(cycle)).toBeUndefined();

    const unsafe = manifest();
    unsafe.assets[0]!.path = '../body.png';
    expect(validatePetLayeredRigManifest(unsafe)).toBeUndefined();

    const incomplete = manifest();
    delete (incomplete.motions as Partial<typeof incomplete.motions>).drowsy;
    expect(validatePetLayeredRigManifest(incomplete)).toBeUndefined();
  });
});
