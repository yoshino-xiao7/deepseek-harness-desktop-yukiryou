import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { PET_MOTIONS } from '../../shared/pet-package.js';
import { parsePetFrameSequenceBundle } from '../../shared/pet-frame-sequence-bundle.js';
import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import { createPngHeader } from './pet-package-test-helper.js';
import { prepareFrameSequenceRuntimeCandidate, preflightPetPackage } from './pet-package-preflight.js';
import { PetAuthoringWorkflow } from './pet-authoring-workflow.js';
import { createPetRuntimeValidator } from './pet-runtime-validator.js';
import {
  FrameSequenceAuthoringAdapter,
  type FrameSequenceGeneration,
  type FrameSequenceGenerator,
  type FrameSequenceVisualQa,
} from './frame-sequence-authoring-adapter.js';

const referenceBytes = createPngHeader({ width: 2048, height: 2048 });

function input(): PetCreatorInput {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    displayName: '自动生成宠物',
    request: '保持身份稳定，动作自然并带有连续过渡。',
    references: [{
      id: 'primary',
      role: 'primary',
      mediaType: 'image/png',
      byteLength: referenceBytes.byteLength,
      width: 2048,
      height: 2048,
      sha256: createHash('sha256').update(referenceBytes).digest('hex'),
    }],
  };
}

function generation(): FrameSequenceGeneration {
  return {
    generator: { id: 'fake-visual-model', version: '1.0.0' },
    thumbnail: { mediaType: 'image/png', bytes: createPngHeader({ width: 256, height: 256 }) },
    atlases: PET_MOTIONS.map((motion) => ({
      motion,
      mediaType: 'image/png',
      bytes: createPngHeader({ width: 1024, height: 1024 }),
      width: 1024,
      height: 1024,
      columns: 8,
      rows: 8,
      frameCount: 60,
      durationMs: 1_000,
    })),
  };
}

function passingQa(): FrameSequenceVisualQa {
  return {
    extraProviderCredentialRequired: false,
    async evaluate(request) {
      return {
        creatorInputSha256: request.creatorInputSha256,
        generationSha256: request.generationSha256,
        evaluator: { id: 'test-visual-qa', version: '1.0.0' },
        qa: {
          identityConsistency: 96,
          transparentEdges: 'pass',
          stageBounds: 'pass',
          transitionContinuity: 'pass',
        },
      };
    },
  };
}

function generator(generate: FrameSequenceGenerator['generate'], extraProviderCredentialRequired = false): FrameSequenceGenerator {
  return { extraProviderCredentialRequired, generate };
}

function visualQa(evaluate: FrameSequenceVisualQa['evaluate'], extraProviderCredentialRequired = false): FrameSequenceVisualQa {
  return { extraProviderCredentialRequired, evaluate };
}

function adapter(generator: FrameSequenceGenerator, visualQa: FrameSequenceVisualQa = passingQa()): FrameSequenceAuthoringAdapter {
  return new FrameSequenceAuthoringAdapter(generator, visualQa, {
    id: 'author.generated-pet',
    author: 'Authoring PoC',
    license: 'private-original',
    source: 'local-generated',
    englishName: 'Generated Pet',
  });
}

