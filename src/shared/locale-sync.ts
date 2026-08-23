export const HARNESS_LOCALE_CHANNEL = 'dsh-desktop:harness-locale';
export const TOOLBAR_LOCALE_CHANNEL = 'dsh-desktop:toolbar-locale';

export type DesktopLocale = 'zh-CN' | 'en-US';

export function validatedDesktopLocale(value: unknown): DesktopLocale | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';
  return undefined;
}
