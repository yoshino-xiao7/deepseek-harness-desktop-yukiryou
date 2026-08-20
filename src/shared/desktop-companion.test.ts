import { describe, expect, it } from 'vitest';

import {
  COMPANION_PANEL_DEFAULT_WIDTH,
  COMPANION_PANEL_MIN_WIDTH,
  clampCompanionPreferredWidth,
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
      preferredWidth: COMPANION_PANEL_DEFAULT_WIDTH,
      previewOpen: false,
      workspace: { status: 'ready', workspaceId: 'workspace-1', title: 'Project', running: false },
    };
    for (let cycle = 0; cycle < 100; cycle += 1) {
      state = transitionCompanion(state, { kind: 'preview', open: true });
      state = transitionCompanion(state, { kind: 'resize', preferredWidth: 100 });
      state = transitionCompanionWorkspace(state, { status: 'authorizing', running: false });
      const workspaceId = `workspace-${String((cycle % 2) + 1)}`;
      state = transitionCompanionWorkspace(state, { status: 'ready', workspaceId, title: `Project ${workspaceId}`, running: false });
      state = transitionCompanion(state, { kind: 'toggle' });
      state = transitionCompanion(state, { kind: 'toggle' });
    }

    expect(state).toEqual({
      active: true,
      open: true,
      preferredWidth: COMPANION_PANEL_MIN_WIDTH,
      previewOpen: false,
      workspace: { status: 'ready', workspaceId: 'workspace-2', title: 'Project workspace-2', running: false },
    });
  });

  it('closes a stale preview before authorizing a different workspace', () => {
    const state: DesktopCompanionSnapshot = {
      active: true,
      open: true,
      preferredWidth: COMPANION_PANEL_DEFAULT_WIDTH,
      previewOpen: true,
      workspace: { status: 'ready', workspaceId: 'workspace-1', title: 'Old project', running: false },
    };

    expect(transitionCompanionWorkspace(state, { status: 'authorizing', running: false })).toEqual({
      active: true,
      open: true,
      preferredWidth: COMPANION_PANEL_DEFAULT_WIDTH,
      previewOpen: false,
      workspace: { status: 'authorizing', running: false },
    });
  });

  it('clamps resizing without changing open state and restores the last width after toggling', () => {
    const initial: DesktopCompanionSnapshot = {
      active: true,
      open: true,
      preferredWidth: COMPANION_PANEL_DEFAULT_WIDTH,
      previewOpen: false,
      workspace: { status: 'none' },
    };
    const minimum = transitionCompanion(initial, { kind: 'resize', preferredWidth: 1 });
    expect(minimum).toMatchObject({ open: true, preferredWidth: COMPANION_PANEL_MIN_WIDTH });
    const closed = transitionCompanion(minimum, { kind: 'toggle' });
    expect(closed).toMatchObject({ open: false, preferredWidth: COMPANION_PANEL_MIN_WIDTH });
    expect(transitionCompanion(closed, { kind: 'toggle' })).toMatchObject({
      open: true,
      preferredWidth: COMPANION_PANEL_MIN_WIDTH,
    });
    expect(clampCompanionPreferredWidth(Number.POSITIVE_INFINITY)).toBe(COMPANION_PANEL_DEFAULT_WIDTH);
  });
});
