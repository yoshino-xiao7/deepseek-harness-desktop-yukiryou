import type { DraftPetPackageSummary, PetPackagePreflightResult } from '../../shared/pet-package.js';
import {
  prepareFrameSequenceRuntimeCandidate,
  prepareLayeredRigRuntimeCandidate,
  prepareRiveRuntimeCandidate,
  type FrameSequenceRuntimeCandidateResult,
  type LayeredRigRuntimeCandidateResult,
  type RiveRuntimeCandidateResult,
} from './pet-package-preflight.js';

export interface PetRuntimeProbe {
  validate(candidate: PetPlayerAssetCandidate): Promise<'compatible' | 'incompatible'>;
  dispose(): void;
}

export interface PetPlayerAssetCandidate {
  readonly runtime: 'rive-canvas-lite' | 'frame-sequence-canvas2d' | 'layered-rig-canvas2d';
  readonly assetSha256: string;
  readonly assetBytes: ArrayBuffer;
}

export type PetRuntimeValidationResult =
  | {
    readonly status: 'accepted';
    readonly package: DraftPetPackageSummary;
    readonly playerAsset: PetPlayerAssetCandidate;
  }
  | Extract<PetPackagePreflightResult, { status: 'rejected' }>
  | Extract<RiveRuntimeCandidateResult, { status: 'rejected'; code: 'pet-runtime-incompatible' }>
  | Extract<FrameSequenceRuntimeCandidateResult, { status: 'rejected'; code: 'pet-runtime-incompatible' }>
  | Extract<LayeredRigRuntimeCandidateResult, { status: 'rejected'; code: 'pet-runtime-incompatible' }>
  | {
    readonly status: 'rejected';
    readonly code: 'pet-player-unavailable';
    readonly reason: 'probe-incompatible' | 'probe-failed' | 'probe-timeout';
    readonly package: DraftPetPackageSummary;
  };

export interface PetRuntimeValidator {
  validate(archive: Uint8Array): Promise<PetRuntimeValidationResult>;
}

export function createPetRuntimeValidator(options: {
  readonly createProbe: () => PetRuntimeProbe;
  readonly timeoutMs?: number;
}): PetRuntimeValidator {
  const timeoutMs = validTimeout(options.timeoutMs) ? options.timeoutMs : 5_000;
  return {
    async validate(archive): Promise<PetRuntimeValidationResult> {
      const layeredRig = await prepareLayeredRigRuntimeCandidate(archive);
      const frameSequence = layeredRig.status === 'rejected'
        && layeredRig.code === 'pet-runtime-incompatible'
        && layeredRig.reason === 'runtime-contract'
        ? await prepareFrameSequenceRuntimeCandidate(archive)
        : layeredRig;
      const prepared = frameSequence.status === 'accepted'
        ? frameSequence
        : frameSequence.code === 'pet-runtime-incompatible' && frameSequence.reason === 'runtime-contract'
          ? await prepareRiveRuntimeCandidate(archive)
          : frameSequence;
      if (prepared.status === 'rejected') return prepared;
      let probe: PetRuntimeProbe;
      try {
        probe = options.createProbe();
      } catch {
        return {
          status: 'rejected',
          code: 'pet-player-unavailable',
          reason: 'probe-failed',
          package: prepared.package,
        };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const probeResult = probe.validate(prepared.candidate).then(
          (result) => result === 'compatible'
            ? ({ status: 'compatible' } as const)
            : ({ status: 'incompatible' } as const),
          () => ({ status: 'failed' } as const),
        );
        const outcome = await Promise.race([
          probeResult,
          new Promise<{ readonly status: 'timeout' }>((resolve) => {
            timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
          }),
        ]);
        if (outcome.status === 'timeout') {
          return { status: 'rejected', code: 'pet-player-unavailable', reason: 'probe-timeout', package: prepared.package };
        }
        if (outcome.status === 'failed') {
          return { status: 'rejected', code: 'pet-player-unavailable', reason: 'probe-failed', package: prepared.package };
        }
        if (outcome.status === 'incompatible') {
          return { status: 'rejected', code: 'pet-player-unavailable', reason: 'probe-incompatible', package: prepared.package };
        }
        return {
          status: 'accepted',
          package: prepared.package,
          playerAsset: prepared.candidate,
        };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        probe.dispose();
      }
    },
  };
}

function validTimeout(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 100 && (value as number) <= 30_000;
}
