export const HARNESS_APPEARANCE_CHANNEL =
  'dsh-desktop:harness-appearance';
export const TOOLBAR_APPEARANCE_CHANNEL =
  'dsh-desktop:toolbar-appearance';

export const DESKTOP_CHROME_SIDEBAR_TOKEN =
  '--dsh-desktop-chrome-sidebar-background';
export const DESKTOP_CHROME_CONTENT_TOKEN =
  '--dsh-desktop-chrome-content-background';

export interface DesktopAppearanceSnapshot {
  readonly colorScheme: 'light' | 'dark';
  readonly sidebarBackground: string;
  readonly contentBackground: string;
}

const COMPUTED_COLOR =
  /^rgba?\(\s*\d+(?:\.\d+)?(?:\s+|\s*,\s*)\d+(?:\.\d+)?(?:\s+|\s*,\s*)\d+(?:\.\d+)?(?:\s*(?:\/|,)\s*(?:\d+(?:\.\d+)?%?))?\s*\)$/;

export function validatedAppearanceSnapshot(
  value: unknown,
): DesktopAppearanceSnapshot | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.colorScheme !== 'light' && candidate.colorScheme !== 'dark') ||
    !isComputedColor(candidate.sidebarBackground) ||
    !isComputedColor(candidate.contentBackground)
  ) {
    return undefined;
  }
  return {
    colorScheme: candidate.colorScheme,
    sidebarBackground: candidate.sidebarBackground,
    contentBackground: candidate.contentBackground,
  };
}

function isComputedColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    COMPUTED_COLOR.test(value)
  );
}
