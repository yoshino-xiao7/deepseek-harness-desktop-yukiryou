import type { HarnessContextSnapshot } from '../../shared/desktop-companion.js';
import type { WorkspaceAuthority } from '../runtime/runtime-companion-client.js';

export interface ActiveWorkspaceAuthority extends WorkspaceAuthority {
  readonly sessionId: string;
}

export interface RuntimeAuthorityIdentity {
  readonly origin: string;
  readonly token: string;
}

export function reusableWorkspaceAuthority(
  current: ActiveWorkspaceAuthority | undefined,
  snapshot: HarnessContextSnapshot,
): ActiveWorkspaceAuthority | undefined {
  if (
    current === undefined ||
    snapshot.sessionId !== current.sessionId ||
    (snapshot.workspaceId !== undefined && snapshot.workspaceId !== current.workspaceId)
  ) return undefined;
  return current;
}

export function workspaceRetryDelay(attempt: number): number {
  return Math.min(5_000, 500 * 2 ** Math.max(0, Math.min(attempt, 4)));
}

export function shouldRetryWorkspaceAuthority(attempt: number): boolean {
  return attempt < 5;
}

export function runtimeAuthorityIdentityMatches(
  expected: RuntimeAuthorityIdentity,
  current: RuntimeAuthorityIdentity | undefined,
): boolean {
  return current !== undefined &&
    current.origin === expected.origin &&
    current.token === expected.token;
}
