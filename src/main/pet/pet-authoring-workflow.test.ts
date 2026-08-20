import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import type {
  PetAuthoringAdapterReport,
  PetAuthoringProgressSnapshot,
  PetCreatorInput,
} from '../../shared/pet-authoring.js';
import { createDraftPetArchive } from './pet-package-test-helper.js';
import { PetAuthoringWorkflow, type PetAuthoringAdapter } from './pet-authoring-workflow.js';

const referenceBytes = Buffer.from('canonical character reference');

function creatorInput(): PetCreatorInput {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    displayName: '测试宠物',
    request: '保持角色身份稳定，生成自然呼吸、睡眠、唤醒和进食动作。',
    references: [{
      id: 'primary',
      role: 'primary',
      mediaType: 'image/png',
      byteLength: referenceBytes.byteLength,
      width: 2048,
      height: 2048,
      sha256: sha256(referenceBytes),
    }],
  };
}

function report(): PetAuthoringAdapterReport {
  return {
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
    }])) as Readonly<Record<PetMotion, { generated: boolean; durationMs: number; frameCount: number }>>,
    qa: {
      identityConsistency: 96,
      transparentEdges: 'pass',
      stageBounds: 'pass',
      transitionContinuity: 'pass',
    },
  };
}

function adapter(overrides: Partial<PetAuthoringAdapter> = {}): PetAuthoringAdapter {
  return {
    candidateId: 'webm-alpha',
    async author() {
      return {
        archive: createDraftPetArchive({
          payloadPath: 'payload/pet.webm',
          payloadMediaType: 'video/webm',
        }),
        report: report(),
      };
    },
    ...overrides,
  };
}

describe('PetAuthoringWorkflow', () => {
  it('binds creator input bytes, a valid package and creator-gate evidence in one result', async () => {
    const author = vi.fn(adapter().author);
    const workflow = new PetAuthoringWorkflow([adapter({ author })]);

    const result = await workflow.author(
      'webm-alpha',
      creatorInput(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'accepted',
      evidence: {
        candidateId: 'webm-alpha',
        automation: { manualEditorSteps: 0, proprietaryEditorRequired: false, extraProviderCredentialRequired: false },
      },
    });
    expect(author).toHaveBeenCalledOnce();
    expect(author.mock.calls[0]?.[0].references.get('primary')).not.toBe(referenceBytes);
  });

  it('publishes bounded monotonic progress without exposing internal job details', async () => {
    const snapshots: PetAuthoringProgressSnapshot[] = [];
    const workflow = new PetAuthoringWorkflow([adapter({
      async author(request) {
        request.progress.mainLookReady();
        for (const motion of PET_MOTIONS) request.progress.motionReady(motion);
        request.progress.visualQaStarted();
        return {
          archive: createDraftPetArchive({
            payloadPath: 'payload/pet.webm',
            payloadMediaType: 'video/webm',
          }),
          report: report(),
        };
      },
    })]);

    const result = await workflow.author(
      'webm-alpha',
      creatorInput(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
      (snapshot) => snapshots.push(snapshot),
    );

    expect(result.status).toBe('accepted');
    expect(snapshots.map(({ sequence }) => sequence)).toEqual(snapshots.map((_, index) => index));
    expect(snapshots.map(({ percent }) => percent)).toEqual([...snapshots.map(({ percent }) => percent)].sort((a, b) => a - b));
    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'preparing', percent: 0, status: 'running' }),
      expect.objectContaining({ stage: 'main-look', percent: 25, status: 'running' }),
      expect.objectContaining({ stage: 'motions', percent: 75, completedMotions: PET_MOTIONS }),
      expect.objectContaining({ stage: 'hatching', percent: 82, status: 'running' }),
      expect.objectContaining({ stage: 'hatching', percent: 92, status: 'running' }),
    ]));
    expect(snapshots.at(-1)).toMatchObject({ stage: 'hatching', percent: 100, status: 'complete' });
  });

  it('keeps progress observation isolated and reports cancelled terminal state', async () => {
    const statuses: PetAuthoringProgressSnapshot['status'][] = [];
    const controller = new AbortController();
    controller.abort();
    const workflow = new PetAuthoringWorkflow([adapter()]);

    const result = await workflow.author(
      'webm-alpha',
      creatorInput(),
      new Map([['primary', referenceBytes]]),
      controller.signal,
      (snapshot) => {
        statuses.push(snapshot.status);
        throw new Error('observer failure');
      },
    );

    expect(result).toEqual({ status: 'rejected', stage: 'adapter', issues: ['aborted'] });
    expect(statuses).toEqual(['running', 'running', 'cancelled']);
  });

  it('rejects mismatched reference bytes before invoking the adapter', async () => {
    const author = vi.fn(adapter().author);
    const workflow = new PetAuthoringWorkflow([adapter({ author })]);

    const result = await workflow.author(
      'webm-alpha',
      creatorInput(),
      new Map([['primary', Buffer.from('tampered')]]),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'rejected', stage: 'references' });
    expect(author).not.toHaveBeenCalled();
  });

  it('rejects an adapter result that is not an importable yukipet archive', async () => {
    const workflow = new PetAuthoringWorkflow([adapter({
      async author() {
        return { archive: Buffer.from('not a zip'), report: report() };
      },
    })]);

    await expect(workflow.author(
      'webm-alpha',
      creatorInput(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toMatchObject({ status: 'rejected', stage: 'package' });
  });

  it('rejects a structurally valid package when the authoring report leaves manual work', async () => {
    const workflow = new PetAuthoringWorkflow([adapter({
      async author() {
        return {
          archive: createDraftPetArchive(),
          report: {
            ...report(),
            automation: {
              userProvidedEngineAsset: false,
              proprietaryEditorRequired: false,
              manualEditorSteps: 1 as 0,
              extraProviderCredentialRequired: false,
            },
          },
        };
      },
    })]);

    await expect(workflow.author(
      'webm-alpha',
      creatorInput(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: 'rejected',
      stage: 'creator-gate',
      issues: expect.arrayContaining(['automation.manualEditorSteps']),
    });
  });
});

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
