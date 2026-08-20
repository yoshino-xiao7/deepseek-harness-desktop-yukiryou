import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import { createPngHeader } from './pet-package-test-helper.js';
import type { FrameSequenceGeneratorRequest, GeneratedMotionAtlas } from './frame-sequence-authoring-adapter.js';
import {
  FrameSequenceGenerationOrchestrator,
  PET_MOTION_GENERATION_SPECS,
  PetVisualGenerationError,
  type PetVisualGenerationBackend,
} from './frame-sequence-generation-orchestrator.js';

const referenceBytes = createPngHeader({ width: 1024, height: 1024 });

function input(): PetCreatorInput {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    displayName: '自动孵化宠物',
    request: '保持角色身份稳定，动作自然流畅。',
    references: [{
      id: 'primary',
      role: 'primary',
      mediaType: 'image/png',
      byteLength: referenceBytes.byteLength,
      width: 1024,
      height: 1024,
      sha256: createHash('sha256').update(referenceBytes).digest('hex'),
    }],
  };
}

function request(signal = new AbortController().signal): FrameSequenceGeneratorRequest {
  return {
    input: input(),
    creatorInputSha256: 'a'.repeat(64),
    references: new Map([['primary', referenceBytes]]),
    signal,
    progress: {
      mainLookReady: vi.fn(),
      motionReady: vi.fn(),
    },
  };
}

function atlas(motion: PetMotion): GeneratedMotionAtlas {
  const spec = PET_MOTION_GENERATION_SPECS[motion];
  return {
    motion,
    mediaType: 'image/png',
    bytes: createPngHeader({ width: spec.columns * spec.cellWidth, height: spec.rows * spec.cellHeight }),
    width: spec.columns * spec.cellWidth,
    height: spec.rows * spec.cellHeight,
    columns: spec.columns,
    rows: spec.rows,
    frameCount: spec.frameCount,
    durationMs: spec.durationMs,
  };
}

function backend(overrides: Partial<PetVisualGenerationBackend> = {}): PetVisualGenerationBackend {
  return {
    id: 'fake-visual-model',
    version: '1.0.0',
    extraProviderCredentialRequired: false,
    async generateMainLook() {
      return { mediaType: 'image/png', bytes: createPngHeader({ width: 512, height: 512 }) };
    },
    async generateMotion({ spec }) {
      return atlas(spec.motion);
    },
    ...overrides,
  };
}

