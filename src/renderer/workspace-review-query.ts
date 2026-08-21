import type { WorkspaceChange } from '../shared/workspace-review.js';

export type WorkspaceChangeScope =
  | 'all'
  | 'staged'
  | 'unstaged'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'conflicted';

export interface WorkspaceChangeQuery {
  readonly query: string;
  readonly scope: WorkspaceChangeScope;
}

export function filterWorkspaceChanges(
  changes: readonly WorkspaceChange[],
  filter: WorkspaceChangeQuery,
): WorkspaceChange[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return changes.filter((change) => (
    (query === '' || change.path.toLocaleLowerCase().includes(query))
    && matchesScope(change, filter.scope)
  ));
}

function matchesScope(change: WorkspaceChange, scope: WorkspaceChangeScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'staged') return change.staged;
  if (scope === 'unstaged') return !change.staged;
  if (scope === 'added') return change.status === 'added' || change.status === 'untracked';
  if (scope === 'modified') return change.status === 'modified' || change.status === 'renamed';
  return change.status === scope;
}
