export const PET_RUNTIME_GATE_IDS = [
  'packagedArm64',
  'offline',
  'preloadDeepValidation',
  'isolatedPlayer',
  'semanticReplay',
  'lifecycleStability',
  'reducedMotion',
  'distributionLicense',
  'authoringDocumented',
  'creatorInputContract',
  'headlessSkillGeneration',
  'zeroExtraCredentials',
] as const;

export type PetRuntimeGateId = typeof PET_RUNTIME_GATE_IDS[number];
export type PetRuntimeGateResult = 'unknown' | 'pass' | 'fail';

export const PET_RUNTIME_SCORE_WEIGHTS = Object.freeze({
  naturalMotion: 30,
  frameTiming: 20,
  resourceStability: 15,
  bundleEfficiency: 10,
  authoringEfficiency: 10,
  toolingCost: 5,
  skillAutomation: 10,
} as const);

export type PetRuntimeScoreId = keyof typeof PET_RUNTIME_SCORE_WEIGHTS;

export interface PetRuntimeCandidateEvaluation {
  readonly id: string;
  readonly name: string;
  readonly gates: Record<PetRuntimeGateId, PetRuntimeGateResult>;
  readonly scores: Record<PetRuntimeScoreId, number | null>;
}

export type PetRuntimeCandidateResult =
  | {
    readonly id: string;
    readonly name: string;
    readonly status: 'incomplete';
    readonly missingGates: readonly PetRuntimeGateId[];
    readonly missingScores: readonly PetRuntimeScoreId[];
  }
  | {
    readonly id: string;
    readonly name: string;
    readonly status: 'disqualified';
    readonly failedGates: readonly PetRuntimeGateId[];
  }
  | {
    readonly id: string;
    readonly name: string;
    readonly status: 'eligible';
    readonly weightedScore: number;
  };

export type PetRuntimeDecision =
  | { readonly status: 'no-eligible-candidate' }
  | { readonly status: 'leader'; readonly candidateId: string; readonly scoreDelta: number | null }
  | {
    readonly status: 'review-required';
    readonly candidateIds: readonly [string, string];
    readonly scoreDelta: number;
  };

export interface PetRuntimeRanking {
  readonly ordered: readonly Extract<PetRuntimeCandidateResult, { status: 'eligible' }>[];
  readonly excluded: readonly Exclude<PetRuntimeCandidateResult, { status: 'eligible' }>[];
  readonly decision: PetRuntimeDecision;
}

export const PET_RUNTIME_REVIEW_MARGIN = 2;

const SCORE_IDS = Object.freeze(Object.keys(PET_RUNTIME_SCORE_WEIGHTS) as PetRuntimeScoreId[]);

export function createEmptyPetRuntimeCandidate(id: string, name: string): PetRuntimeCandidateEvaluation {
  return {
    id,
    name,
    gates: Object.fromEntries(PET_RUNTIME_GATE_IDS.map((gate) => [gate, 'unknown'])) as Record<PetRuntimeGateId, PetRuntimeGateResult>,
    scores: Object.fromEntries(SCORE_IDS.map((score) => [score, null])) as Record<PetRuntimeScoreId, null>,
  };
}

export function evaluatePetRuntimeCandidate(candidate: PetRuntimeCandidateEvaluation): PetRuntimeCandidateResult {
  const failedGates = PET_RUNTIME_GATE_IDS.filter((gate) => candidate.gates[gate] === 'fail');
  if (failedGates.length > 0) {
    return { id: candidate.id, name: candidate.name, status: 'disqualified', failedGates };
  }

  const missingGates = PET_RUNTIME_GATE_IDS.filter((gate) => candidate.gates[gate] !== 'pass');
  const missingScores = SCORE_IDS.filter((score) => !isScore(candidate.scores[score]));
  if (missingGates.length > 0 || missingScores.length > 0) {
    return { id: candidate.id, name: candidate.name, status: 'incomplete', missingGates, missingScores };
  }

  const weightedScore = SCORE_IDS.reduce((total, score) => {
    const value = candidate.scores[score] as number;
    return total + (value * PET_RUNTIME_SCORE_WEIGHTS[score]) / 100;
  }, 0);
  return {
    id: candidate.id,
    name: candidate.name,
    status: 'eligible',
    weightedScore: roundScore(weightedScore),
  };
}

export function rankPetRuntimeCandidates(candidates: readonly PetRuntimeCandidateEvaluation[]): PetRuntimeRanking {
  const results = candidates.map(evaluatePetRuntimeCandidate);
  const ordered = results
    .filter((result): result is Extract<PetRuntimeCandidateResult, { status: 'eligible' }> => result.status === 'eligible')
    .sort((left, right) => right.weightedScore - left.weightedScore || left.id.localeCompare(right.id));
  const excluded = results.filter(
    (result): result is Exclude<PetRuntimeCandidateResult, { status: 'eligible' }> => result.status !== 'eligible',
  );

  const first = ordered[0];
  const second = ordered[1];
  if (first === undefined) return { ordered, excluded, decision: { status: 'no-eligible-candidate' } };
  if (second === undefined) {
    return { ordered, excluded, decision: { status: 'leader', candidateId: first.id, scoreDelta: null } };
  }
  const scoreDelta = roundScore(first.weightedScore - second.weightedScore);
  if (scoreDelta < PET_RUNTIME_REVIEW_MARGIN) {
    return {
      ordered,
      excluded,
      decision: { status: 'review-required', candidateIds: [first.id, second.id], scoreDelta },
    };
  }
  return { ordered, excluded, decision: { status: 'leader', candidateId: first.id, scoreDelta } };
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
