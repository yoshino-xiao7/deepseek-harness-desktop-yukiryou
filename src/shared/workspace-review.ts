export const WORKSPACE_REVIEW_REQUEST_CHANNEL = 'deepseek-yukiryou:workspace-review:request';
export const HARNESS_REVIEW_INTENT_CHANNEL = 'deepseek-yukiryou:workspace-review:harness-intent';
export const SHELL_REVIEW_TARGET_CHANNEL = 'deepseek-yukiryou:workspace-review:shell-target';

export type WorkspaceNodeKind = 'directory' | 'file';

export interface WorkspaceNode {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceNodeKind;
  readonly extension?: string;
}

export interface WorkspaceChange {
  readonly nodeId?: string;
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  readonly staged: boolean;
  readonly additions?: number;
  readonly deletions?: number;
}

export interface HistoricalDiff {
  readonly text: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface ChangedFileReviewIntent {
  readonly path: string;
  readonly historicalDiff?: HistoricalDiff;
}

export type WorkspaceReviewRequest =
  | { readonly kind: 'overview' }
  | { readonly kind: 'directory.list'; readonly nodeId: string }
  | { readonly kind: 'file.preview'; readonly nodeId: string }
  | { readonly kind: 'change.diff'; readonly nodeId: string };

export type WorkspaceReviewResponse =
  | {
      readonly kind: 'overview';
      readonly rootName: string;
      readonly nodes: readonly WorkspaceNode[];
      readonly changes: readonly WorkspaceChange[];
      readonly gitAvailable: boolean;
      readonly truncated: boolean;
    }
  | { readonly kind: 'directory'; readonly parentId: string; readonly nodes: readonly WorkspaceNode[]; readonly truncated: boolean }
  | {
      readonly kind: 'preview';
      readonly nodeId: string;
      readonly name: string;
      readonly path: string;
      readonly content:
        | { readonly kind: 'markdown' | 'text'; readonly text: string; readonly truncated: boolean }
        | { readonly kind: 'diff'; readonly text: string; readonly truncated: boolean; readonly additions: number; readonly deletions: number }
        | { readonly kind: 'image'; readonly dataUrl: string }
        | { readonly kind: 'unsupported'; readonly reason: 'binary' | 'invalid-encoding' | 'too-large' | 'unsupported-type' };
    }
  | { readonly kind: 'unavailable'; readonly reason: 'no-workspace' | 'invalid-node' | 'file-changed' | 'io-error' };

type WorkspaceReviewPreview = Extract<WorkspaceReviewResponse, { kind: 'preview' }>;

export function createReviewTargetStore(): {
  publish(preview: WorkspaceReviewPreview): void;
  clear(): void;
  subscribe(listener: (preview: WorkspaceReviewPreview | undefined) => void): () => void;
} {
  const listeners = new Set<(preview: WorkspaceReviewPreview | undefined) => void>();
  let latest: WorkspaceReviewPreview | undefined;
  return {
    publish(preview): void {
      latest = preview;
      for (const listener of listeners) listener(preview);
    },
    clear(): void {
      latest = undefined;
      for (const listener of listeners) listener(undefined);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      if (latest !== undefined) listener(latest);
      return () => listeners.delete(listener);
    },
  };
}

const NODE_ID = /^[A-Za-z0-9_-]{16,128}$/;

export function validatedWorkspaceReviewRequest(value: unknown): WorkspaceReviewRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'overview') return { kind: 'overview' };
  if ((value.kind === 'directory.list' || value.kind === 'file.preview' || value.kind === 'change.diff') && typeof value.nodeId === 'string' && NODE_ID.test(value.nodeId)) {
    return { kind: value.kind, nodeId: value.nodeId };
  }
  return undefined;
}

export function validatedChangedFilePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) return undefined;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value) || Array.from(value).some(isControlCharacter)) return undefined;
  const segments = value.split(/[\\/]/);
  return segments.some((segment) => segment === '' || segment === '..') ? undefined : value;
}

export function validatedChangedFileReviewIntent(value: unknown): ChangedFileReviewIntent | undefined {
  if (typeof value === 'string') {
    const path = validatedChangedFilePath(value);
    return path === undefined ? undefined : { path };
  }
  if (!isRecord(value)) return undefined;
  const path = validatedChangedFilePath(value.path);
  if (path === undefined) return undefined;
  if (value.historicalDiff === undefined) return { path };
  if (!isRecord(value.historicalDiff)) return undefined;
  const { text, additions, deletions } = value.historicalDiff;
  if (
    typeof text !== 'string' || text.length === 0 || new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024
    || !Number.isSafeInteger(additions) || (additions as number) < 0 || (additions as number) > 1_000_000
    || !Number.isSafeInteger(deletions) || (deletions as number) < 0 || (deletions as number) > 1_000_000
  ) return undefined;
  return { path, historicalDiff: { text, additions: additions as number, deletions: deletions as number } };
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
