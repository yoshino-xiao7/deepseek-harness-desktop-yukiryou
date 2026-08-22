export const SHELL_CLIPBOARD_WRITE_CHANNEL = 'deepseek-yukiryou:shell-clipboard:write';

const MAX_CLIPBOARD_TEXT_LENGTH = 4_096;

export function validatedShellClipboardText(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CLIPBOARD_TEXT_LENGTH
    && !value.includes('\0')
    ? value
    : undefined;
}