describe('FrameSequenceGenerationOrchestrator', () => {
  it('generates the canonical look first, then returns all motions in semantic order', async () => {
    const calls: string[] = [];
    const generateMainLook = vi.fn(async () => {
      calls.push('main-look');
      return { mediaType: 'image/png' as const, bytes: createPngHeader({ width: 512, height: 512 }) };
    });
    const generateMotion = vi.fn(async ({ spec, references }: Parameters<PetVisualGenerationBackend['generateMotion']>[0]) => {
      calls.push(spec.motion);
      expect(references.at(-1)).toMatchObject({ id: 'canonical-look', role: 'canonical-look' });
      return atlas(spec.motion);
    });
    const authoringRequest = request();

    const result = await new FrameSequenceGenerationOrchestrator(backend({ generateMainLook, generateMotion })).generate(authoringRequest);

    expect(calls[0]).toBe('main-look');
    expect(result.generator).toEqual({ id: 'fake-visual-model', version: '1.0.0' });
    expect(result.atlases.map(({ motion }) => motion)).toEqual(PET_MOTIONS);
    expect(authoringRequest.progress.mainLookReady).toHaveBeenCalledOnce();
    expect(authoringRequest.progress.motionReady).toHaveBeenCalledTimes(PET_MOTIONS.length);
  });

  it('limits visual generation to three concurrent motion jobs', async () => {
    let active = 0;
    let maximum = 0;
    const generateMotion = vi.fn(async ({ spec }: Parameters<PetVisualGenerationBackend['generateMotion']>[0]) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      active -= 1;
      return atlas(spec.motion);
    });

    await new FrameSequenceGenerationOrchestrator(backend({ generateMotion })).generate(request());

    expect(maximum).toBe(3);
  });

  it('isolates reference bytes between concurrent model calls', async () => {
    const expectedPrimary = referenceBytes[0];
    let expectedCanonical: number | undefined;
    const generateMotion = vi.fn(async ({ spec, references }: Parameters<PetVisualGenerationBackend['generateMotion']>[0]) => {
      const primary = references.find(({ id }) => id === 'primary')!;
      const canonical = references.find(({ id }) => id === 'canonical-look')!;
      expectedCanonical ??= canonical.bytes[0];
      expect(primary.bytes[0]).toBe(expectedPrimary);
      expect(canonical.bytes[0]).toBe(expectedCanonical);
      primary.bytes[0] = 0;
      canonical.bytes[0] = 0;
      return atlas(spec.motion);
    });

    await new FrameSequenceGenerationOrchestrator(backend({ generateMotion })).generate(request());

    expect(referenceBytes[0]).toBe(expectedPrimary);
  });

  it('retries a transient backend failure once but does not retry policy rejection', async () => {
    const attempts = new Map<PetMotion, number>();
    const transientMotion = vi.fn(async ({ spec }: Parameters<PetVisualGenerationBackend['generateMotion']>[0]) => {
      const count = (attempts.get(spec.motion) ?? 0) + 1;
      attempts.set(spec.motion, count);
      if (spec.motion === 'standing' && count === 1) throw new PetVisualGenerationError('transient', 'temporary');
      return atlas(spec.motion);
    });
    await new FrameSequenceGenerationOrchestrator(backend({ generateMotion: transientMotion }), 1).generate(request());
    expect(attempts.get('standing')).toBe(2);

    const policyMotion = vi.fn(async ({ spec }: Parameters<PetVisualGenerationBackend['generateMotion']>[0]) => {
      throw new PetVisualGenerationError('policy-rejected', spec.motion);
    });
    await expect(new FrameSequenceGenerationOrchestrator(backend({ generateMotion: policyMotion }), 1).generate(request()))
      .rejects.toMatchObject({ code: 'policy-rejected' });
    expect(policyMotion).toHaveBeenCalledOnce();
  });

  it('stops scheduling motions after user cancellation', async () => {
    const controller = new AbortController();
    const generateMotion = vi.fn(async ({ spec }: Parameters<PetVisualGenerationBackend['generateMotion']>[0]) => {
      controller.abort();
      return atlas(spec.motion);
    });

    await expect(new FrameSequenceGenerationOrchestrator(backend({ generateMotion }), 1).generate(request(controller.signal)))
      .rejects.toThrow('aborted');
    expect(generateMotion).toHaveBeenCalledOnce();
  });

  it('rejects an unversioned or unsafe generation backend before sending references', async () => {
    const generateMainLook = vi.fn(backend().generateMainLook);
    const unsafeBackend = backend({ id: '../visual-model', generateMainLook });

    await expect(new FrameSequenceGenerationOrchestrator(unsafeBackend).generate(request()))
      .rejects.toMatchObject({ code: 'invalid-output' });
    expect(generateMainLook).not.toHaveBeenCalled();
  });

  it('keeps the complete 60fps motion plan inside the player frame budget', () => {
    const totalFrames = PET_MOTIONS.reduce((sum, motion) => sum + PET_MOTION_GENERATION_SPECS[motion].frameCount, 0);
    expect(new Set(PET_MOTIONS.map((motion) => PET_MOTION_GENERATION_SPECS[motion].instruction)).size).toBe(PET_MOTIONS.length);
    expect(PET_MOTIONS.every((motion) => PET_MOTION_GENERATION_SPECS[motion].fps === 60)).toBe(true);
    expect(totalFrames).toBeLessThanOrEqual(1_440);
  });
});
