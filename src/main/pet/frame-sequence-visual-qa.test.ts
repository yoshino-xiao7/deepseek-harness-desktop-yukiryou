import { describe, expect, it, vi } from 'vitest';

import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import type { FrameSequenceGeneration, FrameSequenceVisualQaRequest, GeneratedMotionAtlas } from './frame-sequence-authoring-adapter.js';
import {
  IndependentFrameSequenceVisualQa,
  type PetAtlasFrameDecoder,
  type PetIdentityEvaluationAdapter,
} from './frame-sequence-visual-qa.js';

const WIDTH = 192;
const HEIGHT = 208;

function frame(x: number, touchesEdge = false): Uint8ClampedArray {
  const output = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const startX = touchesEdge ? 0 : x;
  for (let y = 70; y < 150; y += 1) {
    for (let column = startX; column < startX + 30; column += 1) {
      const offset = (y * WIDTH + column) * 4;
      output.set([30, 60, 220, 255], offset);
    }
  }
  return output;
}

function motionFrames(motion: PetMotion): readonly Uint8ClampedArray[] {
  return motion === 'standing' || motion === 'sleeping' || motion === 'eating'
    ? [frame(70), frame(71), frame(72), frame(71), frame(70)]
    : [frame(70), frame(71), frame(72), frame(73), frame(74)];
}

function atlas(motion: PetMotion): GeneratedMotionAtlas {
  return {
    motion,
    mediaType: 'image/png',
    bytes: Uint8Array.of(1),
    width: 16 * WIDTH,
    height: HEIGHT,
    columns: 16,
    rows: 1,
    frameCount: 5,
    durationMs: 1_000,
  };
}

function generation(): FrameSequenceGeneration {
  return {
    generator: { id: 'test-generator', version: '1.0.0' },
    thumbnail: { mediaType: 'image/png', bytes: Uint8Array.of(1) },
    atlases: PET_MOTIONS.map(atlas),
  };
}

function creatorInput(): PetCreatorInput {
  return { schemaVersion: 1, locale: 'zh-CN', displayName: '宠物', request: '保持一致', references: [] };
}

function request(): FrameSequenceVisualQaRequest {
  return {
    input: creatorInput(),
    creatorInputSha256: 'a'.repeat(64),
    references: new Map(),
    generation: generation(),
    generationSha256: 'b'.repeat(64),
    signal: new AbortController().signal,
  };
}

function decoder(overrides: Partial<PetAtlasFrameDecoder> = {}): PetAtlasFrameDecoder {
  return {
    id: 'test-atlas-decoder',
    version: '1.0.0',
    async decode(atlas) {
      return { cellWidth: WIDTH, cellHeight: HEIGHT, frames: motionFrames(atlas.motion) };
    },
    ...overrides,
  };
}

function identity(overrides: Partial<PetIdentityEvaluationAdapter> = {}): PetIdentityEvaluationAdapter {
  return {
    id: 'test-identity-model',
    version: '1.0.0',
    extraProviderCredentialRequired: false,
    async evaluate() { return { identityConsistency: 96 }; },
    ...overrides,
  };
}

