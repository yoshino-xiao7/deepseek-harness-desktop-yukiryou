# Layered rig contract

Use the layered rig path for any motion that changes limb topology, silhouette, or posture materially. Optical flow remains an internal micro-motion tool for blink, breathing, hair-tip recoil, ear motion, and tail sway only.

The public user does not prepare layers or rig data. The authoring Module must:

1. derive a bounded set of transparent visual parts from the immutable reference and canonical look;
2. preserve each part's identity, overlap margin, and authoritative rest placement;
3. create one acyclic parent graph and normalized pivots;
4. author semantic motion tracks with cubic Bézier interpolation;
5. render and inspect the graph at elapsed-time 60Hz sampling before packaging.

The declaration-only schema is implemented and fail-closed in `src/shared/pet-layered-rig.ts`. Callers see only the existing `PetAuthoringAdapter` result and semantic `PetMotion`; they never handle part IDs, pivots, tracks, Canvas transforms, or easing curves.

Required invariants:

- exactly 192×208 logical canvas and a bounded baseline;
- at most 64 local PNG/WebP assets and 48 nodes;
- no scripts, HTML, WASM, shaders, URLs, callbacks, audio, or executable expressions;
- no parent cycles, missing assets, unsafe paths, duplicate IDs, unbounded transforms, or incomplete semantic motions;
- every track begins at 0ms and ends at the motion duration;
- rendering samples elapsed time rather than advancing one keyframe per display callback;
- state transitions preserve the preceding motion endpoint and the next motion entry pose.

The first official role may use a humanoid part layout, but the package contract remains generic so future users can create animals, objects, or other mascots without learning a fixed skeleton.
