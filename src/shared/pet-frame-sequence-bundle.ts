import { PET_MOTIONS, type PetMotion } from './pet-package.js';

const MAGIC = new TextEncoder().encode('YKFS0001');
const PREFIX_BYTES = MAGIC.byteLength + 4;
const MAX_HEADER_BYTES = 128 * 1024;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface PetFrameSequenceMotionAsset {
  readonly mediaType: 'image/png' | 'image/webp';
  readonly bytes: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly durationMs: number;
}

export interface PetFrameSequenceBundle {
  readonly motions: Readonly<Record<PetMotion, PetFrameSequenceMotionAsset>>;
}

export function encodePetFrameSequenceBundle(bundle: PetFrameSequenceBundle): ArrayBuffer {
  let offset = 0;
  const payloads: Uint8Array[] = [];
  const motions = Object.fromEntries(PET_MOTIONS.map((motion) => {
    const asset = bundle.motions[motion];
    const bytes = new Uint8Array(asset.bytes);
    const metadata = {
      mediaType: asset.mediaType,
      offset,
      byteLength: bytes.byteLength,
      width: asset.width,
      height: asset.height,
      columns: asset.columns,
      rows: asset.rows,
      frameCount: asset.frameCount,
      durationMs: asset.durationMs,
    };
    offset += bytes.byteLength;
    payloads.push(bytes);
    return [motion, metadata];
  }));
  const header = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, motions }));
  if (header.byteLength > MAX_HEADER_BYTES || PREFIX_BYTES + header.byteLength + offset > MAX_BUNDLE_BYTES) {
    throw new Error('frame-sequence bundle exceeds limits');
  }
  const output = new Uint8Array(PREFIX_BYTES + header.byteLength + offset);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(MAGIC.byteLength, header.byteLength, true);
  output.set(header, PREFIX_BYTES);
  let payloadOffset = PREFIX_BYTES + header.byteLength;
  for (const payload of payloads) {
    output.set(payload, payloadOffset);
    payloadOffset += payload.byteLength;
  }
  return output.buffer;
}

export function parsePetFrameSequenceBundle(input: ArrayBuffer): PetFrameSequenceBundle | undefined {
  if (input.byteLength < PREFIX_BYTES || input.byteLength > MAX_BUNDLE_BYTES) return undefined;
  const bytes = new Uint8Array(input);
  if (!MAGIC.every((value, index) => bytes[index] === value)) return undefined;
  const headerLength = new DataView(input).getUint32(MAGIC.byteLength, true);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES || PREFIX_BYTES + headerLength >= bytes.byteLength) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength)));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['schemaVersion', 'motions']) || parsed.schemaVersion !== 1) return undefined;
  if (!isRecord(parsed.motions) || !hasExactKeys(parsed.motions, PET_MOTIONS)) return undefined;
  const payloadStart = PREFIX_BYTES + headerLength;
  let expectedOffset = 0;
  const motions = {} as Record<PetMotion, PetFrameSequenceMotionAsset>;
  for (const motion of PET_MOTIONS) {
    const value = parsed.motions[motion];
    if (!isRecord(value) || !hasExactKeys(value, [
      'mediaType', 'offset', 'byteLength', 'width', 'height', 'columns', 'rows', 'frameCount', 'durationMs',
    ])) return undefined;
    if (
      (value.mediaType !== 'image/png' && value.mediaType !== 'image/webp')
      || value.offset !== expectedOffset
      || !integer(value.byteLength, 1, MAX_BUNDLE_BYTES)
      || !integer(value.width, 1, 8_192)
      || !integer(value.height, 1, 8_192)
      || !integer(value.columns, 1, 256)
      || !integer(value.rows, 1, 256)
      || !integer(value.frameCount, 2, 240)
      || (value.width as number) % (value.columns as number) !== 0
      || (value.height as number) % (value.rows as number) !== 0
      || (value.columns as number) * (value.rows as number) < (value.frameCount as number)
      || !integer(value.durationMs, 100, 60_000)
    ) return undefined;
    const end = expectedOffset + (value.byteLength as number);
    if (payloadStart + end > bytes.byteLength) return undefined;
    motions[motion] = {
      mediaType: value.mediaType,
      bytes: bytes.slice(payloadStart + expectedOffset, payloadStart + end).buffer,
      width: value.width as number,
      height: value.height as number,
      columns: value.columns as number,
      rows: value.rows as number,
      frameCount: value.frameCount as number,
      durationMs: value.durationMs as number,
    };
    expectedOffset = end;
  }
  if (payloadStart + expectedOffset !== bytes.byteLength) return undefined;
  return { motions };
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
