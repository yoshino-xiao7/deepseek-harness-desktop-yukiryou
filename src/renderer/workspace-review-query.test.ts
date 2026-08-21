import { describe, expect, it } from 'vitest';

import type { WorkspaceChange } from '../shared/workspace-review.js';
import { filterWorkspaceChanges } from './workspace-review-query.js';

const changes: WorkspaceChange[] = [
  { path: 'src/main.ts', status: 'modified', staged: false, additions: 2, deletions: 1 },
  { path: 'src/new.ts', status: 'added', staged: true, additions: 4, deletions: 0 },
  { path: 'docs/old.md', status: 'deleted', staged: false },
  { path: 'src/conflict.ts', status: 'conflicted', staged: false },
];

describe('Workspace Review change query', () => {
  it('combines normalized path search with staging scope', () => {
    expect(filterWorkspaceChanges(changes, { query: ' SRC ', scope: 'unstaged' }))
      .toEqual([changes[0], changes[3]]);
  });

  it('filters semantic status groups without mutating the overview', () => {
    expect(filterWorkspaceChanges(changes, { query: '', scope: 'added' }))
      .toEqual([changes[1]]);
    expect(filterWorkspaceChanges(changes, { query: '', scope: 'conflicted' }))
      .toEqual([changes[3]]);
    expect(changes).toHaveLength(4);
  });
});
