# QA and packaging

Apply these gates to the exact bytes that will be packaged.

## Independent visual QA

- Identity consistency: at least 95/100 against the immutable primary and supplemental references.
- Transparent edges: pass; no chroma fringe, opaque panel, detached noise, or accidental transparent holes.
- Stage bounds: pass with visible safety margin throughout every frame.
- Transition continuity: pass for every adjacent frame, every loop seam, and the state endpoints defined in `motion-contract.md`.
- Registration: no unintended center, scale, or baseline jump.
- Temporal density: the objective QA requires meaningful adjacent-frame changes for at least 15% of standing/sleeping, 65% of eating, and 70% of each transition. Sparse poses repeated to reach the required frame count fail. A loop may legitimately revisit earlier poses in reverse or cyclic order; global hash uniqueness is therefore not used as a false quality proxy.

Inspect normal-size previews, not only enlarged stills. Review hair, face, hands, props, feet, clothing, and tail for local deformation errors. A technically valid atlas can still fail visual QA.

## Creator Gate evidence

The evidence must bind the Creator Input hash and final package hash and must report:

```json
{
  "userProvidedEngineAsset": false,
  "proprietaryEditorRequired": false,
  "manualEditorSteps": 0,
  "extraProviderCredentialRequired": false
}
```

All nine motions report `generated: true` with the duration and frame count from the semantic contract. Missing, stale, self-issued, or hash-mismatched QA evidence fails closed.

## Package boundary

The only user-installable output is a declaration-only `.yukipet` archive accepted by the repository package preflight. It may contain:

- `pet.json`;
- a bounded PNG or WebP thumbnail;
- the single selected runtime's declarative animation payload;
- license/source metadata included in the manifest inventory.

It must not contain JavaScript, HTML, WASM, shaders, executable files, remote URLs, hosted assets, arbitrary callbacks, audio, symlinks, hardlinks, or files omitted from the hashed inventory.

After construction, run the same sequence used by the application:

1. `PetAuthoringWorkflow` Creator Gate;
2. `preflightPetPackage` archive and manifest validation;
3. isolated runtime validation and semantic replay.

Do not publish or install the package when any result is rejected or unavailable.

## Deliverables

Return:

- `<pet-id>.yukipet`;
- `contact-sheet.png`;
- one preview per semantic motion;
- `creator-evidence.json`;
- `qa-report.json` with tool/runtime versions and any reviewed warnings.

Do not include source reference images in the public package or diagnostic logs.