describe('FrameSequenceAuthoringAdapter', () => {
  it('turns generated motion atlases into an importable yukipet package without editor steps', async () => {
    const generate = vi.fn(async () => generation());
    const evaluate = vi.fn(passingQa().evaluate);
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate), visualQa(evaluate))]);

    const result = await workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'accepted',
      evidence: {
        candidateId: 'frame-sequence-canvas2d',
        automation: { manualEditorSteps: 0, proprietaryEditorRequired: false, extraProviderCredentialRequired: false },
      },
    });
    if (result.status === 'accepted') {
      await expect(preflightPetPackage(result.archive)).resolves.toMatchObject({
        status: 'accepted',
        package: { id: 'author.generated-pet', fileCount: 11 },
      });
      const prepared = await prepareFrameSequenceRuntimeCandidate(result.archive);
      expect(prepared).toMatchObject({
        status: 'accepted',
        candidate: {
          runtime: 'frame-sequence-canvas2d',
        },
      });
      if (prepared.status === 'accepted') {
        expect(parsePetFrameSequenceBundle(prepared.candidate.assetBytes)).toMatchObject({
          motions: {
            standing: { width: 1024, height: 1024, frameCount: 60, durationMs: 1_000 },
            eating: { width: 1024, height: 1024, frameCount: 60, durationMs: 1_000 },
          },
        });
      }
      const validate = vi.fn(async () => 'compatible' as const);
      const validator = createPetRuntimeValidator({
        createProbe: () => ({ validate, dispose: vi.fn() }),
      });
      await expect(validator.validate(result.archive)).resolves.toMatchObject({
        status: 'accepted',
        playerAsset: { runtime: 'frame-sequence-canvas2d' },
      });
      expect(validate).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'frame-sequence-canvas2d' }));
    }
    expect(generate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.invocationCallOrder[0]).toBeGreaterThan(generate.mock.invocationCallOrder[0]!);
  });

  it('rejects an otherwise passing pipeline when generation or QA requires another provider key', async () => {
    const generate = vi.fn(async () => generation());
    const evaluate = vi.fn(passingQa().evaluate);
    const workflow = new PetAuthoringWorkflow([
      adapter(generator(generate, true), visualQa(evaluate, true)),
    ]);

    await expect(workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: 'rejected',
      stage: 'creator-gate',
      issues: expect.arrayContaining(['automation.extraProviderCredentialRequired']),
    });
  });

  it('does not let the generator approve its own visual quality', async () => {
    const generate = vi.fn(async () => generation());
    const evaluate = vi.fn(async (request: Parameters<FrameSequenceVisualQa['evaluate']>[0]) => ({
      creatorInputSha256: request.creatorInputSha256,
      generationSha256: request.generationSha256,
      evaluator: { id: 'test-visual-qa', version: '1.0.0' },
      qa: {
        identityConsistency: 82,
        transparentEdges: 'pass' as const,
        stageBounds: 'pass' as const,
        transitionContinuity: 'fail' as const,
      },
    }));
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate), visualQa(evaluate))]);

    await expect(workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: 'rejected',
      stage: 'creator-gate',
      issues: expect.arrayContaining(['qa.identityConsistency', 'qa.transitionContinuity']),
    });
  });

  it('rejects stale QA evidence that belongs to another generation', async () => {
    const generate = vi.fn(async () => generation());
    const evaluate = vi.fn(async (request: Parameters<FrameSequenceVisualQa['evaluate']>[0]) => ({
      creatorInputSha256: request.creatorInputSha256,
      generationSha256: 'f'.repeat(64),
      evaluator: { id: 'test-visual-qa', version: '1.0.0' },
      qa: {
        identityConsistency: 96,
        transparentEdges: 'pass' as const,
        stageBounds: 'pass' as const,
        transitionContinuity: 'pass' as const,
      },
    }));
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate), visualQa(evaluate))]);

    await expect(workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toEqual({ status: 'rejected', stage: 'adapter', issues: ['failed'] });
  });

  it('isolates package bytes from mutations attempted by the QA adapter', async () => {
    const generate = vi.fn(async () => generation());
    const evaluate = vi.fn(async (request: Parameters<FrameSequenceVisualQa['evaluate']>[0]) => {
      request.generation.thumbnail.bytes[0] = 0;
      request.generation.atlases[0]!.bytes[0] = 0;
      return passingQa().evaluate(request);
    });
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate), visualQa(evaluate))]);

    const result = await workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    );

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      await expect(prepareFrameSequenceRuntimeCandidate(result.archive)).resolves.toMatchObject({ status: 'accepted' });
    }
  });

  it('gives generation and visual QA separate reference copies and no QA progress capability', async () => {
    const originalFirstByte = referenceBytes[0];
    const generate = vi.fn(async (request: Parameters<FrameSequenceGenerator['generate']>[0]) => {
      request.references.get('primary')![0] = 0;
      return generation();
    });
    const evaluate = vi.fn(async (request: Parameters<FrameSequenceVisualQa['evaluate']>[0]) => {
      expect(request.references.get('primary')?.[0]).toBe(originalFirstByte);
      expect('progress' in request).toBe(false);
      return passingQa().evaluate(request);
    });
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate), visualQa(evaluate))]);

    await expect(workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toMatchObject({ status: 'accepted' });
    expect(referenceBytes[0]).toBe(originalFirstByte);
  });

  it('fails closed when the generator omits a semantic motion', async () => {
    const incomplete = generation();
    const generate = vi.fn(async () => ({ ...incomplete, atlases: incomplete.atlases.slice(1) }));
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate))]);

    await expect(workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toEqual({ status: 'rejected', stage: 'adapter', issues: ['failed'] });
  });

  it('rejects atlas metadata that does not match the actual image dimensions', async () => {
    const generated = generation();
    const generate = vi.fn(async () => ({
      ...generated,
      atlases: generated.atlases.map((atlas, index) => index === 0 ? { ...atlas, width: 512 } : atlas),
    }));
    const workflow = new PetAuthoringWorkflow([adapter(generator(generate))]);

    await expect(workflow.author(
      'frame-sequence-canvas2d',
      input(),
      new Map([['primary', referenceBytes]]),
      new AbortController().signal,
    )).resolves.toEqual({ status: 'rejected', stage: 'adapter', issues: ['failed'] });
  });
});
