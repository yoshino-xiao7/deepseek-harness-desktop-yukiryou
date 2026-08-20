import fs from 'node:fs/promises';
import path from 'node:path';

const inputPaths = process.argv.slice(2);
const outputPath = inputPaths.at(-1);
const evidencePaths = inputPaths.slice(0, -1);
if (evidencePaths.length === 0 || !outputPath) {
  throw new Error('usage: build-yukiryou-layered-rig.mjs <extraction.json> [...] <rig.json>');
}
const evidence = await Promise.all(evidencePaths.map(async (evidencePath) => JSON.parse(await fs.readFile(evidencePath, 'utf8'))));
const dimensions = new Map(evidence.flatMap((entry) => entry.parts).map((part) => [part.id, part]));
if (!dimensions.has('head-sleeping')) throw new Error('head-sleeping extraction is required');
const sleepingHeadScaleRatio = dimensions.get('head').width / dimensions.get('head-sleeping').width;

const rest = {
  'back-hair': t(96, 78, 0, 0.24),
  tail: t(151, 198, -0.12, 0.23),
  'left-leg': t(72, 204, 0, 0.28),
  'right-leg': t(120, 204, 0, 0.28),
  'torso-dress': t(96, 175, 0, 0.26),
  'left-forearm': t(69, 124, -0.2, 0.25),
  'right-forearm': t(123, 124, 0.2, 0.25),
  head: t(96, 69, 0, 0.25),
  'head-sleeping': t(96, 69, 0, 0.25 * sleepingHeadScaleRatio, 0),
  'left-ear': t(48, 67, -0.05, 0.22),
  'right-ear': t(144, 67, 0.05, 0.22),
  ahoge: t(96, 20, 0, 0.23),
};

const z = ['back-hair', 'tail', 'left-leg', 'right-leg', 'torso-dress', 'left-forearm', 'right-forearm', 'head', 'head-sleeping', 'left-ear', 'right-ear', 'ahoge'];
const pivots = {
  'back-hair': { x: 0.5, y: 0.22 }, tail: { x: 0.5, y: 0.92 },
  'left-leg': { x: 0.5, y: 1 }, 'right-leg': { x: 0.5, y: 1 },
  'torso-dress': { x: 0.5, y: 1 }, 'left-forearm': { x: 0.55, y: 0.12 },
  'right-forearm': { x: 0.45, y: 0.12 }, head: { x: 0.5, y: 0.55 },
  'head-sleeping': { x: 0.5, y: 0.55 },
  'left-ear': { x: 0.85, y: 0.5 }, 'right-ear': { x: 0.15, y: 0.5 }, ahoge: { x: 0.5, y: 0.9 },
};

const standingMid = pose({
  head: { y: 70 }, 'torso-dress': { scaleY: 0.257 }, 'back-hair': { rotation: 0.018 },
  tail: { rotation: -0.08 }, ahoge: { rotation: -0.035 },
});
const sleepy = pose({
  head: { y: 74, rotation: 0.09 }, 'torso-dress': { y: 177, rotation: 0.025 },
  'left-forearm': { x: 65, y: 136, rotation: -0.55 }, 'right-forearm': { x: 127, y: 136, rotation: 0.55 },
  'back-hair': { y: 84, rotation: 0.04 }, tail: { y: 200, rotation: -0.02 }, ahoge: { x: 99, y: 26, rotation: 0.12 },
});
const sleepyClosed = withClosedEyes(sleepy);
const lying = pose({
  'back-hair': { x: 94, y: 154, rotation: -1.32, scaleX: 0.2, scaleY: 0.2 }, tail: { x: 157, y: 197, rotation: -0.82, scaleX: 0.19, scaleY: 0.19 },
  'left-leg': { x: 130, y: 196, rotation: -1.28, scaleX: 0.24, scaleY: 0.24 }, 'right-leg': { x: 151, y: 195, rotation: -1.2, scaleX: 0.24, scaleY: 0.24 },
  'torso-dress': { x: 112, y: 181, rotation: -1.32, scaleX: 0.21, scaleY: 0.21 }, 'left-forearm': { x: 82, y: 164, rotation: -1.42, scaleX: 0.22, scaleY: 0.22 },
  'right-forearm': { x: 99, y: 158, rotation: -1.13, scaleX: 0.22, scaleY: 0.22 }, head: { x: 61, y: 157, rotation: -1.18, scaleX: 0.21, scaleY: 0.21 },
  'left-ear': { x: 40, y: 160, rotation: -1.2, scaleX: 0.19, scaleY: 0.19 }, 'right-ear': { x: 75, y: 139, rotation: -1.05, scaleX: 0.19, scaleY: 0.19 }, ahoge: { x: 35, y: 135, rotation: -1.15, scaleX: 0.2, scaleY: 0.2 },
});
const lyingClosed = withClosedEyes(lying);
const sitting = pose({
  head: { y: 79 }, 'back-hair': { y: 88 }, 'torso-dress': { y: 183, scaleX: 0.27, scaleY: 0.24 },
  'left-leg': { x: 79, y: 205, rotation: -0.12, scaleX: 0.27, scaleY: 0.2 }, 'right-leg': { x: 113, y: 205, rotation: 0.12, scaleX: 0.27, scaleY: 0.2 },
  'left-forearm': { x: 75, y: 140, rotation: -0.72 }, 'right-forearm': { x: 117, y: 140, rotation: 0.72 },
  tail: { y: 201, rotation: -0.03 }, 'left-ear': { y: 78 }, 'right-ear': { y: 78 }, ahoge: { y: 30 },
});
const eatingUp = override(sitting, {
  head: { y: 76, rotation: -0.035 }, 'torso-dress': { y: 180 },
  'left-forearm': { x: 80, y: 122, rotation: -1.25 }, 'right-forearm': { x: 112, y: 122, rotation: 1.25 },
  tail: { rotation: 0.08 }, ahoge: { rotation: -0.12 },
});
const standingBlink = withClosedEyes(rest);

