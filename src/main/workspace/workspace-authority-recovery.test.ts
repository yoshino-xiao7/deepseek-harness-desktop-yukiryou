import { describe, expect, it } from 'vitest';

import {
  runtimeAuthorityIdentityMatches,
  reusableWorkspaceAuthority,
  shouldRetryWorkspaceAuthority,
  workspaceRetryDelay,
} from './workspace-authority-recovery.js';

const authority = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  title: 'deepseek',
  root: '/workspace/deepseek',
};

describe('workspace authority recovery', () => {
  it('keeps verified authority while the same session temporarily loses its workspace listing', () => {
    expect(reusableWorkspaceAuthority(authority, {
      revision: 2,
      sessionId: 'session-1',
      running: true,
    })).toBe(authority);
  });

  it('revokes reuse when the session or explicit workspace changes', () => {
    expect(reusableWorkspaceAuthority(authority, {
      revision: 3,
      sessionId: 'session-2',
      workspaceId: 'workspace-1',
      running: false,
    })).toBeUndefined();
    expect(reusableWorkspaceAuthority(authority, {
      revision: 4,
      sessionId: 'session-1',
      workspaceId: 'workspace-2',
      running: false,
    })).toBeUndefined();
  });

  it('uses bounded retry backoff instead of abandoning the workspace', () => {
    expect([0, 1, 2, 3, 4].map(workspaceRetryDelay)).toEqual([
      500, 1_000, 2_000, 4_000, 5_000,
    ]);
    expect([0, 1, 2, 3, 4, 5].map(shouldRetryWorkspaceAuthority)).toEqual([
      true, true, true, true, true, false,
    ]);
  });

  it('rejects an authority result from a replaced Runtime identity', () => {
    const expected = { origin: 'http://127.0.0.1:50001', token: 'old-token' };
    expect(runtimeAuthorityIdentityMatches(expected, expected)).toBe(true);
    expect(runtimeAuthorityIdentityMatches(expected, {
      origin: 'http://127.0.0.1:50002', token: 'new-token',
    })).toBe(false);
    expect(runtimeAuthorityIdentityMatches(expected, undefined)).toBe(false);
  });
});
