import type {
  WorkspaceChange,
  WorkspaceReviewResponse,
} from '../shared/workspace-review.js';

export type WorkspaceReviewTab = 'changes' | 'files';
export type WorkspaceChangeScope =
  | 'all'
  | 'staged'
  | 'unstaged'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'conflicted';
export type WorkspacePreview = Extract<WorkspaceReviewResponse, { kind: 'preview' }>;
export type WorkspaceOverview = Extract<WorkspaceReviewResponse, { kind: 'overview' }>;

export type WorkspaceReviewCommand =
  | { readonly kind: 'workspace.select'; readonly workspaceId: string | undefined }
  | { readonly kind: 'overview.replace'; readonly overview: WorkspaceOverview }
  | { readonly kind: 'tab.select'; readonly tab: WorkspaceReviewTab }
  | { readonly kind: 'query.change'; readonly query: string }
  | { readonly kind: 'scope.change'; readonly scope: WorkspaceChangeScope }
  | { readonly kind: 'preview.visit'; readonly preview: WorkspacePreview }
  | { readonly kind: 'preview.back' }
  | { readonly kind: 'preview.forward' }
  | { readonly kind: 'preview.close' }
  | { readonly kind: 'preview.clear' }
  | { readonly kind: 'find.open' }
  | { readonly kind: 'find.change'; readonly query: string }
  | { readonly kind: 'find.matches'; readonly total: number }
  | { readonly kind: 'find.move'; readonly direction: 'previous' | 'next' }
  | { readonly kind: 'find.close' }
  | { readonly kind: 'review.toggle' }
  | { readonly kind: 'review.move'; readonly direction: 'previous' | 'next' };

export interface WorkspaceReviewProgress {
  readonly total: number;
  readonly viewed: number;
  readonly position: number | undefined;
  readonly currentViewed: boolean;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly viewedNodeIds: readonly string[];
}

export interface WorkspacePreviewFind {
  readonly open: boolean;
  readonly query: string;
  readonly total: number;
  readonly position: number | undefined;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
}

export interface WorkspaceReviewSnapshot {
  readonly workspaceId: string | undefined;
  readonly overview: WorkspaceOverview | undefined;
  readonly tab: WorkspaceReviewTab;
  readonly query: string;
  readonly scope: WorkspaceChangeScope;
  readonly visibleChanges: readonly WorkspaceChange[];
  readonly preview: WorkspacePreview | undefined;
  readonly canBack: boolean;
  readonly canForward: boolean;
  readonly find: WorkspacePreviewFind;
  readonly review: WorkspaceReviewProgress;
}

export type WorkspaceReviewEffect = {
  readonly kind: 'open-diff';
  readonly nodeId: string;
};

export interface WorkspaceReviewTransition {
  readonly snapshot: WorkspaceReviewSnapshot;
  readonly effect?: WorkspaceReviewEffect;
}

export interface WorkspaceReviewController {
  getSnapshot(): WorkspaceReviewSnapshot;
  execute(command: WorkspaceReviewCommand): WorkspaceReviewTransition;
}

