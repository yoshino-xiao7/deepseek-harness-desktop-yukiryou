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
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly borderColor: string;
  readonly accentColor: string;
  readonly accentForeground: string;
  readonly surfaceBackground: string;
  readonly subtleBackground: string;
  readonly hoverBackground: string;
  readonly selectedBackground: string;
  readonly overlayBackground: string;
}

const COLOR_KEYS = [
  'sidebarBackground',
  'contentBackground',
  'foreground',
  'mutedForeground',
  'borderColor',
  'accentColor',
  'accentForeground',
  'surfaceBackground',
  'subtleBackground',
  'hoverBackground',
  'selectedBackground',
  'overlayBackground',
] as const satisfies readonly (keyof DesktopAppearanceSnapshot)[];

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
    COLOR_KEYS.some((key) => !isComputedColor(candidate[key]))
  ) {
    return undefined;
  }
  return {
    colorScheme: candidate.colorScheme,
    ...Object.fromEntries(COLOR_KEYS.map((key) => [key, candidate[key]])),
  } as DesktopAppearanceSnapshot;
}

function isComputedColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    COMPUTED_COLOR.test(value)
  );
}
