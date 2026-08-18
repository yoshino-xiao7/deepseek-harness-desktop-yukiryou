import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

interface WorkspaceAuthorityModule {
  authorizeWorkspace(registry: unknown, payload: unknown): Promise<unknown>;
}

async function loadModule(): Promise<WorkspaceAuthorityModule> {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'runtime', 'desktop-companion-plugin', 'index.js')).href;
  return import(moduleUrl) as Promise<WorkspaceAuthorityModule>;
}

describe('Runtime workspace authority', () => {
  it('returns the canonical registered root only for a member session', async () => {
    const { authorizeWorkspace } = await loadModule();
    const workspace = {
      id: 'workspace-1', title: 'Project', path: '/canonical/project',
      sessionIds: ['session-1'], status: vi.fn(async () => 'ok'),
    };
    const registry = { get: vi.fn(() => workspace), list: vi.fn(() => [workspace]) };

    await expect(authorizeWorkspace(registry, { sessionId: 'session-1', workspaceId: 'workspace-1' })).resolves.toEqual({
      status: 'authorized', workspaceId: 'workspace-1', title: 'Project', root: '/canonical/project',
    });
    expect(registry.get).toHaveBeenCalledWith('workspace-1');
  });

  it('rejects a mismatched session and malformed identifiers', async () => {
    const { authorizeWorkspace } = await loadModule();
    const workspace = { id: 'workspace-1', title: 'Project', path: '/canonical/project', sessionIds: ['other'], status: vi.fn(async () => 'ok') };
    const registry = { get: vi.fn(() => workspace), list: vi.fn(() => [workspace]) };

    await expect(authorizeWorkspace(registry, { sessionId: 'session-1', workspaceId: 'workspace-1' })).resolves.toEqual({ status: 'unavailable' });
    await expect(authorizeWorkspace(registry, { sessionId: '../escape' })).resolves.toBeUndefined();
    expect(workspace.status).not.toHaveBeenCalled();
  });
});
