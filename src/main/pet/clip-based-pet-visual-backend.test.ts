import { describe, expect, it, vi } from 'vitest';

import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import { PET_MOTION_GENERATION_SPECS, type PetVisualReference } from './frame-sequence-generation-orchestrator.js';
import { createPngHeader } from './pet-package-test-helper.js';
import {
  ClipBasedPetVisualBackend,
  type PetMainLookAdapter,
} from './clip-based-pet-visual-backend.js';
import type {
  PetMotionClipAdapter,
  PetMotionClipRasterizer,
} from './pet-motion-clip.js';

const spec = PET_MOTION_GENERATION_SPECS.standing;
const canonicalBytes = createPngHeader({ width: 512, height: 512 });
const canonicalLook: PetVisualReference = {
  id: 'canonical-look',
  role: 'canonical-look',
  mediaType: 'image/png',
  bytes: canonicalBytes,
};

function input(): PetCreatorInput {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    displayName: '测试宠物',
    request: '角色保持一致，动作连续。',
    references: [],
  };
}

function mainLookAdapter(overrides: Partial<PetMainLookAdapter> = {}): PetMainLookAdapter {
  return {
    id: 'main-look-model',
    version: '1.0.0',
    extraProviderCredentialRequired: false,
    async generate() {
      return { mediaType: 'image/png', bytes: canonicalBytes };
    },
    ...overrides,
  };
}

function motionClipAdapter(overrides: Partial<PetMotionClipAdapter> = {}): PetMotionClipAdapter {
  return {
    id: 'motion-video-model',
    version: '1.0.0',
    extraProviderCredentialRequired: false,
    async generate() {
      return { mediaType: 'video/mp4', bytes: Uint8Array.from([1, 2, 3]), sourceDurationMs: spec.durationMs };
    },
    ...overrides,
  };
}

function rasterizer(overrides: Partial<PetMotionClipRasterizer> = {}): PetMotionClipRasterizer {
  return {
    id: 'isolated-rasterizer',
    version: '1.0.0',
    async rasterize({ spec: motionSpec }) {
      return {
        atlas: {
          motion: motionSpec.motion,
          mediaType: 'image/png',
          bytes: createPngHeader({
            width: motionSpec.columns * motionSpec.cellWidth,
            height: motionSpec.rows * motionSpec.cellHeight,
          }),
          width: motionSpec.columns * motionSpec.cellWidth,
          height: motionSpec.rows * motionSpec.cellHeight,
          columns: motionSpec.columns,
          rows: motionSpec.rows,
          frameCount: motionSpec.frameCount,
          durationMs: motionSpec.durationMs,
        },
        evidence: {
          decodedFrameCount: motionSpec.frameCount,
          targetFrameCount: motionSpec.frameCount,
          uniqueFrameCount: motionSpec.frameCount,
          transparentEdges: 'pass',
          stableRegistration: 'pass',
          stageBounds: 'pass',
        },
      };
    },
    ...overrides,
  };
}

describe('ClipBasedPetVisualBackend', () => {
  it('connects main-look, video generation and isolated rasterization with a stable identity', async () => {
    const generateClip = vi.fn(motionClipAdapter().generate);
    const rasterize = vi.fn(rasterizer().rasterize);
    const backend = new ClipBasedPetVisualBackend(mainLookAdapter(), motionClipAdapter({ generate: generateClip }), rasterizer({ rasterize }));

    const result = await backend.generateMotion({ input: input(), references: [canonicalLook], spec, signal: new AbortController().signal });

    expect(backend.id).toBe('clip-pet-visual');
    expect(backend.version).toMatch(/^pipeline-[a-f0-9]{16}$/);
    expect(result).toMatchObject({ motion: 'standing', frameCount: 240, durationMs: 4_000 });
    expect(generateClip).toHaveBeenCalledWith(expect.objectContaining({
      inputRequest: '角色保持一致，动作连续。',
      canonicalLook: expect.objectContaining({ role: 'canonical-look' }),
      spec,
    }));
    expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({
      chromaKey: { red: 0, green: 255, blue: 0 },
      spec,
    }));
  });

  it('copies model outputs and inputs across component boundaries', async () => {
    const generatedMainLook = Uint8Array.from(canonicalBytes);
    const generateMainLook = vi.fn(async ({ references }: Parameters<PetMainLookAdapter['generate']>[0]) => {
      references[0]!.bytes[0] = 0;
      return { mediaType: 'image/png' as const, bytes: generatedMainLook };
    });
    const originalReference = { ...canonicalLook, role: 'primary' as const, bytes: Uint8Array.from(canonicalBytes) };
    const backend = new ClipBasedPetVisualBackend(mainLookAdapter({ generate: generateMainLook }), motionClipAdapter(), rasterizer());

    const result = await backend.generateMainLook({ input: input(), references: [originalReference], signal: new AbortController().signal });
    generatedMainLook[0] = 0;

    expect(originalReference.bytes[0]).toBe(canonicalBytes[0]);
    expect(result.bytes[0]).toBe(canonicalBytes[0]);
  });

  it('rejects an absent or ambiguous canonical look before video generation', async () => {
    const generate = vi.fn(motionClipAdapter().generate);
    const backend = new ClipBasedPetVisualBackend(mainLookAdapter(), motionClipAdapter({ generate }), rasterizer());

    await expect(backend.generateMotion({ input: input(), references: [], spec, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'invalid-request' });
    await expect(backend.generateMotion({ input: input(), references: [canonicalLook, canonicalLook], spec, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'invalid-request' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects nominal 60fps atlases backed by too few unique frames', async () => {
    const base = rasterizer();
    const lowFrameRasterizer = rasterizer({
      async rasterize(request) {
        const result = await base.rasterize(request);
        return {
          ...result,
          evidence: { ...result.evidence, decodedFrameCount: 120, uniqueFrameCount: 120 },
        };
      },
    });
    const backend = new ClipBasedPetVisualBackend(mainLookAdapter(), motionClipAdapter(), lowFrameRasterizer);

    await expect(backend.generateMotion({ input: input(), references: [canonicalLook], spec, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'invalid-output' });
  });

  it('rejects mismatched atlas geometry and failed transparency evidence', async () => {
    const base = rasterizer();
    const brokenRasterizer = rasterizer({
      async rasterize(request) {
        const result = await base.rasterize(request);
        return {
          atlas: { ...result.atlas, frameCount: result.atlas.frameCount - 1 },
          evidence: { ...result.evidence, transparentEdges: 'fail' },
        };
      },
    });
    const backend = new ClipBasedPetVisualBackend(mainLookAdapter(), motionClipAdapter(), brokenRasterizer);

    await expect(backend.generateMotion({ input: input(), references: [canonicalLook], spec, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'invalid-output' });
  });

  it('rejects unsafe component identities before any model call', () => {
    expect(() => new ClipBasedPetVisualBackend(mainLookAdapter({ id: '../model' }), motionClipAdapter(), rasterizer()))
      .toThrow('invalid pet visual pipeline component identity');
  });
});
