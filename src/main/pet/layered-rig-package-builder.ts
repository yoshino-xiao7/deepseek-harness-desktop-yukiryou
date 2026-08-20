import { PET_MOTIONS } from '../../shared/pet-package.js';
import { validatePetLayeredRigManifest } from '../../shared/pet-layered-rig.js';
import {
  buildStoredZip,
  canonicalPetPackageJson,
  hashPetPackageBytes,
  type StoredZipEntry,
} from './pet-package-builder.js';
import { isValidPetThumbnail, petRasterDimensions, type PetThumbnailMediaType } from './pet-thumbnail-validation.js';

export interface LayeredRigPackagePart {
  readonly mediaType: 'image/png' | 'image/webp';
  readonly bytes: Uint8Array;
}

export interface LayeredRigPackageInput {
  readonly id: string;
  readonly displayName: Readonly<{ 'zh-CN': string; en: string }>;
  readonly author: string;
  readonly license: string;
  readonly source: string;
  readonly thumbnail: Readonly<{ mediaType: PetThumbnailMediaType; bytes: Uint8Array }>;
  readonly rig: unknown;
  readonly parts: ReadonlyMap<string, LayeredRigPackagePart>;
}

export function buildLayeredRigPetPackage(input: LayeredRigPackageInput): Uint8Array {
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(input.id)) throw new Error('invalid pet id');
  const rig = validatePetLayeredRigManifest(input.rig);
  if (rig === undefined || input.parts.size !== rig.assets.length) throw new Error('invalid layered rig');
  const thumbnailBytes = Buffer.from(input.thumbnail.bytes);
  if (!isValidPetThumbnail(thumbnailBytes, input.thumbnail.mediaType)) throw new Error('invalid thumbnail');
  const thumbnailPath = input.thumbnail.mediaType === 'image/png' ? 'thumbnail.png' : 'thumbnail.webp';
  const payloadEntries: StoredZipEntry[] = [
    { path: thumbnailPath, bytes: thumbnailBytes },
    { path: 'payload/rig.json', bytes: Buffer.from(JSON.stringify(rig)) },
  ];
  for (const asset of rig.assets) {
    const part = input.parts.get(asset.id);
    const expectedMediaType = asset.path.endsWith('.png') ? 'image/png' : 'image/webp';
    if (part === undefined || part.mediaType !== expectedMediaType) throw new Error('missing layered rig part');
    const bytes = Buffer.from(part.bytes);
    const dimensions = petRasterDimensions(bytes, part.mediaType);
    if (dimensions?.width !== asset.width || dimensions.height !== asset.height) throw new Error('layered rig part dimensions mismatch');
    payloadEntries.push({ path: `payload/${asset.path}`, bytes });
  }
  payloadEntries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const files = payloadEntries.map((entry) => ({
    path: entry.path,
    role: entry.path === thumbnailPath ? 'thumbnail' : 'animation',
    mediaType: mediaType(entry.path),
    byteLength: entry.bytes.byteLength,
    sha256: hashPetPackageBytes(entry.bytes),
  }));
  const manifestWithoutHash = {
    schemaVersion: 0,
    id: input.id,
    name: input.displayName,
    author: input.author,
    license: input.license,
    source: input.source,
    runtime: {
      adapter: 'layered-rig-canvas2d',
      adapterContractVersion: 1,
      assetFormat: { family: 'layered-rig', major: 1 },
    },
    viewport: { width: 1024, height: 640, baseline: 600 },
    motions: Object.fromEntries(PET_MOTIONS.map((motion) => [motion, {}])),
    files,
  };
  const manifest = {
    ...manifestWithoutHash,
    packageContentHash: hashPetPackageBytes(Buffer.from(canonicalPetPackageJson(manifestWithoutHash))),
  };
  return buildStoredZip([
    { path: 'pet.json', bytes: Buffer.from(JSON.stringify(manifest)) },
    ...payloadEntries,
  ]);
}

function mediaType(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'application/json';
}
