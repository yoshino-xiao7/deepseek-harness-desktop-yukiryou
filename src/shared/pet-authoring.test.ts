import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from './pet-package.js';
import {
  evaluatePetAuthoringEvidence,
  validatePetCreatorInput,
  type PetAuthoringEvidence,
  type PetCreatorInput,
} from './pet-authoring.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function creatorInput(overrides: Partial<PetCreatorInput> = {}): PetCreatorInput {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    displayName: '测试宠物',
    request: '保持蓝色长发和尾巴，站立时有自然呼吸，工作时开心进食。',
    references: [{
      id: 'primary',
      role: 'primary',
      mediaType: 'image/png',
      byteLength: 1024,
      width: 2048,
      height: 2048,
      sha256: HASH_A,
    }],
    ...overrides,
  };
}

function evidence(overrides: Partial<PetAuthoringEvidence> = {}): PetAuthoringEvidence {
  return {
    schemaVersion: 1,
    candidateId: 'webm-alpha',
    creatorInputSha256: HASH_A,
    packageSha256: HASH_B,
    automation: {
      userProvidedEngineAsset: false,
      proprietaryEditorRequired: false,
      manualEditorSteps: 0,
      extraProviderCredentialRequired: false,
    },
    motions: Object.fromEntries(PET_MOTIONS.map((motion) => [motion, {
      generated: true,
      durationMs: 1_000,
      frameCount: 60,
    }])) as PetAuthoringEvidence['motions'],
    qa: {
      identityConsistency: 95,
      transparentEdges: 'pass',
      stageBounds: 'pass',
      transitionContinuity: 'pass',
    },
    ...overrides,
  };
}

describe('pet creator input', () => {
  it('accepts the low-learning-cost interface of images plus natural language', () => {
    const input = creatorInput({ request: '保持角色身份稳定。\n工作时开心进食。' });
    expect(validatePetCreatorInput(input)).toEqual({
      status: 'accepted',
      input,
    });
  });

  it('requires exactly one primary reference without exposing engine files', () => {
    const input = creatorInput({
      references: [
        { ...creatorInput().references[0]!, role: 'supplemental' },
        { ...creatorInput().references[0]!, id: 'second', sha256: HASH_B, role: 'supplemental' },
      ],
    });

    expect(validatePetCreatorInput(input)).toMatchObject({
      status: 'rejected',
      issues: expect.arrayContaining(['references.primary']),
    });
  });

  it('rejects hidden fields that could leak an engine-specific interface to users', () => {
    expect(validatePetCreatorInput({ ...creatorInput(), riveFile: 'pet.riv' })).toEqual({
      status: 'rejected',
      issues: ['riveFile'],
    });
  });
});

describe('pet authoring creator gate', () => {
  it('passes a fully automated open-format candidate with complete motion and QA evidence', () => {
    expect(evaluatePetAuthoringEvidence(evidence())).toEqual({ status: 'pass', candidateId: 'webm-alpha' });
  });

  it('fails evidence that leaves proprietary editor work or third-party credentials to the user', () => {
    const result = evaluatePetAuthoringEvidence({
      ...evidence(),
      automation: {
        userProvidedEngineAsset: true,
        proprietaryEditorRequired: true,
        manualEditorSteps: 4,
        extraProviderCredentialRequired: true,
      },
    });

    expect(result).toMatchObject({
      status: 'fail',
      candidateId: 'webm-alpha',
      issues: expect.arrayContaining([
        'automation.userProvidedEngineAsset',
        'automation.proprietaryEditorRequired',
        'automation.manualEditorSteps',
        'automation.extraProviderCredentialRequired',
      ]),
    });
  });

  it('fails incomplete motion coverage or weak identity consistency', () => {
    const motions = { ...evidence().motions, eating: { generated: false, durationMs: 1_000, frameCount: 60 } };
    const result = evaluatePetAuthoringEvidence(evidence({
      motions,
      qa: { ...evidence().qa, identityConsistency: 89 },
    }));

    expect(result).toMatchObject({
      status: 'fail',
      issues: expect.arrayContaining(['motions.eating.generated', 'qa.identityConsistency']),
    });
  });

  it('does not allow a paused proprietary candidate to enter the authoring comparison', () => {
    expect(evaluatePetAuthoringEvidence({ ...evidence(), candidateId: 'rive-canvas-lite' })).toEqual({
      status: 'fail',
      issues: ['candidateId'],
    });
  });
});
