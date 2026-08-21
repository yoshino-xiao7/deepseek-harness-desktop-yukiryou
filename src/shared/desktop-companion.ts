export const HARNESS_CONTEXT_CHANNEL = 'deepseek-yukiryou:companion:harness-context';
export const COMPANION_STATE_CHANNEL = 'deepseek-yukiryou:companion:state';
export const COMPANION_COMMAND_CHANNEL = 'deepseek-yukiryou:companion:command';

export const COMPANION_PANEL_WIDTH = 340;
export const COMPANION_PANEL_MIN_WIDTH = 280;
export const COMPANION_PANEL_MAX_WIDTH = 480;
export const COMPANION_PREVIEW_WIDTH = 520;
export const COMPANION_DOCKED_MIN_WIDTH = 980;
export const COMPANION_WIDE_REVIEW_MIN_WIDTH = 1_320;

export interface HarnessContextSnapshot {
  readonly revision: number;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly running: boolean;
}

export type CompanionWorkspaceSnapshot =
  | { readonly status: 'none' }
  | { readonly status: 'authorizing'; readonly running: boolean }
  | {
      readonly status: 'ready';
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly title: string;
      readonly running: boolean;
    }
  | { readonly status: 'unavailable'; readonly running: boolean };

export interface DesktopCompanionSnapshot {
  readonly active: boolean;
  readonly open: boolean;
  readonly previewOpen: boolean;
  readonly panelWidth: number;
  readonly workspace: CompanionWorkspaceSnapshot;
}

export type CompanionCommand =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'preview'; readonly open: boolean }
  | { readonly kind: 'resize'; readonly width: number };

export function transitionCompanion(
  state: DesktopCompanionSnapshot,
  command: CompanionCommand,
): DesktopCompanionSnapshot {
  if (command.kind === 'resize') {
    return { ...state, panelWidth: normalizedCompanionPanelWidth(command.width) };
  }
  if (command.kind === 'preview') {
    return { ...state, previewOpen: command.open, ...(command.open ? { open: true } : {}) };
  }
  return state.open
    ? { ...state, open: false, previewOpen: false }
    : { ...state, open: true };
}

export function transitionCompanionWorkspace(
  state: DesktopCompanionSnapshot,
  workspace: CompanionWorkspaceSnapshot,
): DesktopCompanionSnapshot {
  const sameWorkspace = state.workspace.status === 'ready'
    && workspace.status === 'ready'
    && state.workspace.sessionId === workspace.sessionId
    && state.workspace.workspaceId === workspace.workspaceId;
  return {
    ...state,
    previewOpen: sameWorkspace ? state.previewOpen : false,
    workspace,
  };
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function validatedHarnessContext(value: unknown): HarnessContextSnapshot | undefined {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.running !== 'boolean') return undefined;
  const sessionId = validatedId(value.sessionId);
  const workspaceId = validatedId(value.workspaceId);
  if ((value.sessionId !== undefined && sessionId === undefined) || (value.workspaceId !== undefined && workspaceId === undefined)) return undefined;
  if (sessionId === undefined && workspaceId !== undefined) return undefined;
  return {
    revision: value.revision as number,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    running: value.running,
  };
}

export function validatedCompanionCommand(value: unknown): CompanionCommand | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'toggle') return { kind: 'toggle' };
  if (value.kind === 'resize' && typeof value.width === 'number' && Number.isFinite(value.width)) {
    return { kind: 'resize', width: normalizedCompanionPanelWidth(value.width) };
  }
  return value.kind === 'preview' && typeof value.open === 'boolean'
    ? { kind: 'preview', open: value.open }
    : undefined;
}

export function validatedDesktopCompanionSnapshot(value: unknown): DesktopCompanionSnapshot | undefined {
  if (!isRecord(value) || typeof value.active !== 'boolean' || typeof value.open !== 'boolean' || typeof value.previewOpen !== 'boolean' || typeof value.panelWidth !== 'number' || !Number.isFinite(value.panelWidth) || !isRecord(value.workspace)) return undefined;
  const panelWidth = normalizedCompanionPanelWidth(value.panelWidth);
  const workspace = value.workspace;
  if (workspace.status === 'none') return { active: value.active, open: value.open, previewOpen: value.previewOpen, panelWidth, workspace: { status: 'none' } };
  if ((workspace.status === 'authorizing' || workspace.status === 'unavailable') && typeof workspace.running === 'boolean') {
    return { active: value.active, open: value.open, previewOpen: value.previewOpen, panelWidth, workspace: { status: workspace.status, running: workspace.running } };
  }
  const workspaceId = validatedId(workspace.workspaceId);
  const sessionId = validatedId(workspace.sessionId);
  if (workspace.status !== 'ready' || sessionId === undefined || workspaceId === undefined || typeof workspace.title !== 'string' || workspace.title.length === 0 || workspace.title.length > 200 || typeof workspace.running !== 'boolean') return undefined;
  return { active: value.active, open: value.open, previewOpen: value.previewOpen, panelWidth, workspace: { status: 'ready', sessionId, workspaceId, title: workspace.title, running: workspace.running } };
}

export function normalizedCompanionPanelWidth(value: number): number {
  return Math.round(Math.min(COMPANION_PANEL_MAX_WIDTH, Math.max(COMPANION_PANEL_MIN_WIDTH, value)));
}

function validatedId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
