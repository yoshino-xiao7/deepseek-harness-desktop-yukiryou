export type DesktopCarrierMode = 'legacy' | 'integrated';

const DEFAULT_DESKTOP_CARRIER_MODE: DesktopCarrierMode = 'legacy';

export function resolveDesktopCarrierMode(
  value: string | undefined,
  integratedPrototype: string | undefined = undefined,
): DesktopCarrierMode {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') {
    return DEFAULT_DESKTOP_CARRIER_MODE;
  }
  if (normalized === 'legacy') return 'legacy';
  if (normalized === 'integrated') {
    return integratedPrototype === '1' ? 'integrated' : 'legacy';
  }
  throw new Error(
    `Invalid DSH_DESKTOP_CARRIER_MODE: ${normalized}. Expected legacy or integrated.`,
  );
}
