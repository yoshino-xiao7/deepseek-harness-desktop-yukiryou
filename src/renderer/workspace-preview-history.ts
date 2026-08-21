import type { WorkspaceReviewResponse } from '../shared/workspace-review.js';

export type WorkspacePreview = Extract<WorkspaceReviewResponse, { kind: 'preview' }>;

export interface WorkspacePreviewHistorySnapshot {
  readonly current: WorkspacePreview | undefined;
  readonly canBack: boolean;
  readonly canForward: boolean;
}

export interface WorkspacePreviewHistory {
  getSnapshot(): WorkspacePreviewHistorySnapshot;
  visit(preview: WorkspacePreview): WorkspacePreviewHistorySnapshot;
  back(): WorkspacePreviewHistorySnapshot;
  forward(): WorkspacePreviewHistorySnapshot;
  clear(): WorkspacePreviewHistorySnapshot;
}

export function createWorkspacePreviewHistory(limit = 50): WorkspacePreviewHistory {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Workspace preview history limit must be a positive integer');
  }
  const entries: WorkspacePreview[] = [];
  let index = -1;

  const snapshot = (): WorkspacePreviewHistorySnapshot => ({
    current: entries[index],
    canBack: index > 0,
    canForward: index >= 0 && index < entries.length - 1,
  });

  return {
    getSnapshot: snapshot,
    visit(preview): WorkspacePreviewHistorySnapshot {
      const current = entries[index];
      if (current !== undefined && previewIdentity(current) === previewIdentity(preview)) {
        entries[index] = preview;
        return snapshot();
      }
      entries.splice(index + 1);
      entries.push(preview);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      index = entries.length - 1;
      return snapshot();
    },
    back(): WorkspacePreviewHistorySnapshot {
      if (index > 0) index -= 1;
      return snapshot();
    },
    forward(): WorkspacePreviewHistorySnapshot {
      if (index < entries.length - 1) index += 1;
      return snapshot();
    },
    clear(): WorkspacePreviewHistorySnapshot {
      entries.splice(0);
      index = -1;
      return snapshot();
    },
  };
}

function previewIdentity(preview: WorkspacePreview): string {
  return `${preview.nodeId}\u0000${preview.path}\u0000${preview.content.kind}`;
}
