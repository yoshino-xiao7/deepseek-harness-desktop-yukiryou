export const PET_PLAYER_PROTOCOL_VERSION = 1;
export const PET_PLAYER_INIT_CHANNEL = 'deepseek-yukiryou:pet-player:init';
export const PET_PLAYER_WINDOW_PORT_MESSAGE = 'deepseek-yukiryou:pet-player-port';
export const PET_PLAYER_MAX_ASSET_BYTES = 64 * 1_024 * 1_024;

export interface PetPlayerProtocolContext {
  readonly realmEpoch: string;
  readonly nonce: string;
  readonly petGeneration: number;
  readonly presentationGeneration: number;
}

export interface PetPlayerInitEnvelope {
  readonly protocolVersion: typeof PET_PLAYER_PROTOCOL_VERSION;
  readonly realmEpoch: string;
  readonly nonce: string;
}

export type PetSemanticState =
  | 'standing'
  | 'drowsy'
  | 'lying-down'
  | 'sleeping'
  | 'waking'
  | 'rubbing-eyes'
  | 'work-enter'
  | 'eating'
  | 'work-exit';

export type PetPlayerHostMessage =
  | {
    readonly kind: 'load-asset';
    readonly realmEpoch: string;
    readonly petGeneration: number;
    readonly runtime: 'rive-canvas-lite' | 'frame-sequence-canvas2d' | 'layered-rig-canvas2d';
    readonly assetByteLength: number;
    readonly assetSha256: string;
    readonly assetBytes: ArrayBuffer;
  }
  | {
    readonly kind: 'present';
    readonly realmEpoch: string;
    readonly petGeneration: number;
    readonly presentationGeneration: number;
    readonly state: PetSemanticState;
    readonly visible: boolean;
    readonly reducedMotion: boolean;
    readonly viewport: {
      readonly width: number;
      readonly height: number;
      readonly devicePixelRatio: number;
    };
  }
  | { readonly kind: 'dispose'; readonly realmEpoch: string };

export type PetPlayerOutputMessage =
  | {
    readonly kind: 'hello';
    readonly protocolVersion: typeof PET_PLAYER_PROTOCOL_VERSION;
    readonly realmEpoch: string;
    readonly nonce: string;
  }
  | { readonly kind: 'heartbeat'; readonly realmEpoch: string }
  | {
    readonly kind: 'ready';
    readonly realmEpoch: string;
    readonly petGeneration: number;
  }
  | {
    readonly kind: 'metrics';
    readonly realmEpoch: string;
    readonly petGeneration: number;
    readonly presentationGeneration: number;
    readonly sampleWindowMs: number;
    readonly refreshPeriodMs: number;
    readonly frameP95Ms: number;
    readonly frameP99Ms: number;
    readonly overDoublePeriodRatio: number;
    readonly consecutiveMissedFrames: number;
    readonly longTaskCount: number;
  }
  | {
    readonly kind: 'failure';
    readonly realmEpoch: string;
    readonly petGeneration: number;
    readonly code: 'asset-load-failed' | 'renderer-unavailable' | 'runtime-error';
    readonly detail?: string;
  }
  | {
    readonly kind: 'marker';
    readonly realmEpoch: string;
    readonly petGeneration: number;
    readonly presentationGeneration: number;
    readonly marker: string;
  }
  | {
    readonly kind: 'activation';
    readonly realmEpoch: string;
    readonly petGeneration: number;
    readonly presentationGeneration: number;
  };

export type PetPlayerOutputResult =
  | { readonly status: 'accepted'; readonly message: PetPlayerOutputMessage }
  | {
    readonly status: 'rejected';
    readonly code:
      | 'invalid-message'
      | 'message-too-large'
      | 'byte-rate-limit'
      | 'hello-required'
      | 'hello-already-received'
      | 'stale-generation'
      | 'rate-limit';
  };

export interface PetPlayerOutputGuard {
  accept(value: unknown, now: number): PetPlayerOutputResult;
  updateGenerations(generations: Pick<PetPlayerProtocolContext, 'petGeneration' | 'presentationGeneration'>): void;
}

export function parsePetPlayerInitEnvelope(value: unknown): PetPlayerInitEnvelope | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['protocolVersion', 'realmEpoch', 'nonce'])
    || value.protocolVersion !== PET_PLAYER_PROTOCOL_VERSION
    || !isOpaque128BitId(value.realmEpoch)
    || !isOpaque128BitId(value.nonce)
  ) return undefined;
  return value as unknown as PetPlayerInitEnvelope;
}

export function parsePetPlayerHostMessage(
  value: unknown,
  context: PetPlayerProtocolContext,
): PetPlayerHostMessage | undefined {
  const message = parsePetPlayerHostMessageForRealm(value, context.realmEpoch);
  if (message === undefined) return undefined;
  if (
    message.kind !== 'dispose'
    && (message.petGeneration !== context.petGeneration
      || (message.kind === 'present' && message.presentationGeneration !== context.presentationGeneration))
  ) return undefined;
  return message;
}

