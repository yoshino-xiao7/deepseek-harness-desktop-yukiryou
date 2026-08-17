export const HARNESS_SIDEBAR_WIDTH_CHANNEL =
  'dsh-desktop:harness-sidebar-width';
export const TOOLBAR_SIDEBAR_WIDTH_CHANNEL =
  'dsh-desktop:toolbar-sidebar-width';

export function validatedSidebarWidth(
  value: unknown,
  viewportWidth: number,
): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > viewportWidth
  ) {
    return undefined;
  }
  return Math.round(value * 100) / 100;
}