describe('IndependentFrameSequenceVisualQa', () => {
  it('combines objective frame analysis with a separately versioned identity evaluator', async () => {
    const evaluateIdentity = vi.fn(identity().evaluate);
    const qa = new IndependentFrameSequenceVisualQa(decoder(), identity({ evaluate: evaluateIdentity }));

    const result = await qa.evaluate(request());

    expect(result).toMatchObject({
      creatorInputSha256: 'a'.repeat(64),
      generationSha256: 'b'.repeat(64),
      evaluator: { id: 'independent-visual-qa', version: expect.stringMatching(/^pipeline-[a-f0-9]{16}$/) },
      qa: { identityConsistency: 96, transparentEdges: 'pass', stageBounds: 'pass', transitionContinuity: 'pass' },
    });
    expect(evaluateIdentity).toHaveBeenCalledOnce();
    const samples = evaluateIdentity.mock.calls[0]![0].samples;
    expect([...samples.keys()]).toEqual(PET_MOTIONS);
    expect([...samples.values()].every((frames) => frames.length === 5)).toBe(true);
  });

  it('fails transparent edges and stage bounds independently of identity scoring', async () => {
    const brokenDecoder = decoder({
      async decode(atlas) {
        const frames: Uint8ClampedArray[] = motionFrames(atlas.motion).map((value) => new Uint8ClampedArray(value));
        if (atlas.motion === 'standing') frames[0] = frame(0, true);
        if (atlas.motion === 'drowsy') frames[1] = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
        return { cellWidth: WIDTH, cellHeight: HEIGHT, frames };
      },
    });

    await expect(new IndependentFrameSequenceVisualQa(brokenDecoder, identity()).evaluate(request()))
      .resolves.toMatchObject({ qa: { identityConsistency: 96, transparentEdges: 'fail', stageBounds: 'fail', transitionContinuity: 'fail' } });
  });

  it('rejects a pet inside the canvas but too close to the activity-area edge', async () => {
    const edgeDecoder = decoder({
      async decode(atlas) {
        const frames: Uint8ClampedArray[] = motionFrames(atlas.motion).map((value) => new Uint8ClampedArray(value));
        if (atlas.motion === 'drowsy') frames[0] = frame(2);
        return { cellWidth: WIDTH, cellHeight: HEIGHT, frames };
      },
    });

    await expect(new IndependentFrameSequenceVisualQa(edgeDecoder, identity()).evaluate(request()))
      .resolves.toMatchObject({ qa: { transparentEdges: 'pass', stageBounds: 'fail' } });
  });

  it('detects a sudden pose jump and a broken loop closure', async () => {
    const jumpingDecoder = decoder({
      async decode(atlas) {
        const frames: Uint8ClampedArray[] = motionFrames(atlas.motion).map((value) => new Uint8ClampedArray(value));
        if (atlas.motion === 'work-enter') frames[2] = frame(155);
        if (atlas.motion === 'standing') frames[4] = frame(130);
        return { cellWidth: WIDTH, cellHeight: HEIGHT, frames };
      },
    });

    await expect(new IndependentFrameSequenceVisualQa(jumpingDecoder, identity()).evaluate(request()))
      .resolves.toMatchObject({ qa: { transitionContinuity: 'fail' } });
  });

  it('rejects sparse poses duplicated behind a nominal high frame rate', async () => {
    const sparseDecoder = decoder({
      async decode(atlas) {
        const still = frame(70);
        return {
          cellWidth: WIDTH,
          cellHeight: HEIGHT,
          frames: Array.from({ length: atlas.frameCount }, () => new Uint8ClampedArray(still)),
        };
      },
    });

    await expect(new IndependentFrameSequenceVisualQa(sparseDecoder, identity()).evaluate(request()))
      .resolves.toMatchObject({ qa: { transitionContinuity: 'fail' } });
  });

  it('does not replace a failing identity score with pixel similarity', async () => {
    const qa = new IndependentFrameSequenceVisualQa(decoder(), identity({ async evaluate() { return { identityConsistency: 82 }; } }));
    await expect(qa.evaluate(request())).resolves.toMatchObject({ qa: { identityConsistency: 82 } });
  });

  it('rejects malformed decoder output and unsafe component identities', async () => {
    expect(() => new IndependentFrameSequenceVisualQa(decoder({ id: '../decoder' }), identity())).toThrow('invalid visual QA component identity');
    const malformed = decoder({ async decode() { return { cellWidth: 191, cellHeight: HEIGHT, frames: [frame(70)] }; } });
    await expect(new IndependentFrameSequenceVisualQa(malformed, identity()).evaluate(request()))
      .rejects.toThrow('decoded atlas shape mismatch');
  });
});
