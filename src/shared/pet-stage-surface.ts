export const PET_STAGE_SURFACE_CHANNEL = 'deepseek-yukiryou:pet-stage:surface';
export const PET_STAGE_WAKE_CHANNEL = 'deepseek-yukiryou:pet-stage:wake';

export type PetStageSurfaceSnapshot =
  | { readonly visible: false }
  | {
    readonly visible: true;
    readonly bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly devicePixelRatio: number;
    readonly reducedMotion: boolean;
  };

export function validatedPetStageSurfaceSnapshot(value: unknown): PetStageSurfaceSnapshot | undefined {
  if (!isRecord(value) || typeof value.visible !== 'boolean') return undefined;
  if (value.visible === false && hasExactKeys(value, ['visible'])) return { visible: false };
  if (
    value.visible !== true
    || !hasExactKeys(value, ['visible', 'bounds', 'devicePixelRatio', 'reducedMotion'])
    || !isRecord(value.bounds)
    || !hasExactKeys(value.bounds, ['x', 'y', 'width', 'height'])
    || !isCoordinate(value.bounds.x)
    || !isCoordinate(value.bounds.y)
    || !isDimension(value.bounds.width, 560)
    || !isDimension(value.bounds.height, 320)
    || typeof value.devicePixelRatio !== 'number'
    || !Number.isFinite(value.devicePixelRatio)
    || value.devicePixelRatio < 0.5
    || value.devicePixelRatio > 4
    || typeof value.reducedMotion !== 'boolean'
  ) return undefined;
  return value as unknown as PetStageSurfaceSnapshot;
}

function isCoordinate(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 16_384;
}

function isDimension(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 64 && (value as number) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}
