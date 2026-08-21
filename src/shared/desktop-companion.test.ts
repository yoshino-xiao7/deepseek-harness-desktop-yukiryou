import { describe, expect, it } from 'vitest';

import {
  COMPANION_PANEL_MAX_WIDTH,
  COMPANION_PANEL_MIN_WIDTH,
  transitionCompanion,
  transitionCompanionWorkspace,
  validatedHarnessContext,
  type DesktopCompanionSnapshot,
} from './desktop-companion.js';

describe('Harness context boundary', () => {
  it('accepts bounded identifiers and a monotonic revision', () => {
    expect(validatedHarnessContext({ revision: 4, sessionId: 'session:one', workspaceId: 'workspace-1', running: true })).toEqual({ revision: 4, sessionId: 'session:one', workspaceId: 'workspace-1', running: true });
  });

  it('rejects paths, oversized identifiers, and workspace-only claims', () => {
    expect(validatedHarnessContext({ revision: 1, sessionId: '/Users/example/project', running: false })).toBeUndefined();
    expect(validatedHarnessContext({ revision: 1, workspaceId: 'workspace-1', running: false })).toBeUndefined();
    expect(validatedHarnessContext({ revision: 1, sessionId: 'x'.repeat(129), running: false })).toBeUndefined();
  });

  it('survives 100 review/open/close/workspace-switch cycles without stale preview state', () => {
    let state: DesktopCompanionSnapshot = {
      active: true,
      open: true,
      previewOpen: false,
      panelWidth: 340,
      workspace: { status: 'ready', sessionId: 'session-1', workspaceId: 'workspace-1', title: 'Project', running: false },
    };
    for (let cycle = 0; cycle < 100; cycle += 1) {
      state = transitionCompanion(state, { kind: 'preview', open: true });
      state = transitionCompanionWorkspace(state, { status: 'authorizing', running: false });
      const workspaceId = `workspace-${String((cycle % 2) + 1)}`;
      state = transitionCompanionWorkspace(state, { status: 'ready', sessionId: `session-${workspaceId}`, workspaceId, title: `Project ${workspaceId}`, running: false });
      state = transitionCompanion(state, { kind: 'toggle' });
      state = transitionCompanion(state, { kind: 'toggle' });
    }

    expect(state).toEqual({
      active: true,
      open: true,
      previewOpen: false,
      panelWidth: 340,
      workspace: { status: 'ready', sessionId: 'session-workspace-2', workspaceId: 'workspace-2', title: 'Project workspace-2', running: false },
    });
  });

  it('closes a stale preview before authorizing a different workspace', () => {
    const state: DesktopCompanionSnapshot = {
      active: true,
      open: true,
      previewOpen: true,
      panelWidth: 340,
      workspace: { status: 'ready', sessionId: 'session-1', workspaceId: 'workspace-1', title: 'Old project', running: false },
    };

    expect(transitionCompanionWorkspace(state, { status: 'authorizing', running: false })).toEqual({
      active: true,
      open: true,
      previewOpen: false,
      panelWidth: 340,
      workspace: { status: 'authorizing', running: false },
    });
  });

  it('keeps panel resizing inside the supported range', () => {
    const state: DesktopCompanionSnapshot = {
      active: true,
      open: true,
      previewOpen: false,
      panelWidth: 340,
      workspace: { status: 'none' },
    };

    expect(transitionCompanion(state, { kind: 'resize', width: 120 }).panelWidth)
      .toBe(COMPANION_PANEL_MIN_WIDTH);
    expect(transitionCompanion(state, { kind: 'resize', width: 900 }).panelWidth)
      .toBe(COMPANION_PANEL_MAX_WIDTH);
    expect(transitionCompanion(state, { kind: 'resize', width: 376.7 }).panelWidth)
      .toBe(377);
  });
});
