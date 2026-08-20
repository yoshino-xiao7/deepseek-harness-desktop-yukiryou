# Semantic motion contract

`motion-contract.json` is the machine-readable source of truth. This document explains its semantics; repository tests fail when the JSON drifts from the application runtime contract.

The Player consumes nine semantic motions. All timelines are 60fps and remain inside a `1024×640` logical activity area with baseline `600`.

| Motion | Duration | Final frames | Loop | Required behavior |
| --- | ---: | ---: | --- | --- |
| `standing` | 4000ms | 240 | yes | Calm standing, restrained breathing, natural occasional blink. First and last frames form a clean loop. |
| `drowsy` | 2000ms | 120 | no | Gradually becomes tired while upright. Starts exactly from `standing`; ends ready to lie down. |
| `lying-down` | 2000ms | 120 | no | Lowers the whole body naturally. Starts from `drowsy`; ends in the sleeping pose. |
| `sleeping` | 3000ms | 180 | yes | Lies asleep with quiet breathing and subtle secondary motion. Loop endpoints match. |
| `waking` | 2000ms | 120 | no | Reacts to being disturbed and rises slowly from `sleeping`. |
| `rubbing-eyes` | 2000ms | 120 | no | Rubs the eyes sleepily, then returns exactly to the canonical `standing` endpoint. |
| `work-enter` | 1500ms | 90 | no | Moves from `standing` into the seated eating pose without a jump. |
| `eating` | 4000ms | 240 | yes | Energetic rapid eating while seated; preserves identity and stable placement. The application owns the “疯狂进食 token 中” bubble. |
| `work-exit` | 1500ms | 90 | no | Finishes eating and returns exactly to canonical `standing`. |

Total final-frame budget is 1320 frames. Final frames must be genuine temporal samples, not duplicated poses.

## State sequences

Idle sequence:

```text
standing → drowsy → lying-down → sleeping
sleeping → waking → rubbing-eyes → standing
```

Work sequence:

```text
standing → work-enter → eating → work-exit → standing
```

The application state machine chooses when to transition. The pet package supplies visuals only and cannot contain scripts, timers, network actions, speech bubbles, or host callbacks.

## Motion construction

- Keep feet/body baseline, practical character scale, and stage anchor stable unless the motion physically requires displacement.
- Hair, ears, clothing, tail, and loose props should follow the primary body motion with restrained overlap and follow-through.
- Generate complete coherent motion families. Individual frames from unrelated generations are not interchangeable.
- A pose strip may establish semantic anchors, but dense synthesis must preserve anatomy and produce continuous intermediate motion. Simple alpha cross-fades, affine whole-character tilts, or repeated frames do not qualify.
- Looping motions require visually compatible first and last poses plus continuous velocity near the seam.
- Non-loop transitions must preserve both endpoint identities so the state machine can switch without a visible jump.
