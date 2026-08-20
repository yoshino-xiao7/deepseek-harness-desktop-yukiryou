import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from '../../shared/pet-package.js';
import { PET_MOTION_GENERATION_SPECS } from './frame-sequence-generation-orchestrator.js';

interface SkillContract {
  readonly schemaVersion: number;
  readonly fps: number;
  readonly stage: Readonly<{ width: number; height: number; baseline: number }>;
  readonly automation: Readonly<{
    userProvidedEngineAsset: boolean;
    proprietaryEditorRequired: boolean;
    manualEditorSteps: number;
    extraProviderCredentialRequired: boolean;
  }>;
  readonly motions: Readonly<Record<string, Readonly<{
    durationMs: number;
    frameCount: number;
    loop: boolean;
  }>>>;
}

async function loadContract(): Promise<SkillContract> {
  const path = join(process.cwd(), 'skills/yukiryou-pet-authoring/references/motion-contract.json');
  return JSON.parse(await readFile(path, 'utf8')) as SkillContract;
}

describe('YukiRyou pet authoring skill contract', () => {
  it('stays aligned with the runtime motion contract and zero-credential Creator Gate', async () => {
    const contract = await loadContract();

    expect(contract).toMatchObject({
      schemaVersion: 1,
      fps: 60,
      stage: { width: 1024, height: 640, baseline: 600 },
      automation: {
        userProvidedEngineAsset: false,
        proprietaryEditorRequired: false,
        manualEditorSteps: 0,
        extraProviderCredentialRequired: false,
      },
    });
    expect(Object.keys(contract.motions)).toEqual(PET_MOTIONS);
    for (const motion of PET_MOTIONS) {
      const spec = PET_MOTION_GENERATION_SPECS[motion];
      expect(contract.motions[motion]).toEqual({
        durationMs: spec.durationMs,
        frameCount: spec.frameCount,
        loop: spec.loop,
      });
    }
    expect(Object.values(contract.motions).reduce((total, motion) => total + motion.frameCount, 0)).toBe(1_320);
  });
});
