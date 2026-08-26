import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeCompanionClient } from './runtime-companion-client.js';

describe('runtime companion client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('leaves retry scheduling to the coordinator after one bounded request', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response('{"status":"unavailable"}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRuntimeCompanionClient('test-token').authorizeWorkspace(
      'http://127.0.0.1:50981',
      { sessionId: 'session-1', workspaceId: 'workspace-1' },
    )).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledWith(2_000);
  });

  it('accepts one valid canonical workspace authority', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'authorized',
      workspaceId: 'workspace-1',
      title: 'deepseek',
      root: '/workspace/deepseek',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRuntimeCompanionClient('test-token').authorizeWorkspace(
      'http://127.0.0.1:50981',
      { sessionId: 'session-1', workspaceId: 'workspace-1' },
    )).resolves.toEqual({
      workspaceId: 'workspace-1',
      title: 'deepseek',
      root: '/workspace/deepseek',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
