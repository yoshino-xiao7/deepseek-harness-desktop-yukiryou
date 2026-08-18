import { describe, expect, it } from 'vitest';

import {
  createReviewTargetStore,
  validatedChangedFileReviewIntent,
  validatedChangedFilePath,
  validatedWorkspaceReviewRequest,
} from './workspace-review.js';

describe('workspace review request boundary', () => {
  it('accepts opaque node identifiers only', () => {
    expect(validatedWorkspaceReviewRequest({ kind: 'file.preview', nodeId: 'Abcdefghijklmnop_1' })).toEqual({ kind: 'file.preview', nodeId: 'Abcdefghijklmnop_1' });
    expect(validatedWorkspaceReviewRequest({ kind: 'change.diff', nodeId: 'Abcdefghijklmnop_1' })).toEqual({ kind: 'change.diff', nodeId: 'Abcdefghijklmnop_1' });
    expect(validatedWorkspaceReviewRequest({ kind: 'file.preview', nodeId: '/Users/example/secret' })).toBeUndefined();
    expect(validatedWorkspaceReviewRequest({ kind: 'directory.list', nodeId: '../escape' })).toBeUndefined();
  });

  it('accepts only bounded workspace-relative changed-file paths', () => {
    expect(validatedChangedFilePath('src/main/app.ts')).toBe('src/main/app.ts');
    expect(validatedChangedFilePath('/Users/example/secret')).toBeUndefined();
    expect(validatedChangedFilePath('../secret')).toBeUndefined();
    expect(validatedChangedFilePath('C:\\secret.txt')).toBeUndefined();
    expect(validatedChangedFilePath('src/bad\nname.ts')).toBeUndefined();
  });

  it('accepts a bounded historical diff and rejects oversized renderer input', () => {
    expect(validatedChangedFileReviewIntent({
      path: 'README.md',
      historicalDiff: { text: '@@ -1 +1 @@\n-old\n+new\n', additions: 1, deletions: 1 },
    })).toEqual({
      path: 'README.md',
      historicalDiff: { text: '@@ -1 +1 @@\n-old\n+new\n', additions: 1, deletions: 1 },
    });
    expect(validatedChangedFileReviewIntent({
      path: 'README.md', historicalDiff: { text: 'x'.repeat(2 * 1024 * 1024 + 1), additions: 1, deletions: 0 },
    })).toBeUndefined();
  });

  it('replays a preview that arrives before the renderer subscribes', () => {
    const store = createReviewTargetStore();
    const preview = {
      kind: 'preview' as const,
      nodeId: 'Abcdefghijklmnop_1',
      name: 'README.md',
      path: 'README.md',
      content: { kind: 'markdown' as const, text: '# History', truncated: false },
    };
    store.publish(preview);
    const received: unknown[] = [];

    store.subscribe((value) => received.push(value));

    expect(received).toEqual([preview]);
  });

  it('releases the replayed preview when its workspace capability changes', () => {
    const store = createReviewTargetStore();
    store.publish({
      kind: 'preview',
      nodeId: 'Abcdefghijklmnop_1',
      name: 'large.png',
      path: 'large.png',
      content: { kind: 'image', dataUrl: `data:image/png;base64,${'a'.repeat(10_000)}` },
    });
    store.clear();
    const received: unknown[] = [];

    store.subscribe((value) => received.push(value));

    expect(received).toEqual([]);
  });
});