export function createWorkspaceReviewController(historyLimit = 50): WorkspaceReviewController {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new Error('Workspace preview history limit must be a positive integer');
  }
  let workspaceId: string | undefined;
  let lastWorkspaceId: string | undefined;
  let overview: WorkspaceOverview | undefined;
  let tab: WorkspaceReviewTab = 'changes';
  let query = '';
  let scope: WorkspaceChangeScope = 'all';
  let previewOpen = false;
  const history: WorkspacePreview[] = [];
  let historyIndex = -1;
  const viewed = new Set<string>();
  let findOpen = false;
  let findQuery = '';
  let findTotal = 0;
  let findPosition: number | undefined;

  const clearFind = (): void => {
    findOpen = false;
    findQuery = '';
    findTotal = 0;
    findPosition = undefined;
  };

  const resetFindMatches = (): void => {
    findTotal = 0;
    findPosition = undefined;
  };

  const currentPreview = (): WorkspacePreview | undefined => (
    previewOpen ? history[historyIndex] : undefined
  );

  const snapshot = (): WorkspaceReviewSnapshot => {
    const visibleChanges = filterWorkspaceChanges(overview?.changes ?? [], { query, scope });
    const queue = visibleChanges.filter(hasNodeId);
    const preview = currentPreview();
    const currentIndex = preview?.content.kind === 'diff'
      ? queue.findIndex((change) => change.nodeId === preview.nodeId)
      : -1;
    return {
      workspaceId,
      overview,
      tab,
      query,
      scope,
      visibleChanges,
      preview,
      canBack: historyIndex > 0,
      canForward: historyIndex >= 0 && historyIndex < history.length - 1,
      find: {
        open: findOpen,
        query: findQuery,
        total: findTotal,
        position: findPosition,
        canPrevious: findTotal > 1,
        canNext: findTotal > 1,
      },
      review: {
        total: queue.length,
        viewed: queue.filter((change) => viewed.has(change.nodeId)).length,
        position: currentIndex >= 0 ? currentIndex + 1 : undefined,
        currentViewed: preview?.content.kind === 'diff' && viewed.has(preview.nodeId),
        canPrevious: currentIndex > 0,
        canNext: currentIndex < queue.length - 1,
        viewedNodeIds: [...viewed],
      },
    };
  };

  const transition = (effect?: WorkspaceReviewEffect): WorkspaceReviewTransition => ({
    snapshot: snapshot(),
    ...(effect === undefined ? {} : { effect }),
  });

  return {
    getSnapshot: snapshot,
    execute(command): WorkspaceReviewTransition {
      if (command.kind === 'workspace.select') {
        if (command.workspaceId === undefined) {
          workspaceId = undefined;
          overview = undefined;
          previewOpen = false;
          history.splice(0);
          historyIndex = -1;
          viewed.clear();
          clearFind();
        } else if (lastWorkspaceId !== command.workspaceId) {
          workspaceId = command.workspaceId;
          lastWorkspaceId = command.workspaceId;
          overview = undefined;
          tab = 'changes';
          query = '';
          scope = 'all';
          previewOpen = false;
          history.splice(0);
          historyIndex = -1;
          viewed.clear();
          clearFind();
        } else {
          workspaceId = command.workspaceId;
        }
        return transition();
      }
      if (command.kind === 'overview.replace') {
        overview = command.overview;
        viewed.clear();
        return transition();
      }
      if (command.kind === 'tab.select') tab = command.tab;
      else if (command.kind === 'query.change') query = command.query;
      else if (command.kind === 'scope.change') scope = command.scope;
      else if (command.kind === 'preview.visit') {
        const current = history[historyIndex];
        if (current !== undefined && previewIdentity(current) === previewIdentity(command.preview)) {
          history[historyIndex] = command.preview;
        } else {
          history.splice(historyIndex + 1);
          history.push(command.preview);
          if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
          historyIndex = history.length - 1;
        }
        previewOpen = true;
        resetFindMatches();
      } else if (command.kind === 'preview.back') {
        if (historyIndex > 0) historyIndex -= 1;
        previewOpen = historyIndex >= 0;
        resetFindMatches();
      } else if (command.kind === 'preview.forward') {
        if (historyIndex < history.length - 1) historyIndex += 1;
        previewOpen = historyIndex >= 0;
        resetFindMatches();
      } else if (command.kind === 'preview.close') {
        previewOpen = false;
        clearFind();
      } else if (command.kind === 'preview.clear') {
        previewOpen = false;
        history.splice(0);
        historyIndex = -1;
        clearFind();
      } else if (command.kind === 'find.open') {
        findOpen = currentPreview() !== undefined;
      } else if (command.kind === 'find.change') {
        findOpen = currentPreview() !== undefined;
        findQuery = command.query;
        resetFindMatches();
      } else if (command.kind === 'find.matches') {
        const total = findQuery === '' || !Number.isSafeInteger(command.total)
          ? 0
          : Math.max(0, command.total);
        findTotal = total;
        findPosition = total === 0 ? undefined : Math.min(findPosition ?? 1, total);
      } else if (command.kind === 'find.move') {
        if (findTotal > 0) {
          const position = findPosition ?? 1;
          findPosition = command.direction === 'next'
            ? position === findTotal ? 1 : position + 1
            : position === 1 ? findTotal : position - 1;
        }
      } else if (command.kind === 'find.close') {
        clearFind();
      } else if (command.kind === 'review.toggle') {
        const preview = currentPreview();
        if (preview?.content.kind === 'diff' && overview?.changes.some((change) => change.nodeId === preview.nodeId) === true) {
          if (viewed.has(preview.nodeId)) viewed.delete(preview.nodeId);
          else viewed.add(preview.nodeId);
        }
      } else if (command.kind === 'review.move') {
        const state = snapshot();
        const queue = state.visibleChanges.filter(hasNodeId);
        const currentIndex = state.preview?.content.kind === 'diff'
          ? queue.findIndex((change) => change.nodeId === state.preview?.nodeId)
          : -1;
        const targetIndex = command.direction === 'previous'
          ? currentIndex - 1
          : currentIndex + 1;
        const target = queue[targetIndex];
        return transition(target === undefined ? undefined : { kind: 'open-diff', nodeId: target.nodeId });
      }
      return transition();
    },
  };
}

function filterWorkspaceChanges(
  changes: readonly WorkspaceChange[],
  filter: { readonly query: string; readonly scope: WorkspaceChangeScope },
): WorkspaceChange[] {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();
  return changes.filter((change) => (
    (normalizedQuery === '' || change.path.toLocaleLowerCase().includes(normalizedQuery))
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

function hasNodeId(change: WorkspaceChange): change is WorkspaceChange & { readonly nodeId: string } {
  return change.nodeId !== undefined;
}

function previewIdentity(preview: WorkspacePreview): string {
  return `${preview.nodeId}\u0000${preview.path}\u0000${preview.content.kind}`;
}
