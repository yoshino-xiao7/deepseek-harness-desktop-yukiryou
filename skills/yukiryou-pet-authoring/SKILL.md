---
name: yukiryou-pet-authoring
description: Create, repair, validate, and package DeepSeek YukiRyou .yukipet pets from character reference images and plain-language motion requests. Use for YukiRyou pet creation or conversion; do not use for Codex v2 pet.json/spritesheet packaging.
---

# YukiRyou Pet Authoring

Create a user-importable `.yukipet` without asking the user for an animation project, editor export, model-provider API key, or manual frame work. The user-facing input is one primary character reference, optional supplemental references, a display name, and a natural-language description.

This skill is the authoring interface. The repository's `PetAuthoringWorkflow`, package preflight, Creator Gate, and runtime validator remain authoritative. Never invent a second package format or weaken those gates to finish a run.

## Required capabilities

- Use the installed `imagegen` skill for visual generation. Prefer its host-provided path.
- Never ask the user to configure OpenAI, Runway, or another provider key. If host-provided image generation is unavailable, report `authoring-unavailable` and stop; do not route to a credentialed fallback.
- Use the workspace dependency runtime before running image-processing scripts.
- Keep source art and generated intermediates in the run directory. Only the validated `.yukipet`, previews, and QA report are deliverables.

## Inputs

Accept:

- exactly one primary PNG, JPEG, or WebP character reference;
- up to seven supplemental references when they clarify the face, clothing, hair, tail, props, side view, or sleeping pose;
- a display name;
- a natural-language request describing personality and desired motion character.

Infer omitted non-sensitive metadata. Do not ask for engine files, sprite atlases, layer separation, rigging, timelines, frame counts, or provider credentials.

## Workflow

1. Validate the Creator Input with the repository contract in `src/shared/pet-authoring.ts`. Hash the exact reference bytes and preserve one immutable canonical input set for the entire run.
2. Generate or select one canonical full-body look. It is the identity source of truth for every motion family. Do not approve a visually attractive variant that changes the character.
3. Read [the semantic motion contract](references/motion-contract.md). Generate each motion as a coherent family grounded in the canonical look and the transition endpoint that precedes it.
4. Build every motion from complete-character pose families. Apple Vision optical flow is allowed between sufficiently close poses that preserve local anatomy; large posture changes must first be divided into additional complete-character intermediate poses until every adjacent pair passes the silhouette and anatomy gate. Never cross-fade whole poses, assemble a visible character from detached body parts, or substitute a generic game-pet action row. Pose generation, extraction, registration and dense interpolation are internal agent work and must not be delegated to the user.
5. Run the independent checks in [QA and packaging](references/qa-and-packaging.md). Generation output cannot approve its own visual quality.
6. Submit the archive through `PetAuthoringWorkflow`, package preflight, and the isolated runtime validator. A run succeeds only when all three accept the same bytes.
7. Return the `.yukipet`, a contact sheet, per-motion previews, Creator Gate evidence, and a compact QA report. Keep the runtime candidate marked experimental until the product owner approves the official pet.

## Prepare a run

The agent creates a private request JSON; the user does not write it manually:

```json
{
  "schemaVersion": 1,
  "locale": "zh-CN",
  "displayName": "Pet name",
  "request": "Natural-language personality and motion request",
  "references": [
    { "id": "primary", "role": "primary", "path": "/absolute/path/to/character.png" }
  ]
}
```

Prepare a new run directory with:

```bash
pnpm pet:authoring:prepare \
  --request=/absolute/path/to/private-request.json \
  --output=/absolute/path/to/new-run-directory
```

The command validates image bytes, dimensions, limits, unique IDs, exactly one primary reference, and the formal Creator Input schema before writing anything. It copies the approved inputs into the private run, writes a dependency-ordered canonical-look plus nine-motion job graph, and creates versioned prompts. The request JSON and run directory are working data, never package contents.

After the agent has generated and normalized at least two coherent key poses for a motion, run:

```bash
pnpm pet:authoring:synthesize \
  --run=/absolute/path/to/run-directory \
  --motion=standing
```

The command builds or reuses the local platform toolchain, reads the formal frame count and loop behavior from `motion-contract.json`, synthesizes every dense micro-motion frame, writes `generated/atlases/<motion>.png`, and records `generated/<motion>.json`. It must not be used for a large pose change merely because it is available. The public user never runs this command, installs an editor, supplies a Key, or handles the key poses. If the selected local authoring path is unavailable, report `authoring-unavailable`; do not transfer toolchain setup to the user.

For an all-frame-sequence experiment where every motion passed the silhouette-preservation gate, prefer the resumable full run instead of asking the user to advance each motion:

```bash
pnpm pet:authoring:synthesize-all --run=/absolute/path/to/run-directory
```

It skips only motions whose versioned evidence and atlas already match the current contract. A partial failure remains resumable, but malformed or stale evidence is never treated as complete.

For a complete-character pose board, use `scripts/extract_pose_board.py` to split its regular grid and remove only the declared chroma background. Normalize the entire family with `scripts/normalize_pose_family.py` so every pose shares one scale and baseline; never fit each frame independently. Preserve dependency order and reject any board with clipping, identity drift, detached anatomy or an unrelated action. Increase semantic pose density around hands, knees, ground contact and posture changes before invoking dense synthesis. The first contact sheet is diagnostic evidence, not Creator Gate approval.

## Progress

Expose four user-facing stages and keep them monotonic:

1. `Getting <pet> ready.`
2. `Imagining <pet>'s main look.`
3. `Picturing <pet>'s motions.`
4. `Hatching <pet>.`

Report motion-level progress internally during stage 3. Cancellation or failure is terminal and must never be shown as a completed hatch.

## Non-negotiable failures

Stop without packaging when any of these occurs:

- an extra provider credential, billing account, proprietary editor, engine asset, or manual animation step is required;
- any semantic motion is absent or has the wrong endpoint relationship;
- character identity, face construction, clothing, palette, body proportions, or signature props drift materially;
- frames visibly pop, slide, resize, cross-fade as ghosts, leave the activity bounds, or expose a dirty matte;
- sparse frames are duplicated to satisfy a nominal frame count;
- package preflight, Creator Gate, or isolated runtime validation rejects the output.

Do not lower thresholds or silently substitute a Codex `pet.json`/spritesheet package. Preserve failed artifacts only when they help diagnose the next bounded repair.

## Repair scope

Repair the smallest failed motion family while preserving the canonical look and every passing motion. If the same identity or continuity failure repeats twice, stop varying prompts and change the motion construction strategy. Never patch a single final frame from an unrelated generation into an otherwise coherent family.
