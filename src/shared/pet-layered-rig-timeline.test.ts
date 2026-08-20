import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from './pet-package.js';
import { createPetLayeredRigTimeline } from './pet-layered-rig-timeline.js';

const start = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
const end = { x: 20, y: 10, rotation: 1, scaleX: 1.2, scaleY: 0.8, opacity: 0.5 };

function manifest() {
  return {
    schemaVersion: 0,
    renderer: 'canvas2d-layered-rig',
    canvas: { width: 192, height: 208, baseline: 204 },
    assets: [{ id: 'body', path: 'parts/body.png', width: 128, height: 192 }],
    nodes: [{ id: 'root', parentId: null, assetId: 'body', zIndex: 0, pivot: { x: 0.5, y: 1 }, rest: start }],
    motions: Object.fromEntries(PET_MOTIONS.map((motion) => [motion, {
      durationMs: 1_000,
      loop: motion === 'standing',
      tracks: [{
        nodeId: 'root',
        keyframes: [
          { timeMs: 0, transform: start, easing: [0, 0, 1, 1] },
          { timeMs: 1_000, transform: end, easing: [0, 0, 1, 1] },
        ],
      }],
    }])),
  };
}

describe('pet layered rig timeline', () => {
  it('samples continuous transforms by elapsed time rather than frame index', () => {
    const timeline = createPetLayeredRigTimeline(manifest())!;
    const quarter = timeline.sample('drowsy', 250)[0]!.transform;
    const midpoint = timeline.sample('drowsy', 500)[0]!.transform;
    expect(quarter.x).toBeCloseTo(5, 3);
    expect(quarter.y).toBeCloseTo(2.5, 3);
    expect(quarter.opacity).toBeCloseTo(0.875, 3);
    expect(midpoint.x).toBeCloseTo(10, 3);
    expect(midpoint.y).toBeCloseTo(5, 3);
    expect(midpoint.opacity).toBeCloseTo(0.75, 3);
  });

  it('wraps loops and clamps transition endpoints', () => {
    const timeline = createPetLayeredRigTimeline(manifest())!;
    expect(timeline.sample('standing', 1_250)[0]?.transform.x).toBeCloseTo(5);
    expect(timeline.sample('drowsy', 5_000)[0]?.transform).toEqual(end);
    expect(timeline.sample('drowsy', -20)[0]?.transform).toEqual(start);
  });

  it('fails closed before exposing a timeline interface', () => {
    expect(createPetLayeredRigTimeline({ renderer: 'canvas2d-layered-rig' })).toBeUndefined();
  });
});
