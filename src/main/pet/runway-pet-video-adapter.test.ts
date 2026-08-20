import { describe, expect, it, vi } from 'vitest';

import { PET_MOTION_GENERATION_SPECS } from './frame-sequence-generation-orchestrator.js';
import { createPngHeader } from './pet-package-test-helper.js';
import { RunwayPetVideoAdapter } from './runway-pet-video-adapter.js';

const taskId = '497f6eca-6276-4993-bfeb-53cbbbba6f08';

function request(signal = new AbortController().signal) {
  return {
    inputRequest: '保持蓝色女仆鲸鱼角色身份和服装完全一致。',
    canonicalLook: {
      id: 'canonical-look',
      role: 'canonical-look' as const,
      mediaType: 'image/png' as const,
      bytes: createPngHeader({ width: 512, height: 512 }),
    },
    spec: PET_MOTION_GENERATION_SPECS.eating,
    signal,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('RunwayPetVideoAdapter', () => {
  it('creates, polls, downloads and deletes a pinned Gen-4.5 motion task', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/image_to_video')) return json({ id: taskId });
      if (url.endsWith(`/tasks/${taskId}`) && init?.method === 'GET') {
        const polls = fetchMock.mock.calls.filter(([candidate, options]) => String(candidate).endsWith(`/tasks/${taskId}`) && options?.method === 'GET').length;
        return polls === 1
          ? json({ id: taskId, status: 'PENDING' })
          : json({ id: taskId, status: 'SUCCEEDED', output: ['https://media.example.test/pet.mp4'] });
      }
      if (url === 'https://media.example.test/pet.mp4') {
        return new Response(Uint8Array.of(0, 0, 0, 24), { headers: { 'content-type': 'video/mp4', 'content-length': '4' } });
      }
      if (url.endsWith(`/tasks/${taskId}`) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected request: ${url}`);
    });
    const wait = vi.fn(async () => undefined);
    const adapter = new RunwayPetVideoAdapter({ apiKey: 'runway-test-secret', fetch: fetchMock as typeof fetch, wait });

    const result = await adapter.generate(request());

    expect(result).toEqual({ mediaType: 'video/mp4', bytes: Uint8Array.of(0, 0, 0, 24), sourceDurationMs: 4_000 });
    expect(wait).toHaveBeenCalledWith(5_000, expect.any(AbortSignal));
    const createCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/image_to_video'))!;
    const headers = createCall[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer runway-test-secret');
    expect(headers.get('X-Runway-Version')).toBe('2024-11-06');
    const body = JSON.parse(createCall[1]?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'gen4.5', ratio: '960:960', duration: 4 });
    expect(body.promptImage).toMatch(/^data:image\/png;base64,/);
    expect(body.promptText).toContain('Eat rapidly');
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith(`/tasks/${taskId}`) && init?.method === 'DELETE')).toBe(true);
  });

  it('maps safety rejection to a non-retryable policy error and deletes the remote task', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/image_to_video')) return json({ id: taskId });
      if (url.endsWith(`/tasks/${taskId}`) && init?.method === 'GET') {
        return json({ id: taskId, status: 'FAILED', failureCode: 'SAFETY.INPUT.IMAGE' });
      }
      if (url.endsWith(`/tasks/${taskId}`) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected request: ${url}`);
    });
    const adapter = new RunwayPetVideoAdapter({ apiKey: 'runway-test-secret', fetch: fetchMock as typeof fetch });

    await expect(adapter.generate(request())).rejects.toMatchObject({ code: 'policy-rejected' });
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith(`/tasks/${taskId}`) && init?.method === 'DELETE')).toBe(true);
  });

  it('rejects unsafe output URLs before download', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/image_to_video')) return json({ id: taskId });
      if (url.endsWith(`/tasks/${taskId}`) && init?.method === 'GET') {
        return json({ id: taskId, status: 'SUCCEEDED', output: ['http://media.example.test/pet.mp4'] });
      }
      if (url.endsWith(`/tasks/${taskId}`) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected request: ${url}`);
    });
    const adapter = new RunwayPetVideoAdapter({ apiKey: 'runway-test-secret', fetch: fetchMock as typeof fetch });

    await expect(adapter.generate(request())).rejects.toMatchObject({ code: 'invalid-output' });
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('http://'))).toBe(false);
  });

  it('classifies throttling and server failures as transient without exposing response bodies', async () => {
    for (const status of [429, 503]) {
      const fetchMock = vi.fn(async () => new Response('secret provider diagnostics', { status }));
      const adapter = new RunwayPetVideoAdapter({ apiKey: 'runway-test-secret', fetch: fetchMock as typeof fetch });
      await expect(adapter.generate(request())).rejects.toMatchObject({ code: 'transient', message: `Runway HTTP ${status}` });
    }
  });
});
