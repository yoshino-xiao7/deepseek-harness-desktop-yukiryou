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
  COMPANION_PANEL_DEFAULT_WIDTH,
  COMPANION_STATE_CHANNEL,
  type DesktopCompanionSnapshot,
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
  PET_LIBRARY_STATE_CHANNEL,
  type PetAssetSummary,
  type PetLibrarySnapshot,
  validatedPetLibrarySnapshot,
} from '../shared/pet-library.js';
import {
  PET_STAGE_SURFACE_CHANNEL,
  PET_STAGE_WAKE_CHANNEL,
  validatedPetStageSurfaceSnapshot,
} from '../shared/pet-stage-surface.js';

const DEFAULT_SIDEBAR_WIDTH = 280;
let pendingToolbarWidth = DEFAULT_SIDEBAR_WIDTH;
let pendingAppearance: DesktopAppearanceSnapshot | undefined;
let companionState: DesktopCompanionSnapshot = {
  active: false,
  open: true,
  preferredWidth: COMPANION_PANEL_DEFAULT_WIDTH,
  previewOpen: false,
  workspace: { status: 'none' },
};
const companionListeners = new Set<(snapshot: DesktopCompanionSnapshot) => void>();
const reviewTargets = createReviewTargetStore();
export interface PetStageSnapshot {
  readonly enabled: boolean;
  readonly asset?: PetAssetSummary;
}
let petStageState: PetStageSnapshot = Object.freeze({ enabled: false });
const petStageListeners = new Set<(snapshot: PetStageSnapshot) => void>();

ipcRenderer.on(PET_LIBRARY_STATE_CHANNEL, (_event, value: unknown) => {
  const snapshot = validatedPetLibrarySnapshot(value);
  if (snapshot === undefined) return;
  petStageState = petStageSnapshot(snapshot);
  for (const listener of petStageListeners) listener(petStageState);
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouPetStage', {
  getSnapshot: (): PetStageSnapshot => petStageState,
  subscribe: (listener: (snapshot: PetStageSnapshot) => void): (() => void) => {
    petStageListeners.add(listener);
    return () => petStageListeners.delete(listener);
  },
  presentSurface: (value: unknown): void => {
    const snapshot = validatedPetStageSurfaceSnapshot(value);
    if (snapshot !== undefined) ipcRenderer.send(PET_STAGE_SURFACE_CHANNEL, snapshot);
  },
  wake: (): void => ipcRenderer.send(PET_STAGE_WAKE_CHANNEL),
});

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

contextBridge.exposeInMainWorld('deepSeekYukiRyouCompanion', {
  getSnapshot: (): DesktopCompanionSnapshot => companionState,
  subscribe: (listener: (snapshot: DesktopCompanionSnapshot) => void): (() => void) => {
    companionListeners.add(listener);
    return () => companionListeners.delete(listener);
  },
  subscribeReviewTarget: (listener: (preview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined) => void): (() => void) => reviewTargets.subscribe(listener),
  toggle: (): void => ipcRenderer.send(COMPANION_COMMAND_CHANNEL, { kind: 'toggle' }),
  setPreviewOpen: (open: boolean): void => ipcRenderer.send(COMPANION_COMMAND_CHANNEL, { kind: 'preview', open: open === true }),
  resize: (preferredWidth: number, commit = false): void => ipcRenderer.send(
    COMPANION_COMMAND_CHANNEL,
    { kind: commit ? 'resize-end' : 'resize', preferredWidth },
  ),
  request: async (value: unknown): Promise<WorkspaceReviewResponse> => {
    const request = validatedWorkspaceReviewRequest(value);
    if (request === undefined) return { kind: 'unavailable', reason: 'invalid-node' };
    return ipcRenderer.invoke(WORKSPACE_REVIEW_REQUEST_CHANNEL, request) as Promise<WorkspaceReviewResponse>;
  },
});

function petStageSnapshot(snapshot: PetLibrarySnapshot): PetStageSnapshot {
  const asset = snapshot.activePetId === undefined
    ? snapshot.assets.find((candidate) => candidate.origin === 'built-in')
    : snapshot.assets.find((candidate) => candidate.id === snapshot.activePetId);
  return Object.freeze({ enabled: snapshot.enabled, ...(asset === undefined ? {} : { asset }) });
}

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
