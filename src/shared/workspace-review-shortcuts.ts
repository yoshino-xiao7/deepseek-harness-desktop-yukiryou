export const WORKSPACE_REVIEW_SHORTCUT_CHANNEL = 'deepseek-yukiryou:workspace-review:shortcut';

export type WorkspaceReviewShortcut =
  | 'file-search'
  | 'preview-find'
  | 'preview-back'
  | 'preview-forward'
  | 'close-preview';

export interface WorkspaceReviewKeyboardInput {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly meta?: boolean;
  readonly control?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
}

export function workspaceReviewShortcut(
  input: WorkspaceReviewKeyboardInput,
): WorkspaceReviewShortcut | undefined {
  if (input.defaultPrevented === true || input.isComposing === true) return undefined;
  const command = input.metaKey === true || input.ctrlKey === true
    || input.meta === true || input.control === true;
  const alt = input.altKey === true || input.alt === true;
  const shift = input.shiftKey === true || input.shift === true;
  if (command && !alt && !shift) {
    if (input.key.toLowerCase() === 'p') return 'file-search';
    if (input.key.toLowerCase() === 'f') return 'preview-find';
    if (input.key === '[') return 'preview-back';
    if (input.key === ']') return 'preview-forward';
  }
  return !command && !alt && !shift && input.key === 'Escape'
    ? 'close-preview'
    : undefined;
}

export function validatedWorkspaceReviewShortcut(value: unknown): WorkspaceReviewShortcut | undefined {
  return value === 'file-search' || value === 'preview-find' || value === 'preview-back'
    || value === 'preview-forward' || value === 'close-preview'
    ? value
    : undefined;
}
