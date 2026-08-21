import { contextBridge, ipcRenderer } from 'electron';

import {
  SHELL_REVIEW_TARGET_CHANNEL,
  WORKSPACE_REVIEW_REQUEST_CHANNEL,
  createReviewTargetStore,
  type WorkspaceReviewResponse,
  validatedWorkspaceReviewRequest,
} from '../shared/workspace-review.js';
import {
  COMPANION_COMMAND_CHANNEL,
  COMPANION_STATE_CHANNEL,
  type DesktopCompanionSnapshot,
  validatedCompanionCommand,
  validatedDesktopCompanionSnapshot,
} from '../shared/desktop-companion.js';
import {
  TOOLBAR_APPEARANCE_CHANNEL,
  type DesktopAppearanceSnapshot,
  validatedAppearanceSnapshot,
} from '../shared/appearance-sync.js';
import {
  TOOLBAR_SIDEBAR_WIDTH_CHANNEL,
  validatedSidebarWidth,
} from '../shared/sidebar-width-sync.js';
import {
  WORKSPACE_REVIEW_SHORTCUT_CHANNEL,
  type WorkspaceReviewShortcut,
  validatedWorkspaceReviewShortcut,
} from '../shared/workspace-review-shortcuts.js';

const DEFAULT_SIDEBAR_WIDTH = 280;
let pendingToolbarWidth = DEFAULT_SIDEBAR_WIDTH;
let pendingAppearance: DesktopAppearanceSnapshot | undefined;
let companionState: DesktopCompanionSnapshot = {
  active: false,
  open: true,
  previewOpen: false,
  panelWidth: 340,
  workspace: { status: 'none' },
};
const companionListeners = new Set<(snapshot: DesktopCompanionSnapshot) => void>();
const shortcutListeners = new Set<(shortcut: WorkspaceReviewShortcut) => void>();
const reviewTargets = createReviewTargetStore();

ipcRenderer.on(SHELL_REVIEW_TARGET_CHANNEL, (_event, value: WorkspaceReviewResponse) => {
  if (value?.kind !== 'preview') return;
  reviewTargets.publish(value);
});

ipcRenderer.on(COMPANION_STATE_CHANNEL, (_event, value: unknown) => {
  const snapshot = validatedDesktopCompanionSnapshot(value);
  if (snapshot === undefined) return;
  const previousWorkspaceId = companionState.workspace.status === 'ready' ? companionState.workspace.workspaceId : undefined;
  const nextWorkspaceId = snapshot.workspace.status === 'ready' ? snapshot.workspace.workspaceId : undefined;
  if (previousWorkspaceId !== nextWorkspaceId) reviewTargets.clear();
  companionState = snapshot;
  for (const listener of companionListeners) listener(snapshot);
});

ipcRenderer.on(WORKSPACE_REVIEW_SHORTCUT_CHANNEL, (_event, value: unknown) => {
  const shortcut = validatedWorkspaceReviewShortcut(value);
  if (shortcut === undefined) return;
  for (const listener of shortcutListeners) listener(shortcut);
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouCompanion', {
  getSnapshot: (): DesktopCompanionSnapshot => companionState,
  subscribe: (listener: (snapshot: DesktopCompanionSnapshot) => void): (() => void) => {
    companionListeners.add(listener);
    return () => companionListeners.delete(listener);
  },
  subscribeShortcut: (listener: (shortcut: WorkspaceReviewShortcut) => void): (() => void) => {
    shortcutListeners.add(listener);
    return () => shortcutListeners.delete(listener);
  },
  subscribeReviewTarget: (listener: (preview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined) => void): (() => void) => reviewTargets.subscribe(listener),
  toggle: (): void => ipcRenderer.send(COMPANION_COMMAND_CHANNEL, { kind: 'toggle' }),
  setPreviewOpen: (open: boolean): void => ipcRenderer.send(COMPANION_COMMAND_CHANNEL, { kind: 'preview', open: open === true }),
  resize: (width: number): void => {
    const command = validatedCompanionCommand({ kind: 'resize', width });
    if (command !== undefined) ipcRenderer.send(COMPANION_COMMAND_CHANNEL, command);
  },
  request: async (value: unknown): Promise<WorkspaceReviewResponse> => {
    const request = validatedWorkspaceReviewRequest(value);
    if (request === undefined) return { kind: 'unavailable', reason: 'invalid-node' };
    return ipcRenderer.invoke(WORKSPACE_REVIEW_REQUEST_CHANNEL, request) as Promise<WorkspaceReviewResponse>;
  },
});

function applyToolbarWidth(): void {
  document.documentElement?.style.setProperty(
    '--harness-sidebar-width',
    `${pendingToolbarWidth}px`,
  );
}

function applyToolbarAppearance(): void {
  if (pendingAppearance === undefined || document.documentElement === null) {
    return;
  }
  document.documentElement.dataset.appearanceScheme =
    pendingAppearance.colorScheme;
  document.documentElement.style.colorScheme = pendingAppearance.colorScheme;
  document.documentElement.style.setProperty(
    '--toolbar-sidebar-background',
    pendingAppearance.sidebarBackground,
  );
  document.documentElement.style.setProperty(
    '--toolbar-content-background',
    pendingAppearance.contentBackground,
  );
}

ipcRenderer.on(TOOLBAR_SIDEBAR_WIDTH_CHANNEL, (_event, value: unknown) => {
  const width = validatedSidebarWidth(value, window.innerWidth);
  if (width === undefined) return;
  pendingToolbarWidth = width;
  applyToolbarWidth();
});

ipcRenderer.on(TOOLBAR_APPEARANCE_CHANNEL, (_event, value: unknown) => {
  const appearance = validatedAppearanceSnapshot(value);
  if (appearance === undefined) return;
  pendingAppearance = appearance;
  applyToolbarAppearance();
});

window.addEventListener('DOMContentLoaded', () => {
  applyToolbarWidth();
  applyToolbarAppearance();
});