const motions = {
  standing: motion(6_000, true, [
    key(0, rest), key(2_500, standingMid), key(4_300, rest),
    key(4_360, standingBlink), key(4_480, standingBlink), key(4_540, rest), key(6_000, rest),
  ]),
  drowsy: motion(1_800, false, [key(0, rest), key(1_050, standingMid), key(1_800, sleepyClosed)]),
  'lying-down': motion(1_900, false, [key(0, sleepyClosed), key(950, withClosedEyes(pose({ head: { y: 111, rotation: 0.28 }, 'torso-dress': { y: 193, rotation: -0.34 } }))), key(1_900, lyingClosed)]),
  sleeping: motion(3_200, true, [key(0, lyingClosed), key(1_600, withClosedEyes(override(lying, { head: { y: 159 }, tail: { rotation: -0.77 } }))), key(3_200, lyingClosed)]),
  waking: motion(2_100, false, [key(0, lyingClosed), key(1_150, sleepyClosed), key(1_550, sleepy), key(2_100, rest)]),
  'rubbing-eyes': motion(1_500, false, [key(0, sleepyClosed), key(750, withClosedEyes(pose({ head: { y: 72 }, 'left-forearm': { x: 76, y: 89, rotation: -1.65 }, 'right-forearm': { x: 116, y: 89, rotation: 1.65 } }))), key(1_500, rest)]),
  'work-enter': motion(1_000, false, [key(0, rest), key(1_000, sitting)]),
  eating: motion(800, true, [key(0, sitting), key(400, eatingUp), key(800, sitting)]),
  'work-exit': motion(1_000, false, [key(0, sitting), key(1_000, rest)]),
};

const manifest = {
  schemaVersion: 0,
  renderer: 'canvas2d-layered-rig',
  canvas: { width: 192, height: 208, baseline: 204 },
  assets: z.map((id) => ({ id, path: `parts/${id}.png`, width: dimensions.get(id).width, height: dimensions.get(id).height })),
  nodes: z.map((id, index) => ({ id, parentId: null, assetId: id, zIndex: index, pivot: pivots[id], rest: rest[id] })),
  motions,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

function t(x, y, rotation, scale, opacity = 1) {
  return { x, y, rotation, scaleX: scale, scaleY: scale, opacity };
}

function pose(changes) { return override(rest, changes); }

function override(base, changes) {
  return Object.fromEntries(Object.entries(base).map(([id, value]) => [id, { ...value, ...(changes[id] ?? {}) }]));
}

function withClosedEyes(base) {
  const head = base.head;
  return override(base, {
    head: { opacity: 0 },
    'head-sleeping': {
      x: head.x,
      y: head.y,
      rotation: head.rotation,
      scaleX: head.scaleX * sleepingHeadScaleRatio,
      scaleY: head.scaleY * sleepingHeadScaleRatio,
      opacity: 1,
    },
  });
}

function key(timeMs, transforms) { return { timeMs, transforms }; }

function motion(durationMs, loop, keys) {
  return {
    durationMs,
    loop,
    tracks: z.map((nodeId) => ({
      nodeId,
      keyframes: keys.map(({ timeMs, transforms }) => ({ timeMs, transform: transforms[nodeId], easing: [0.42, 0, 0.58, 1] })),
    })),
  };
}
