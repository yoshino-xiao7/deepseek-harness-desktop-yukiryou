export const DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL =
  'deepseek-yukiryou:desktop-features:state';
export const DESKTOP_FEATURE_PREFERENCES_COMMAND_CHANNEL =
  'deepseek-yukiryou:desktop-features:command';

export interface DesktopFeaturePreferences {
  readonly workspaceReview: boolean;
}

export type DesktopFeaturePreferenceKey = keyof DesktopFeaturePreferences;

export interface DesktopFeaturePreferenceCommand {
  readonly key: DesktopFeaturePreferenceKey;
  readonly enabled: boolean;
}

export const DEFAULT_DESKTOP_FEATURE_PREFERENCES: DesktopFeaturePreferences = {
  workspaceReview: true,
};

export function validatedDesktopFeaturePreferences(
  value: unknown,
): DesktopFeaturePreferences | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.workspaceReview === 'boolean'
    ? { workspaceReview: value.workspaceReview }
    : undefined;
}

export function validatedDesktopFeaturePreferenceCommand(
  value: unknown,
): DesktopFeaturePreferenceCommand | undefined {
  if (
    !isRecord(value) ||
    value.key !== 'workspaceReview' ||
    typeof value.enabled !== 'boolean'
  ) return undefined;
  return { key: value.key, enabled: value.enabled };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
