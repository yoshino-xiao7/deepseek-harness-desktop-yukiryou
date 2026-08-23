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
import {
  SHELL_CLIPBOARD_WRITE_CHANNEL,
  validatedShellClipboardText,
} from '../shared/shell-clipboard.js';
import {
  WORKSPACE_REFERENCE_FROM_SHELL_CHANNEL,
  validatedWorkspaceConversationReference,
} from '../shared/workspace-conversation-reference.js';
import {
  WINDOW_MENU_CHANNEL,
  validatedWindowMenuRequest,
} from '../shared/window-menu.js';
import {
  TOOLBAR_LOCALE_CHANNEL,
  validatedDesktopLocale,
} from '../shared/locale-sync.js';

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
  writeClipboard: (value: unknown): boolean => {
    const text = validatedShellClipboardText(value);
    if (text === undefined) return false;
    ipcRenderer.send(SHELL_CLIPBOARD_WRITE_CHANNEL, text);
    return true;
  },
  addToConversation: (value: unknown): boolean => {
    const reference = validatedWorkspaceConversationReference(value);
    if (reference === undefined) return false;
    ipcRenderer.send(WORKSPACE_REFERENCE_FROM_SHELL_CHANNEL, reference);
    return true;
  },
  request: async (value: unknown): Promise<WorkspaceReviewResponse> => {
    const request = validatedWorkspaceReviewRequest(value);
    if (request === undefined) return { kind: 'unavailable', reason: 'invalid-node' };
    return ipcRenderer.invoke(WORKSPACE_REVIEW_REQUEST_CHANNEL, request) as Promise<WorkspaceReviewResponse>;
  },
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouWindow', {
  platform: process.platform,
  openMenu: (value: unknown): boolean => {
    const request = validatedWindowMenuRequest(value);
    if (request === undefined) return false;
    ipcRenderer.send(WINDOW_MENU_CHANNEL, request);
    return true;
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

ipcRenderer.on(TOOLBAR_LOCALE_CHANNEL, (_event, value: unknown) => {
  const locale = validatedDesktopLocale(value);
  if (locale === undefined) return;
  document.documentElement.lang = locale;
  const labels = locale === 'en-US'
    ? { file: 'File', edit: 'Edit', view: 'View', help: 'Help' }
    : { file: '文件', edit: '编辑', view: '视图', help: '帮助' };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-window-menu]')) {
    const id = button.dataset.windowMenu as keyof typeof labels | undefined;
    if (id !== undefined && labels[id] !== undefined) button.textContent = labels[id];
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktopPlatform = process.platform;
  const windowsMenu = document.querySelector<HTMLElement>('[data-testid="windows-menu"]');
  if (windowsMenu !== null) windowsMenu.hidden = process.platform !== 'win32';
  applyToolbarWidth();
  applyToolbarAppearance();
});
