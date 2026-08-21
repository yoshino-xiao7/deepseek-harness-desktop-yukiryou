import { describe, expect, it } from 'vitest';

import type { WorkspaceReviewResponse } from '../shared/workspace-review.js';
import { createWorkspaceReviewController } from './workspace-review-controller.js';

type Overview = Extract<WorkspaceReviewResponse, { kind: 'overview' }>;
type Preview = Extract<WorkspaceReviewResponse, { kind: 'preview' }>;

describe('WorkspaceReviewController', () => {
  it('owns tab, query and scope state behind one command interface', () => {
    const controller = createWorkspaceReviewController();
    controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' });
    controller.execute({ kind: 'overview.replace', overview: overview() });
    controller.execute({ kind: 'tab.select', tab: 'files' });
    controller.execute({ kind: 'query.change', query: ' SRC ' });
    const result = controller.execute({ kind: 'scope.change', scope: 'unstaged' });

    expect(result.snapshot).toMatchObject({
      workspaceId: 'workspace-a', tab: 'files', query: ' SRC ', scope: 'unstaged',
    });
    expect(result.snapshot.visibleChanges.map((change) => change.path))
      .toEqual(['src/main.ts', 'src/conflict.ts']);
    expect(controller.execute({ kind: 'scope.change', scope: 'added' }).snapshot.visibleChanges)
      .toEqual([expect.objectContaining({ path: 'src/new.ts' })]);
  });

  it('keeps bounded preview navigation and clears it on workspace change', () => {
    const controller = createWorkspaceReviewController(2);
    controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' });
    controller.execute({ kind: 'preview.visit', preview: preview('a') });
    controller.execute({ kind: 'preview.visit', preview: preview('b') });
    controller.execute({ kind: 'preview.visit', preview: preview('c') });

    expect(controller.execute({ kind: 'preview.back' }).snapshot)
      .toMatchObject({ preview: { nodeId: 'b' }, canBack: false, canForward: true });
    expect(controller.execute({ kind: 'preview.visit', preview: preview('d') }).snapshot)
      .toMatchObject({ preview: { nodeId: 'd' }, canBack: true, canForward: false });
    expect(controller.execute({ kind: 'preview.forward' }).snapshot.preview?.nodeId).toBe('d');
    expect(controller.execute({ kind: 'preview.close' }).snapshot.preview).toBeUndefined();
    expect(controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-b' }).snapshot)
      .toMatchObject({ preview: undefined, canBack: false, canForward: false, query: '' });
  });

  it('preserves non-sensitive controls across a temporary authority loss', () => {
    const controller = createWorkspaceReviewController();
    controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' });
    controller.execute({ kind: 'overview.replace', overview: overview() });
    controller.execute({ kind: 'tab.select', tab: 'files' });
    controller.execute({ kind: 'query.change', query: 'needle' });
    controller.execute({ kind: 'preview.visit', preview: diffPreview('main') });

    expect(controller.execute({ kind: 'workspace.select', workspaceId: undefined }).snapshot)
      .toMatchObject({ workspaceId: undefined, overview: undefined, tab: 'files', query: 'needle', preview: undefined });
    expect(controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' }).snapshot)
      .toMatchObject({ workspaceId: 'workspace-a', tab: 'files', query: 'needle', preview: undefined });
    expect(controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-b' }).snapshot)
      .toMatchObject({ workspaceId: 'workspace-b', tab: 'changes', query: '' });
  });

  it('drives a filtered review queue and explicit viewed progress', () => {
    const controller = createWorkspaceReviewController();
    controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' });
    controller.execute({ kind: 'overview.replace', overview: overview() });
    controller.execute({ kind: 'query.change', query: 'src' });
    controller.execute({ kind: 'preview.visit', preview: diffPreview('main') });

    expect(controller.execute({ kind: 'review.toggle' }).snapshot.review).toMatchObject({
      total: 3, viewed: 1, position: 1, currentViewed: true, canPrevious: false, canNext: true,
    });
    expect(controller.execute({ kind: 'review.move', direction: 'next' }).effect)
      .toEqual({ kind: 'open-diff', nodeId: 'new' });
    controller.execute({ kind: 'preview.visit', preview: diffPreview('new') });
    expect(controller.execute({ kind: 'review.move', direction: 'previous' }).effect)
      .toEqual({ kind: 'open-diff', nodeId: 'main' });
    controller.execute({ kind: 'overview.replace', overview: overview() });
    expect(controller.getSnapshot().review.viewed).toBe(0);
  });

  it('owns preview find state and wraps matching navigation', () => {
    const controller = createWorkspaceReviewController();
    controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' });
    controller.execute({ kind: 'preview.visit', preview: preview('a') });

    expect(controller.execute({ kind: 'find.open' }).snapshot.find)
      .toMatchObject({ open: true, query: '', total: 0, position: undefined });
    expect(controller.execute({ kind: 'find.change', query: 'needle' }).snapshot.find)
      .toMatchObject({ open: true, query: 'needle', total: 0, position: undefined });
    expect(controller.execute({ kind: 'find.matches', total: 3 }).snapshot.find)
      .toMatchObject({ total: 3, position: 1, canPrevious: true, canNext: true });
    expect(controller.execute({ kind: 'find.move', direction: 'next' }).snapshot.find.position)
      .toBe(2);
    expect(controller.execute({ kind: 'find.move', direction: 'previous' }).snapshot.find.position)
      .toBe(1);
    expect(controller.execute({ kind: 'find.move', direction: 'previous' }).snapshot.find.position)
      .toBe(3);

    expect(controller.execute({ kind: 'preview.visit', preview: preview('b') }).snapshot.find)
      .toMatchObject({ open: true, query: 'needle', total: 0, position: undefined });
    expect(controller.execute({ kind: 'find.close' }).snapshot.find)
      .toEqual({ open: false, query: '', total: 0, position: undefined, canPrevious: false, canNext: false });
  });

  it('selects a preview line and produces bounded copy effects', () => {
    const controller = createWorkspaceReviewController();
    controller.execute({ kind: 'workspace.select', workspaceId: 'workspace-a' });
    controller.execute({ kind: 'preview.visit', preview: preview('a') });

    expect(controller.execute({ kind: 'copy.request', target: 'path' }).effect)
      .toEqual({ kind: 'copy-text', text: 'a.txt', label: '路径' });
    expect(controller.execute({ kind: 'copy.request', target: 'line' }).effect)
      .toBeUndefined();
    expect(controller.execute({ kind: 'line.select', line: 12 }).snapshot.selectedLine)
      .toBe(12);
    expect(controller.execute({ kind: 'copy.request', target: 'line' }).effect)
      .toEqual({ kind: 'copy-text', text: '12', label: '行号' });
    expect(controller.execute({ kind: 'copy.request', target: 'path-line' }).effect)
      .toEqual({ kind: 'copy-text', text: 'a.txt:12', label: '路径和行号' });
    expect(controller.execute({ kind: 'line.select', line: 0 }).snapshot.selectedLine)
      .toBeUndefined();
    expect(controller.execute({ kind: 'preview.visit', preview: preview('b') }).snapshot.selectedLine)
      .toBeUndefined();
  });
});

function overview(): Overview {
  return {
    kind: 'overview', rootName: 'fixture', nodes: [], gitAvailable: true, truncated: false,
    changes: [
      { nodeId: 'main', path: 'src/main.ts', status: 'modified', staged: false, additions: 2, deletions: 1 },
      { nodeId: 'new', path: 'src/new.ts', status: 'added', staged: true, additions: 4, deletions: 0 },
      { path: 'docs/old.md', status: 'deleted', staged: false },
      { nodeId: 'conflict', path: 'src/conflict.ts', status: 'conflicted', staged: false },
    ],
  };
}

function preview(nodeId: string): Preview {
  return {
    kind: 'preview', nodeId, name: `${nodeId}.txt`, path: `${nodeId}.txt`,
    content: { kind: 'text', text: nodeId, truncated: false },
  };
}

function diffPreview(nodeId: string): Preview {
  return {
    kind: 'preview', nodeId, name: `${nodeId}.ts`, path: `src/${nodeId}.ts`,
    content: { kind: 'diff', text: '+changed', truncated: false, additions: 1, deletions: 0 },
  };
}