export function parsePetPlayerHostMessageForRealm(
  value: unknown,
  realmEpoch: string,
): PetPlayerHostMessage | undefined {
  if (!isRecord(value) || value.realmEpoch !== realmEpoch) return undefined;
  if (value.kind === 'dispose' && hasExactKeys(value, ['kind', 'realmEpoch'])) {
    return { kind: 'dispose', realmEpoch };
  }
  if (
    value.kind === 'load-asset'
    && hasExactKeys(value, [
      'kind',
      'realmEpoch',
      'petGeneration',
      'runtime',
      'assetByteLength',
      'assetSha256',
      'assetBytes',
    ])
    && isGeneration(value.petGeneration)
    && (value.runtime === 'rive-canvas-lite' || value.runtime === 'frame-sequence-canvas2d' || value.runtime === 'layered-rig-canvas2d')
    && Number.isSafeInteger(value.assetByteLength)
    && (value.assetByteLength as number) > 0
    && (value.assetByteLength as number) <= PET_PLAYER_MAX_ASSET_BYTES
    && typeof value.assetSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.assetSha256)
    && value.assetBytes instanceof ArrayBuffer
    && value.assetBytes.byteLength === value.assetByteLength
  ) return value as unknown as PetPlayerHostMessage;
  if (
    value.kind !== 'present'
    || !hasExactKeys(value, [
      'kind',
      'realmEpoch',
      'petGeneration',
      'presentationGeneration',
      'state',
      'visible',
      'reducedMotion',
      'viewport',
    ])
    || !isGeneration(value.petGeneration)
    || !isGeneration(value.presentationGeneration)
    || !isPetSemanticState(value.state)
    || typeof value.visible !== 'boolean'
    || typeof value.reducedMotion !== 'boolean'
    || !isViewport(value.viewport)
  ) return undefined;
  return value as unknown as PetPlayerHostMessage;
}

export interface PetPlayerOutputLimits {
  readonly maxMessageBytes?: number;
  readonly maxBytesPerSecond?: number;
}

const HARD_MAX_MESSAGE_BYTES = 16 * 1_024;
const HARD_MAX_BYTES_PER_SECOND = 128 * 1_024;

export function createPetPlayerOutputGuard(
  context: PetPlayerProtocolContext,
  requestedLimits: PetPlayerOutputLimits = {},
): PetPlayerOutputGuard {
  let activeContext = { ...context };
  let helloReceived = false;
  const eventTimes = new Map<PetPlayerOutputMessage['kind'], number[]>();
  let byteEvents: Array<{ readonly timestamp: number; readonly bytes: number }> = [];
  const maxMessageBytes = clampLimit(requestedLimits.maxMessageBytes, HARD_MAX_MESSAGE_BYTES);
  const maxBytesPerSecond = clampLimit(requestedLimits.maxBytesPerSecond, HARD_MAX_BYTES_PER_SECOND);
  return {
    accept(value: unknown, now: number): PetPlayerOutputResult {
      if (!Number.isFinite(now) || now < 0) return { status: 'rejected', code: 'invalid-message' };
      const messageBytes = serializedByteLength(value);
      if (messageBytes === undefined) return { status: 'rejected', code: 'invalid-message' };
      if (messageBytes > maxMessageBytes) return { status: 'rejected', code: 'message-too-large' };
      byteEvents = byteEvents.filter((event) => now - event.timestamp < 1_000);
      const bytesInWindow = byteEvents.reduce((total, event) => total + event.bytes, 0);
      if (bytesInWindow + messageBytes > maxBytesPerSecond) {
        return { status: 'rejected', code: 'byte-rate-limit' };
      }
      byteEvents.push({ timestamp: now, bytes: messageBytes });
      const message = parsePetPlayerOutput(value, activeContext);
      if (message === undefined) return { status: 'rejected', code: 'invalid-message' };
      if (!helloReceived && message.kind !== 'hello') return { status: 'rejected', code: 'hello-required' };
      if (message.kind === 'hello') {
        if (helloReceived) return { status: 'rejected', code: 'hello-already-received' };
        helloReceived = true;
      }
      if (
        message.kind !== 'hello'
        && message.kind !== 'heartbeat'
        && (message.petGeneration !== activeContext.petGeneration
          || ('presentationGeneration' in message
            && message.presentationGeneration !== activeContext.presentationGeneration))
      ) return { status: 'rejected', code: 'stale-generation' };
      const limit = eventRateLimit(message.kind);
      if (limit !== undefined) {
        const recent = (eventTimes.get(message.kind) ?? []).filter((timestamp) => now - timestamp < 1_000);
        if (recent.length >= limit) return { status: 'rejected', code: 'rate-limit' };
        eventTimes.set(message.kind, [...recent, now]);
      }
      return { status: 'accepted', message };
    },
    updateGenerations(generations): void {
      if (!isGeneration(generations.petGeneration) || !isGeneration(generations.presentationGeneration)) return;
      activeContext = { ...activeContext, ...generations };
    },
  };
}

