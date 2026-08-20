import { describe, expect, it } from 'vitest';

import {
  PET_RUNTIME_GATE_IDS,
  PET_RUNTIME_SCORE_WEIGHTS,
  createEmptyPetRuntimeCandidate,
  evaluatePetRuntimeCandidate,
  rankPetRuntimeCandidates,
  type PetRuntimeCandidateEvaluation,
} from './pet-runtime-evaluation.js';

function completeCandidate(
  id: string,
  scores: Partial<PetRuntimeCandidateEvaluation['scores']> = {},
): PetRuntimeCandidateEvaluation {
  return {
    ...createEmptyPetRuntimeCandidate(id, id),
    gates: Object.fromEntries(PET_RUNTIME_GATE_IDS.map((gate) => [gate, 'pass'])) as PetRuntimeCandidateEvaluation['gates'],
    scores: {
      naturalMotion: 80,
      frameTiming: 80,
      resourceStability: 80,
      bundleEfficiency: 80,
      authoringEfficiency: 80,
      toolingCost: 80,
      skillAutomation: 80,
      ...scores,
    },
  };
}

describe('pet runtime evaluation', () => {
  it('keeps an unmeasured candidate incomplete instead of assigning optimistic defaults', () => {
    const result = evaluatePetRuntimeCandidate(createEmptyPetRuntimeCandidate('rive-canvas-lite', 'Rive Canvas Lite'));

    expect(result.status).toBe('incomplete');
    expect(result).toMatchObject({
      missingGates: PET_RUNTIME_GATE_IDS,
      missingScores: Object.keys(PET_RUNTIME_SCORE_WEIGHTS),
    });
  });

  it('disqualifies a candidate when any hard gate fails even if all weighted scores are perfect', () => {
    const candidate = completeCandidate('rive-webgl2', {
      naturalMotion: 100,
      frameTiming: 100,
      resourceStability: 100,
      bundleEfficiency: 100,
      authoringEfficiency: 100,
      toolingCost: 100,
      skillAutomation: 100,
    });
    candidate.gates.preloadDeepValidation = 'fail';

    expect(evaluatePetRuntimeCandidate(candidate)).toEqual({
      id: 'rive-webgl2',
      name: 'rive-webgl2',
      status: 'disqualified',
      failedGates: ['preloadDeepValidation'],
    });
  });

  it('disqualifies a player that requires users to learn a proprietary animation editor', () => {
    const candidate = completeCandidate('rive-canvas-lite');
    candidate.gates.headlessSkillGeneration = 'fail';

    expect(evaluatePetRuntimeCandidate(candidate)).toEqual({
      id: 'rive-canvas-lite',
      name: 'rive-canvas-lite',
      status: 'disqualified',
      failedGates: ['headlessSkillGeneration'],
    });
  });

  it('disqualifies a candidate that asks users for another provider key', () => {
    const candidate = completeCandidate('remote-video-pipeline');
    candidate.gates.zeroExtraCredentials = 'fail';

    expect(evaluatePetRuntimeCandidate(candidate)).toEqual({
      id: 'remote-video-pipeline',
      name: 'remote-video-pipeline',
      status: 'disqualified',
      failedGates: ['zeroExtraCredentials'],
    });
  });

  it('uses the frozen weights without changing them based on candidate results', () => {
    const candidate = completeCandidate('webm-alpha', {
      naturalMotion: 90,
      frameTiming: 80,
      resourceStability: 70,
      bundleEfficiency: 60,
      authoringEfficiency: 50,
      toolingCost: 40,
      skillAutomation: 30,
    });

    expect(evaluatePetRuntimeCandidate(candidate)).toMatchObject({
      status: 'eligible',
      weightedScore: 69.5,
    });
    expect(Object.values(PET_RUNTIME_SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('ranks only eligible candidates and reports a close result for explicit review', () => {
    const first = completeCandidate('rive-canvas-lite', { naturalMotion: 84 });
    const second = completeCandidate('dotlottie-software', { naturalMotion: 80 });
    const failed = completeCandidate('webm-alpha');
    failed.gates.offline = 'fail';

    const ranking = rankPetRuntimeCandidates([failed, second, first]);

    expect(ranking.ordered.map((candidate) => candidate.id)).toEqual(['rive-canvas-lite', 'dotlottie-software']);
    expect(ranking.decision).toEqual({
      status: 'review-required',
      candidateIds: ['rive-canvas-lite', 'dotlottie-software'],
      scoreDelta: 1.2,
    });
    expect(ranking.excluded).toEqual([
      { id: 'webm-alpha', name: 'webm-alpha', status: 'disqualified', failedGates: ['offline'] },
    ]);
  });

  it('selects a leader only when it clears the frozen review margin', () => {
    const leader = completeCandidate('rive-canvas-lite', { naturalMotion: 90 });
    const runnerUp = completeCandidate('dotlottie-software', { naturalMotion: 80 });

    expect(rankPetRuntimeCandidates([runnerUp, leader]).decision).toEqual({
      status: 'leader',
      candidateId: 'rive-canvas-lite',
      scoreDelta: 3,
    });
  });
});
