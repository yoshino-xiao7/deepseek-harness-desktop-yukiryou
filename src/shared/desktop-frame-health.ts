export const DESKTOP_FRAME_HEALTH_CHANNEL =
  'deepseek-yukiryou:desktop-frame:health';

export interface DesktopFrameCapabilities {
  readonly integratedChrome: boolean;
  readonly resizablePanels: boolean;
  readonly shellOverlay: boolean;
}

export type DesktopFrameHealth =
  | {
      readonly protocolVersion: 1;
      readonly status: 'ready';
      readonly capabilities: DesktopFrameCapabilities;
    }
  | {
      readonly protocolVersion: 1;
      readonly status: 'incompatible';
      readonly reason: string;
      readonly capabilities: DesktopFrameCapabilities;
    };

export function validatedDesktopFrameHealth(
  value: unknown,
): DesktopFrameHealth | undefined {
  if (!isRecord(value) || value.protocolVersion !== 1) return undefined;
  const capabilities = validatedCapabilities(value.capabilities);
  if (capabilities === undefined) return undefined;
  if (value.status === 'ready') {
    return { protocolVersion: 1, status: 'ready', capabilities };
  }
  if (
    value.status === 'incompatible' &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    value.reason.length <= 240
  ) {
    return {
      protocolVersion: 1,
      status: 'incompatible',
      reason: value.reason,
      capabilities,
    };
  }
  return undefined;
}

function validatedCapabilities(
  value: unknown,
): DesktopFrameCapabilities | undefined {
  if (
    !isRecord(value) ||
    typeof value.integratedChrome !== 'boolean' ||
    typeof value.resizablePanels !== 'boolean' ||
    typeof value.shellOverlay !== 'boolean'
  ) {
    return undefined;
  }
  return {
    integratedChrome: value.integratedChrome,
    resizablePanels: value.resizablePanels,
    shellOverlay: value.shellOverlay,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
