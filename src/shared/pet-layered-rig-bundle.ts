import {
  validatePetLayeredRigManifest,
  type PetLayeredRigManifest,
} from './pet-layered-rig.js';

const MAGIC = new TextEncoder().encode('YKLR0001');
const HEADER_BYTES = 4;
const MAX_HEADER_BYTES = 256 * 1_024;
const MAX_BUNDLE_BYTES = 64 * 1_024 * 1_024;

export interface PetLayeredRigBundleAsset {
  readonly id: string;
  readonly mediaType: 'image/png' | 'image/webp';
  readonly bytes: ArrayBuffer;
}

export interface PetLayeredRigBundle {
  readonly manifest: PetLayeredRigManifest;
  readonly assets: ReadonlyMap<string, PetLayeredRigBundleAsset>;
}

interface BundleHeader {
  readonly manifest: PetLayeredRigManifest;
  readonly assets: readonly {
    readonly id: string;
    readonly mediaType: 'image/png' | 'image/webp';
    readonly offset: number;
    readonly byteLength: number;
  }[];
}

export function createPetLayeredRigBundle(input: {
  readonly manifest: unknown;
  readonly assets: ReadonlyMap<string, Readonly<{ mediaType: 'image/png' | 'image/webp'; bytes: ArrayBuffer }>>;
}): ArrayBuffer | undefined {
  const manifest = validatePetLayeredRigManifest(input.manifest);
  if (manifest === undefined || input.assets.size !== manifest.assets.length) return undefined;
  let offset = 0;
  const assets: BundleHeader['assets'][number][] = [];
  for (const definition of manifest.assets) {
    const asset = input.assets.get(definition.id);
    const expectedMediaType = definition.path.endsWith('.png') ? 'image/png' : 'image/webp';
    if (asset === undefined || asset.mediaType !== expectedMediaType || asset.bytes.byteLength < 1) return undefined;
    assets.push({ id: definition.id, mediaType: asset.mediaType, offset, byteLength: asset.bytes.byteLength });
    offset += asset.bytes.byteLength;
    if (!Number.isSafeInteger(offset) || offset > MAX_BUNDLE_BYTES) return undefined;
  }
  const header = new TextEncoder().encode(JSON.stringify({ manifest, assets } satisfies BundleHeader));
  const total = MAGIC.byteLength + HEADER_BYTES + header.byteLength + offset;
  if (header.byteLength > MAX_HEADER_BYTES || total > MAX_BUNDLE_BYTES) return undefined;
  const output = new Uint8Array(total);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(MAGIC.byteLength, header.byteLength, false);
  output.set(header, MAGIC.byteLength + HEADER_BYTES);
  let cursor = MAGIC.byteLength + HEADER_BYTES + header.byteLength;
  for (const definition of manifest.assets) {
    output.set(new Uint8Array(input.assets.get(definition.id)!.bytes), cursor);
    cursor += input.assets.get(definition.id)!.bytes.byteLength;
  }
  return output.buffer;
}

export function parsePetLayeredRigBundle(input: ArrayBuffer): PetLayeredRigBundle | undefined {
  if (input.byteLength <= MAGIC.byteLength + HEADER_BYTES || input.byteLength > MAX_BUNDLE_BYTES) return undefined;
  const bytes = new Uint8Array(input);
  if (!MAGIC.every((value, index) => bytes[index] === value)) return undefined;
  const headerLength = new DataView(input).getUint32(MAGIC.byteLength, false);
  const payloadStart = MAGIC.byteLength + HEADER_BYTES + headerLength;
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES || payloadStart > input.byteLength) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(MAGIC.byteLength + HEADER_BYTES, payloadStart)));
  } catch {
    return undefined;
  }
  if (!record(raw) || !exact(raw, ['manifest', 'assets']) || !Array.isArray(raw.assets)) return undefined;
  const manifest = validatePetLayeredRigManifest(raw.manifest);
  if (manifest === undefined || raw.assets.length !== manifest.assets.length) return undefined;
  const parsed = new Map<string, PetLayeredRigBundleAsset>();
  let expectedOffset = 0;
  for (let index = 0; index < manifest.assets.length; index += 1) {
    const value = raw.assets[index];
    const definition = manifest.assets[index]!;
    if (!record(value) || !exact(value, ['id', 'mediaType', 'offset', 'byteLength'])) return undefined;
    const expectedMediaType = definition.path.endsWith('.png') ? 'image/png' : 'image/webp';
    if (
      value.id !== definition.id
      || value.mediaType !== expectedMediaType
      || value.offset !== expectedOffset
      || !Number.isSafeInteger(value.byteLength)
      || (value.byteLength as number) < 1
    ) return undefined;
    const start = payloadStart + expectedOffset;
    const end = start + (value.byteLength as number);
    if (!Number.isSafeInteger(end) || end > input.byteLength) return undefined;
    parsed.set(definition.id, {
      id: definition.id,
      mediaType: expectedMediaType,
      bytes: input.slice(start, end),
    });
    expectedOffset += value.byteLength as number;
  }
  if (payloadStart + expectedOffset !== input.byteLength) return undefined;
  return { manifest, assets: parsed };
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
