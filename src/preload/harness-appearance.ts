import type { DesktopAppearanceSnapshot } from '../shared/appearance-sync.js';

export interface HarnessAppearanceInputs {
  readonly colorScheme: 'light' | 'dark';
  readonly sidebarBackground?: string | undefined;
  readonly contentBackground?: string | undefined;
  readonly bodyBackground?: string | undefined;
  readonly foreground?: string | undefined;
  readonly mutedForeground?: string | undefined;
  readonly borderColor?: string | undefined;
  readonly accentColor?: string | undefined;
  readonly accentForeground?: string | undefined;
  readonly surfaceBackground?: string | undefined;
  readonly subtleBackground?: string | undefined;
  readonly hoverBackground?: string | undefined;
  readonly selectedBackground?: string | undefined;
  readonly overlayBackground?: string | undefined;
}

/** Produces a complete shell theme even while Harness layout tokens are unavailable. */
export function resolvedHarnessAppearance(
  inputs: HarnessAppearanceInputs,
): DesktopAppearanceSnapshot {
  const dark = inputs.colorScheme === 'dark';
  return {
    colorScheme: inputs.colorScheme,
    sidebarBackground: inputs.sidebarBackground ??
      (dark ? 'rgb(27, 28, 31)' : 'rgb(247, 248, 250)'),
    contentBackground: inputs.contentBackground ?? inputs.bodyBackground ??
      (dark ? 'rgb(20, 20, 22)' : 'rgb(255, 255, 255)'),
    foreground: inputs.foreground ??
      (dark ? 'rgb(232, 234, 240)' : 'rgb(32, 33, 36)'),
    mutedForeground: inputs.mutedForeground ??
      (dark ? 'rgb(142, 148, 159)' : 'rgb(115, 122, 137)'),
    borderColor: inputs.borderColor ??
      (dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(127, 127, 127, 0.16)'),
    accentColor: inputs.accentColor ?? 'rgb(79, 131, 242)',
    accentForeground: inputs.accentForeground ?? 'rgb(255, 255, 255)',
    surfaceBackground: inputs.surfaceBackground ??
      (dark ? 'rgb(21, 22, 26)' : 'rgb(255, 255, 255)'),
    subtleBackground: inputs.subtleBackground ??
      (dark ? 'rgb(27, 29, 34)' : 'rgb(247, 248, 250)'),
    hoverBackground: inputs.hoverBackground ??
      (dark ? 'rgba(255, 255, 255, 0.045)' : 'rgba(31, 41, 55, 0.05)'),
    selectedBackground: inputs.selectedBackground ??
      (dark ? 'rgba(79, 131, 242, 0.13)' : 'rgba(79, 131, 242, 0.09)'),
    overlayBackground: inputs.overlayBackground ??
      (dark ? 'rgb(27, 29, 34)' : 'rgb(255, 255, 255)'),
  };
}