function clampLimit(requested: number | undefined, hardMaximum: number): number {
  if (requested === undefined || !Number.isSafeInteger(requested) || requested <= 0) return hardMaximum;
  return Math.min(requested, hardMaximum);
}

function serializedByteLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return undefined;
  }
}

function parsePetPlayerOutput(
  value: unknown,
  context: PetPlayerProtocolContext,
): PetPlayerOutputMessage | undefined {
  if (!isRecord(value) || value.realmEpoch !== context.realmEpoch) return undefined;
  if (
    value.kind === 'hello'
    && hasExactKeys(value, ['kind', 'protocolVersion', 'realmEpoch', 'nonce'])
    && value.protocolVersion === PET_PLAYER_PROTOCOL_VERSION
    && value.nonce === context.nonce
  ) return value as PetPlayerOutputMessage;
  if (value.kind === 'heartbeat' && hasExactKeys(value, ['kind', 'realmEpoch'])) {
    return { kind: 'heartbeat', realmEpoch: context.realmEpoch };
  }
  if (
    value.kind === 'ready'
    && hasExactKeys(value, ['kind', 'realmEpoch', 'petGeneration'])
    && isGeneration(value.petGeneration)
  ) return value as PetPlayerOutputMessage;
  if (
    value.kind === 'metrics'
    && hasExactKeys(value, [
      'kind',
      'realmEpoch',
      'petGeneration',
      'presentationGeneration',
      'sampleWindowMs',
      'refreshPeriodMs',
      'frameP95Ms',
      'frameP99Ms',
      'overDoublePeriodRatio',
      'consecutiveMissedFrames',
      'longTaskCount',
    ])
    && isGeneration(value.petGeneration)
    && isGeneration(value.presentationGeneration)
    && isFiniteRange(value.sampleWindowMs, 100, 60_000)
    && isFiniteRange(value.refreshPeriodMs, 1, 1_000)
    && isFiniteRange(value.frameP95Ms, 0, 60_000)
    && isFiniteRange(value.frameP99Ms, 0, 60_000)
    && (value.frameP99Ms as number) >= (value.frameP95Ms as number)
    && isFiniteRange(value.overDoublePeriodRatio, 0, 1)
    && isGeneration(value.consecutiveMissedFrames)
    && isGeneration(value.longTaskCount)
  ) return value as PetPlayerOutputMessage;
  if (
    value.kind === 'failure'
    && hasOptionalDetailKeys(value)
    && isGeneration(value.petGeneration)
    && (value.code === 'asset-load-failed'
      || value.code === 'renderer-unavailable'
      || value.code === 'runtime-error')
    && (value.detail === undefined
      || (typeof value.detail === 'string' && value.detail.length <= 1_024))
  ) return value as PetPlayerOutputMessage;
  if (
    value.kind === 'marker'
    && hasExactKeys(value, ['kind', 'realmEpoch', 'petGeneration', 'presentationGeneration', 'marker'])
    && isGeneration(value.petGeneration)
    && isGeneration(value.presentationGeneration)
    && typeof value.marker === 'string'
    && /^[a-z][a-z0-9-]{0,63}$/.test(value.marker)
  ) return value as PetPlayerOutputMessage;
  if (
    value.kind === 'activation'
    && hasExactKeys(value, ['kind', 'realmEpoch', 'petGeneration', 'presentationGeneration'])
    && isGeneration(value.petGeneration)
    && isGeneration(value.presentationGeneration)
  ) return value as PetPlayerOutputMessage;
  return undefined;
}

function eventRateLimit(kind: PetPlayerOutputMessage['kind']): number | undefined {
  // Chromium can coalesce one delayed timer callback with the next scheduled
  // heartbeat after a heavy asset decode. Two still bounds the channel while
  // avoiding a false-positive realm teardown during legitimate startup.
  if (kind === 'heartbeat') return 2;
  if (kind === 'metrics') return 2;
  if (kind === 'ready') return 1;
  if (kind === 'failure') return 4;
  if (kind === 'marker') return 20;
  if (kind === 'activation') return 4;
  return undefined;
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isOpaque128BitId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

function isPetSemanticState(value: unknown): value is PetSemanticState {
  return value === 'standing'
    || value === 'drowsy'
    || value === 'lying-down'
    || value === 'sleeping'
    || value === 'waking'
    || value === 'rubbing-eyes'
    || value === 'work-enter'
    || value === 'eating'
    || value === 'work-exit';
}

function isViewport(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['width', 'height', 'devicePixelRatio'])
    && isFiniteRange(value.width, 1, 560)
    && isFiniteRange(value.height, 1, 320)
    && isFiniteRange(value.devicePixelRatio, 0.5, 4);
}

function hasOptionalDetailKeys(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, ['kind', 'realmEpoch', 'petGeneration', 'code'])
    || hasExactKeys(value, ['kind', 'realmEpoch', 'petGeneration', 'code', 'detail']);
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
