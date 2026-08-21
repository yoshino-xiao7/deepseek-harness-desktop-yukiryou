import { describe, expect, it } from 'vitest';
import {
  validatedWorkspaceReviewShortcut,
  workspaceReviewShortcut,
} from './workspace-review-shortcuts.js';

describe('workspace review shortcuts', () => {
  it.each([
    [{ key: 'p', metaKey: true }, 'file-search'],
    [{ key: 'P', ctrlKey: true }, 'file-search'],
    [{ key: '[', metaKey: true }, 'preview-back'],
    [{ key: ']', ctrlKey: true }, 'preview-forward'],
    [{ key: 'p', meta: true }, 'file-search'],
    [{ key: '[', control: true }, 'preview-back'],
    [{ key: 'Escape' }, 'close-preview'],
  ] as const)('maps %o to %s', (event, expected) => {
    expect(workspaceReviewShortcut(event)).toBe(expected);
  });

  it.each([
    { key: 'p' },
    { key: 'p', metaKey: true, altKey: true },
    { key: '[', metaKey: true, shiftKey: true },
    { key: 'Escape', isComposing: true },
    { key: 'Escape', defaultPrevented: true },
  ])('ignores unrelated or already handled input %o', (event) => {
    expect(workspaceReviewShortcut(event)).toBeUndefined();
  });

  it('rejects unknown commands at the preload boundary', () => {
    expect(validatedWorkspaceReviewShortcut('file-search')).toBe('file-search');
    expect(validatedWorkspaceReviewShortcut('print')).toBeUndefined();
  });
});
