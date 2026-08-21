import { describe, expect, it } from 'vitest';

import {
  appendWorkspaceConversationReference,
  validatedWorkspaceConversationReference,
  validatedWorkspaceConversationInsertion,
  workspaceConversationInsertion,
  workspaceConversationReferenceText,
} from './workspace-conversation-reference.js';

const target = { sessionId: 'session-1', workspaceId: 'workspace-1' } as const;

describe('workspace conversation references', () => {
  it('formats files using the Harness file mention grammar', () => {
    expect(workspaceConversationReferenceText({
      kind: 'file', ...target, path: 'src/main.ts',
    })).toBe('@src/main.ts');
    expect(workspaceConversationReferenceText({
      kind: 'file', ...target, path: 'docs/my plan.md',
    })).toBe('@"docs/my plan.md"');
    expect(workspaceConversationReferenceText({
      kind: 'directory', ...target, path: 'src/components',
    })).toBe('@src/components/');
    expect(workspaceConversationReferenceText({
      kind: 'directory', ...target, path: 'docs/my plans',
    })).toBe('@"docs/my plans/"');
  });

  it('adds selected text with its relative line location', () => {
    expect(workspaceConversationReferenceText({
      kind: 'selection', ...target, path: 'src/main.ts', text: 'const ready = true;',
      startLine: 12, endLine: 12,
    })).toBe('@src/main.ts 第 12 行\n\nconst ready = true;');
    expect(appendWorkspaceConversationReference('请检查这里', {
      kind: 'selection', ...target, path: 'src/main.ts', text: 'one\ntwo',
      startLine: 12, endLine: 13,
    })).toBe('请检查这里\n\n@src/main.ts 第 12–13 行\n\none\ntwo');
  });

  it('rejects absolute paths, oversized selections, and invalid ranges', () => {
    expect(validatedWorkspaceConversationReference({
      kind: 'file', ...target, path: '/Users/person/secret',
    })).toBeUndefined();
    expect(validatedWorkspaceConversationReference({
      kind: 'selection', ...target, path: 'src/main.ts', text: 'x'.repeat(16_385),
    })).toBeUndefined();
    expect(validatedWorkspaceConversationReference({
      kind: 'selection', ...target, path: 'src/main.ts', text: 'hello',
      startLine: 5, endLine: 4,
    })).toBeUndefined();
  });

  it('creates and validates the narrow Harness delivery payload', () => {
    const insertion = workspaceConversationInsertion({
      kind: 'file', ...target, path: 'src/main.ts',
    });
    expect(insertion).toEqual({ ...target, text: '@src/main.ts' });
    expect(validatedWorkspaceConversationInsertion(insertion)).toEqual(insertion);
    expect(validatedWorkspaceConversationInsertion({ ...insertion, text: '' }))
      .toBeUndefined();
  });
});
