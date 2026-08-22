import type { DesktopAppearanceSnapshot } from '../shared/appearance-sync.js';

export interface HarnessAppearanceInputs {
  readonly colorScheme: 'light' | 'dark';
  readonly sidebarBackground?: string | undefined;
  readonly contentBackground?: string | undefined;
  readonly bodyBackground?: string | undefined;
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
  };
}
