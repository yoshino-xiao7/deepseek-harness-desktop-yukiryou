export const WINDOW_MENU_CHANNEL = 'dsh-desktop:window-menu';

export const WINDOW_MENU_IDS = ['file', 'edit', 'view', 'help'] as const;
export type WindowMenuId = (typeof WINDOW_MENU_IDS)[number];

export interface WindowMenuRequest {
  readonly id: WindowMenuId;
  readonly x: number;
  readonly y: number;
}

export function validatedWindowMenuRequest(value: unknown): WindowMenuRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!WINDOW_MENU_IDS.includes(candidate.id as WindowMenuId)) return undefined;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return undefined;
  const x = Math.round(candidate.x as number);
  const y = Math.round(candidate.y as number);
  if (x < 0 || y < 0 || x > 4_096 || y > 4_096) return undefined;
  return { id: candidate.id as WindowMenuId, x, y };
}
