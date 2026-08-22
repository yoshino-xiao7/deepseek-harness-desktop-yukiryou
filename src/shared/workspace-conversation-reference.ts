import { validatedChangedFilePath } from './workspace-review.js';

export const WORKSPACE_REFERENCE_TO_HARNESS_CHANNEL =
  'deepseek-yukiryou:workspace-reference:to-harness';
export const WORKSPACE_REFERENCE_FROM_SHELL_CHANNEL =
  'deepseek-yukiryou:workspace-reference:from-shell';

const MAX_SELECTION_LENGTH = 16_384;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function validatedWorkspaceConversationId(value: unknown): string | undefined {
  return validatedId(value);
}

export type WorkspaceConversationReference =
  | {
      readonly kind: 'file';
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly path: string;
    }
  | {
      readonly kind: 'directory';
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly path: string;
    }
  | {
      readonly kind: 'selection';
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly path: string;
      readonly text: string;
      readonly startLine?: number;
      readonly endLine?: number;
    };

export interface WorkspaceConversationInsertion {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly text: string;
}

export function validatedWorkspaceConversationReference(
  value: unknown,
): WorkspaceConversationReference | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = validatedId(value.sessionId);
  const workspaceId = validatedId(value.workspaceId);
  const path = validatedChangedFilePath(value.path);
  if (
    sessionId === undefined || workspaceId === undefined || path === undefined ||
    path.includes('"') || /[\u0080-\u009f]/u.test(path)
  ) {
    return undefined;
  }
  if (value.kind === 'file' || value.kind === 'directory') {
    return { kind: value.kind, sessionId, workspaceId, path };
  }
  if (value.kind !== 'selection' || typeof value.text !== 'string') {
    return undefined;
  }
  const text = normalizedSelection(value.text);
  if (text === undefined) return undefined;
  const startLine = validatedLine(value.startLine);
  const endLine = validatedLine(value.endLine);
  if (
    (value.startLine !== undefined && startLine === undefined) ||
    (value.endLine !== undefined && endLine === undefined) ||
    (endLine !== undefined && startLine === undefined) ||
    (startLine !== undefined && endLine !== undefined && endLine < startLine)
  ) return undefined;
  return {
    kind: 'selection',
    sessionId,
    workspaceId,
    path,
    text,
    ...(startLine === undefined ? {} : { startLine }),
    ...(endLine === undefined ? {} : { endLine }),
  };
}

export function workspaceConversationReferenceText(
  reference: WorkspaceConversationReference,
): string {
  const mention = formattedFileMention(reference.path);
  if (reference.kind === 'file') return mention;
  if (reference.kind === 'directory') return formattedDirectoryMention(reference.path);
  const location = reference.startLine === undefined
    ? ''
    : reference.endLine === undefined || reference.endLine === reference.startLine
      ? ` 第 ${String(reference.startLine)} 行`
      : ` 第 ${String(reference.startLine)}–${String(reference.endLine)} 行`;
  return `${mention}${location}\n\n${reference.text}`;
}

export function appendWorkspaceConversationReference(
  draft: string,
  reference: WorkspaceConversationReference,
): string {
  const insertion = workspaceConversationReferenceText(reference);
  if (draft === '') return insertion;
  return `${draft.replace(/\s+$/u, '')}\n\n${insertion}`;
}

export function workspaceConversationInsertion(
  reference: WorkspaceConversationReference,
): WorkspaceConversationInsertion {
  return {
    sessionId: reference.sessionId,
    workspaceId: reference.workspaceId,
    text: workspaceConversationReferenceText(reference),
  };
}

export function validatedWorkspaceConversationInsertion(
  value: unknown,
): WorkspaceConversationInsertion | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = validatedId(value.sessionId);
  const workspaceId = validatedId(value.workspaceId);
  if (
    sessionId === undefined || workspaceId === undefined ||
    typeof value.text !== 'string' || value.text.length === 0 ||
    value.text.length > MAX_SELECTION_LENGTH + 2_048 || value.text.includes('\0')
  ) return undefined;
  return { sessionId, workspaceId, text: value.text };
}

function formattedFileMention(path: string): string {
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`;
}

function formattedDirectoryMention(path: string): string {
  const directory = `${path}/`;
  return /\s/u.test(directory) ? `@"${directory}"` : `@${directory}`;
}

function normalizedSelection(value: string): string | undefined {
  const normalized = value.replaceAll('\r\n', '\n');
  if (
    normalized.trim().length === 0 ||
    normalized.length > MAX_SELECTION_LENGTH ||
    normalized.includes('\0')
  ) return undefined;
  return normalized;
}

function validatedLine(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 10_000_000
    ? value as number
    : undefined;
}

function validatedId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
