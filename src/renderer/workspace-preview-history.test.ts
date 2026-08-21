import { describe, expect, it } from 'vitest';

import type { WorkspaceReviewResponse } from '../shared/workspace-review.js';
import { createWorkspacePreviewHistory } from './workspace-preview-history.js';

type Preview = Extract<WorkspaceReviewResponse, { kind: 'preview' }>;

describe('Workspace preview history', () => {
  it('navigates backward and forward through visited previews', () => {
    const history = createWorkspacePreviewHistory();
    history.visit(preview('a'));
    history.visit(preview('b'));
    history.visit(preview('c'));

    expect(history.back()).toMatchObject({ current: { nodeId: 'b' }, canBack: true, canForward: true });
    expect(history.back()).toMatchObject({ current: { nodeId: 'a' }, canBack: false, canForward: true });
    expect(history.forward()).toMatchObject({ current: { nodeId: 'b' }, canBack: true, canForward: true });
  });

  it('drops the forward branch when a new preview is visited after going back', () => {
    const history = createWorkspacePreviewHistory();
    history.visit(preview('a'));
    history.visit(preview('b'));
    history.visit(preview('c'));
    history.back();

    expect(history.visit(preview('d'))).toMatchObject({
      current: { nodeId: 'd' }, canBack: true, canForward: false,
    });
    expect(history.forward().current?.nodeId).toBe('d');
  });

  it('replaces duplicate current entries, enforces capacity, and clears on workspace change', () => {
    const history = createWorkspacePreviewHistory(3);
    history.visit(preview('a'));
    history.visit(preview('b'));
    history.visit(preview('b', 'updated'));
    history.visit(preview('c'));
    history.visit(preview('d'));

    expect(history.back().current?.nodeId).toBe('c');
    expect(history.back().current?.nodeId).toBe('b');
    expect(history.back().current?.nodeId).toBe('b');
    expect(history.clear()).toEqual({ current: undefined, canBack: false, canForward: false });
  });
});

function preview(nodeId: string, text = nodeId): Preview {
  return {
    kind: 'preview',
    nodeId,
    name: `${nodeId}.txt`,
    path: `${nodeId}.txt`,
    content: { kind: 'text', text, truncated: false },
  };
}
