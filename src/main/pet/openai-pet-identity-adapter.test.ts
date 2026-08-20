import { describe, expect, it, vi } from 'vitest';

import type { PetCreatorInput } from '../../shared/pet-authoring.js';
import { PET_MOTIONS, type PetMotion } from '../../shared/pet-package.js';
import type { PetVisualReference } from './frame-sequence-generation-orchestrator.js';
import { createIdentityContactSheet, OpenAiPetIdentityAdapter } from './openai-pet-identity-adapter.js';

const WIDTH = 192;
const HEIGHT = 208;

function input(): PetCreatorInput {
  return { schemaVersion: 1, locale: 'zh-CN', displayName: '测试宠物', request: '保持蓝发、鲸鱼尾巴和女仆服装。', references: [] };
}

function references(): readonly PetVisualReference[] {
  return [{ id: 'primary', role: 'primary', mediaType: 'image/png', bytes: Uint8Array.of(137, 80, 78, 71) }];
}

function samples(): ReadonlyMap<PetMotion, readonly Uint8ClampedArray[]> {
  return new Map(PET_MOTIONS.map((motion, row) => [motion, Array.from({ length: 5 }, (_, column) => {
    const frame = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    frame.set([row, column, 220, 255], 0);
    return frame;
  })]));
}

function response(score: number): Response {
  return new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ identityConsistency: score }) }] }],
  }), { headers: { 'content-type': 'application/json' } });
}

describe('OpenAiPetIdentityAdapter', () => {
  it('sends references plus one deterministic contact sheet and accepts only a structured score', async () => {
    const fetchMock = vi.fn(async (requestInput: string | URL | Request, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return response(94);
    });
    const adapter = new OpenAiPetIdentityAdapter({ apiKey: 'openai-test-secret', fetch: fetchMock as typeof fetch });

    await expect(adapter.evaluate({
      input: input(), references: references(), samples: samples(), cellWidth: WIDTH, cellHeight: HEIGHT,
      signal: new AbortController().signal,
    })).resolves.toEqual({ identityConsistency: 94 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer openai-test-secret');
    const body = JSON.parse(init?.body as string) as {
      model: string;
      store: boolean;
      text: { format: { type: string; strict: boolean } };
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
    };
    expect(body).toMatchObject({ model: 'gpt-5.6-luna', store: false, text: { format: { type: 'json_schema', strict: true } } });
    expect(body.input[0]!.content.filter((part: { type: string }) => part.type === 'input_image')).toHaveLength(2);
    expect(body.input[0]!.content.at(-1)!.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it('builds a bounded nine-row PNG contact sheet', () => {
    const png = createIdentityContactSheet(samples(), WIDTH, HEIGHT);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(WIDTH * 5);
    expect(view.getUint32(20)).toBe(HEIGHT * PET_MOTIONS.length);
  });

  it('fails closed on malformed provider output and classifies throttling as transient', async () => {
    const malformed = new OpenAiPetIdentityAdapter({
      apiKey: 'openai-test-secret',
      fetch: vi.fn(async () => response(101)) as typeof fetch,
    });
    await expect(malformed.evaluate({
      input: input(), references: references(), samples: samples(), cellWidth: WIDTH, cellHeight: HEIGHT,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'invalid-output' });

    const throttled = new OpenAiPetIdentityAdapter({
      apiKey: 'openai-test-secret',
      fetch: vi.fn(async () => new Response('provider details', { status: 429 })) as typeof fetch,
    });
    await expect(throttled.evaluate({
      input: input(), references: references(), samples: samples(), cellWidth: WIDTH, cellHeight: HEIGHT,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'transient', message: 'OpenAI identity HTTP 429' });
  });
});
