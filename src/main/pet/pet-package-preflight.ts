import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

import {
  PET_MOTIONS,
  PET_PACKAGE_LIMITS,
  type DraftPetPackageSummary,
  type PetPackageRejectionReason,
  type PetPackagePreflightResult,
} from '../../shared/pet-package.js';
import { encodePetFrameSequenceBundle } from '../../shared/pet-frame-sequence-bundle.js';
import { createPetLayeredRigBundle } from '../../shared/pet-layered-rig-bundle.js';
import { validatePetLayeredRigManifest } from '../../shared/pet-layered-rig.js';
import { isValidPetThumbnail } from './pet-thumbnail-validation.js';
import { petRasterDimensions } from './pet-thumbnail-validation.js';

interface ArchiveFile {
  readonly path: string;
  readonly data: Buffer;
}

interface ManifestFile {
  readonly path: string;
  readonly role: 'thumbnail' | 'animation' | 'license';
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface ManifestRuntime {
  readonly adapter: string;
  readonly adapterContractVersion: 1;
  readonly assetFormat: Readonly<{ family: string; major: 1 }>;
}

type InspectedPetPackage =
  | {
    readonly status: 'accepted';
    readonly package: DraftPetPackageSummary;
    readonly files: readonly ArchiveFile[];
    readonly manifest: Readonly<{ runtime: ManifestRuntime; files: readonly ManifestFile[] }>;
  }
  | Extract<PetPackagePreflightResult, { status: 'rejected' }>;

export type RiveRuntimeCandidateResult =
  | {
    readonly status: 'accepted';
    readonly package: DraftPetPackageSummary;
    readonly candidate: {
      readonly runtime: 'rive-canvas-lite';
      readonly assetSha256: string;
      readonly assetBytes: ArrayBuffer;
    };
  }
  | Extract<PetPackagePreflightResult, { status: 'rejected' }>
  | {
    readonly status: 'rejected';
    readonly code: 'pet-runtime-incompatible';
    readonly reason: 'runtime-contract' | 'animation-inventory';
    readonly package: DraftPetPackageSummary;
  };

export type FrameSequenceRuntimeCandidateResult =
  | {
    readonly status: 'accepted';
    readonly package: DraftPetPackageSummary;
    readonly candidate: {
      readonly runtime: 'frame-sequence-canvas2d';
      readonly assetSha256: string;
      readonly assetBytes: ArrayBuffer;
    };
  }
  | Extract<PetPackagePreflightResult, { status: 'rejected' }>
  | {
    readonly status: 'rejected';
    readonly code: 'pet-runtime-incompatible';
    readonly reason: 'runtime-contract' | 'animation-inventory' | 'animation-metadata' | 'animation-budget';
    readonly package: DraftPetPackageSummary;
  };

export type LayeredRigRuntimeCandidateResult =
  | {
    readonly status: 'accepted';
    readonly package: DraftPetPackageSummary;
    readonly candidate: {
      readonly runtime: 'layered-rig-canvas2d';
      readonly assetSha256: string;
      readonly assetBytes: ArrayBuffer;
    };
  }
  | Extract<PetPackagePreflightResult, { status: 'rejected' }>
  | {
    readonly status: 'rejected';
    readonly code: 'pet-runtime-incompatible';
    readonly reason: 'runtime-contract' | 'animation-inventory' | 'animation-metadata' | 'animation-budget';
    readonly package: DraftPetPackageSummary;
  };

const PROHIBITED_EXTENSIONS = new Set([
  '.css', '.dylib', '.eot', '.html', '.htm', '.js', '.mjs', '.cjs', '.node',
  '.otf', '.sh', '.so', '.svg', '.ttf', '.wasm', '.woff', '.woff2',
]);
const PROHIBITED_MEDIA_TYPES = new Set([
  'application/javascript', 'application/wasm', 'image/svg+xml', 'text/css', 'text/html',
]);

class PetPackagePreflightFailure extends Error {
  constructor(
    readonly code: 'pet-package-invalid' | 'pet-package-too-large' | 'pet-package-unsafe',
    readonly reason: PetPackageRejectionReason,
  ) {
    super(reason);
  }
}

export async function preflightPetPackage(archive: Uint8Array): Promise<PetPackagePreflightResult> {
  const result = await inspectPetPackage(archive);
  return result.status === 'accepted'
    ? { status: 'accepted', package: result.package }
    : result;
}

export async function prepareRiveRuntimeCandidate(archive: Uint8Array): Promise<RiveRuntimeCandidateResult> {
  const result = await inspectPetPackage(archive);
  if (result.status === 'rejected') return result;
  const runtime = result.manifest.runtime;
  if (
    runtime.adapter !== 'rive-canvas-lite'
    || runtime.adapterContractVersion !== 1
    || runtime.assetFormat.family !== 'rive'
    || runtime.assetFormat.major !== 1
  ) return { status: 'rejected', code: 'pet-runtime-incompatible', reason: 'runtime-contract', package: result.package };
  const animations = result.manifest.files.filter((file) => file.role === 'animation');
  if (
    animations.length !== 1
    || !animations[0]!.path.toLowerCase().endsWith('.riv')
    || animations[0]!.mediaType !== 'application/x-rive'
  ) return { status: 'rejected', code: 'pet-runtime-incompatible', reason: 'animation-inventory', package: result.package };
  const animation = animations[0]!;
  const payload = result.files.find((file) => file.path === animation.path);
  if (payload === undefined) {
    return { status: 'rejected', code: 'pet-runtime-incompatible', reason: 'animation-inventory', package: result.package };
  }
  const bytes = Uint8Array.from(payload.data).buffer;
  return {
    status: 'accepted',
    package: result.package,
    candidate: {
      runtime: 'rive-canvas-lite',
      assetSha256: animation.sha256,
      assetBytes: bytes,
    },
  };
}

export async function prepareFrameSequenceRuntimeCandidate(
  archive: Uint8Array,
): Promise<FrameSequenceRuntimeCandidateResult> {
  const result = await inspectPetPackage(archive);
  if (result.status === 'rejected') return result;
  const runtime = result.manifest.runtime;
  if (
    runtime.adapter !== 'frame-sequence-canvas2d'
    || runtime.adapterContractVersion !== 1
    || runtime.assetFormat.family !== 'frame-sequence-atlas'
    || runtime.assetFormat.major !== 1
  ) return incompatibleFrameSequence(result.package, 'runtime-contract');
  const timelineInventory = result.manifest.files.filter((file) =>
    file.role === 'animation' && file.path === 'payload/timeline.json' && file.mediaType === 'application/json');
  if (timelineInventory.length !== 1) return incompatibleFrameSequence(result.package, 'animation-inventory');
  const timelineFile = result.files.find((file) => file.path === 'payload/timeline.json');
  if (timelineFile === undefined || timelineFile.data.byteLength > PET_PACKAGE_LIMITS.manifestBytes) {
    return incompatibleFrameSequence(result.package, 'animation-inventory');
  }
  const timeline = parseFrameSequenceTimeline(timelineFile.data);
  if (timeline === undefined) return incompatibleFrameSequence(result.package, 'animation-metadata');
  let totalPixels = 0;
  let totalFrames = 0;
  const motions = {} as Record<typeof PET_MOTIONS[number], {
    bytes: ArrayBuffer;
    mediaType: 'image/png' | 'image/webp';
    width: number;
    height: number;
    columns: number;
    rows: number;
    frameCount: number;
    durationMs: number;
  }>;
  for (const motion of PET_MOTIONS) {
    const metadata = timeline.motions[motion];
    const inventory = result.manifest.files.find((file) => file.path === metadata.path);
    const file = result.files.find((candidate) => candidate.path === metadata.path);
    if (
      inventory === undefined
      || file === undefined
      || inventory.role !== 'animation'
      || (inventory.mediaType !== 'image/png' && inventory.mediaType !== 'image/webp')
    ) return incompatibleFrameSequence(result.package, 'animation-inventory');
    const dimensions = petRasterDimensions(file.data, inventory.mediaType);
    if (dimensions?.width !== metadata.width || dimensions.height !== metadata.height) {
      return incompatibleFrameSequence(result.package, 'animation-metadata');
    }
    totalPixels += metadata.width * metadata.height;
    totalFrames += metadata.frameCount;
    motions[motion] = {
      bytes: Uint8Array.from(file.data).buffer,
      mediaType: inventory.mediaType,
      width: metadata.width,
      height: metadata.height,
      columns: metadata.columns,
      rows: metadata.rows,
      frameCount: metadata.frameCount,
      durationMs: metadata.durationMs,
    };
  }
  const declaredAnimationPaths = result.manifest.files
    .filter((file) => file.role === 'animation')
    .map((file) => file.path);
  const expectedAnimationPaths = ['payload/timeline.json', ...PET_MOTIONS.map((motion) => timeline.motions[motion].path)];
  if (
    new Set(expectedAnimationPaths).size !== expectedAnimationPaths.length
    || declaredAnimationPaths.length !== expectedAnimationPaths.length
    || expectedAnimationPaths.some((path) => !declaredAnimationPaths.includes(path))
  ) return incompatibleFrameSequence(result.package, 'animation-inventory');
  if (totalPixels > 64 * 1024 * 1024 || totalFrames > 1_440) {
    return incompatibleFrameSequence(result.package, 'animation-budget');
  }
  const assetBytes = encodePetFrameSequenceBundle({ motions });
  return {
    status: 'accepted',
    package: result.package,
    candidate: {
      runtime: 'frame-sequence-canvas2d',
      assetSha256: sha256(Buffer.from(assetBytes)),
      assetBytes,
    },
  };
}

export async function prepareLayeredRigRuntimeCandidate(
  archive: Uint8Array,
): Promise<LayeredRigRuntimeCandidateResult> {
  const result = await inspectPetPackage(archive);
  if (result.status === 'rejected') return result;
  const runtime = result.manifest.runtime;
  if (
    runtime.adapter !== 'layered-rig-canvas2d'
    || runtime.adapterContractVersion !== 1
    || runtime.assetFormat.family !== 'layered-rig'
    || runtime.assetFormat.major !== 1
  ) return incompatibleLayeredRig(result.package, 'runtime-contract');
  const rigInventory = result.manifest.files.filter((file) =>
    file.role === 'animation' && file.path === 'payload/rig.json' && file.mediaType === 'application/json');
  const rigFile = result.files.find((file) => file.path === 'payload/rig.json');
  if (rigInventory.length !== 1 || rigFile === undefined || rigFile.data.byteLength > PET_PACKAGE_LIMITS.manifestBytes) {
    return incompatibleLayeredRig(result.package, 'animation-inventory');
  }
  let rawRig: unknown;
  try {
    rawRig = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rigFile.data));
  } catch {
    return incompatibleLayeredRig(result.package, 'animation-metadata');
  }
  const rig = validatePetLayeredRigManifest(rawRig);
  if (rig === undefined) return incompatibleLayeredRig(result.package, 'animation-metadata');
  const assets = new Map<string, { mediaType: 'image/png' | 'image/webp'; bytes: ArrayBuffer }>();
  let decodedPixels = 0;
  const expectedAnimationPaths = ['payload/rig.json'];
  for (const definition of rig.assets) {
    const path = `payload/${definition.path}`;
    expectedAnimationPaths.push(path);
    const inventory = result.manifest.files.find((file) => file.path === path);
    const file = result.files.find((candidate) => candidate.path === path);
    if (
      inventory === undefined
      || file === undefined
      || inventory.role !== 'animation'
      || (inventory.mediaType !== 'image/png' && inventory.mediaType !== 'image/webp')
    ) return incompatibleLayeredRig(result.package, 'animation-inventory');
    const dimensions = petRasterDimensions(file.data, inventory.mediaType);
    if (dimensions?.width !== definition.width || dimensions.height !== definition.height) {
      return incompatibleLayeredRig(result.package, 'animation-metadata');
    }
    decodedPixels += definition.width * definition.height;
    assets.set(definition.id, { mediaType: inventory.mediaType, bytes: Uint8Array.from(file.data).buffer });
  }
  const declaredAnimationPaths = result.manifest.files.filter((file) => file.role === 'animation').map((file) => file.path);
  if (
    new Set(expectedAnimationPaths).size !== expectedAnimationPaths.length
    || declaredAnimationPaths.length !== expectedAnimationPaths.length
    || expectedAnimationPaths.some((path) => !declaredAnimationPaths.includes(path))
  ) return incompatibleLayeredRig(result.package, 'animation-inventory');
  if (decodedPixels > 32 * 1_024 * 1_024) return incompatibleLayeredRig(result.package, 'animation-budget');
  const assetBytes = createPetLayeredRigBundle({ manifest: rig, assets });
  if (assetBytes === undefined) return incompatibleLayeredRig(result.package, 'animation-budget');
  return {
    status: 'accepted',
    package: result.package,
    candidate: {
      runtime: 'layered-rig-canvas2d',
      assetSha256: sha256(Buffer.from(assetBytes)),
      assetBytes,
    },
  };
}

function incompatibleLayeredRig(
  packageSummary: DraftPetPackageSummary,
  reason: Extract<LayeredRigRuntimeCandidateResult, { code: 'pet-runtime-incompatible' }>['reason'],
): LayeredRigRuntimeCandidateResult {
  return { status: 'rejected', code: 'pet-runtime-incompatible', reason, package: packageSummary };
}

interface FrameSequenceTimelineMotion {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly durationMs: number;
}

interface FrameSequenceTimeline {
  readonly schemaVersion: 1;
  readonly renderer: 'canvas2d';
  readonly motions: Readonly<Record<typeof PET_MOTIONS[number], FrameSequenceTimelineMotion>>;
}

function parseFrameSequenceTimeline(data: Buffer): FrameSequenceTimeline | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['schemaVersion', 'renderer', 'motions'])) return undefined;
  if (parsed.schemaVersion !== 1 || parsed.renderer !== 'canvas2d' || !isRecord(parsed.motions) || !hasExactKeys(parsed.motions, PET_MOTIONS)) return undefined;
  const motions = {} as Record<typeof PET_MOTIONS[number], FrameSequenceTimelineMotion>;
  for (const motion of PET_MOTIONS) {
    const value = parsed.motions[motion];
    if (!isRecord(value) || !hasExactKeys(value, ['path', 'width', 'height', 'columns', 'rows', 'frameCount', 'durationMs'])) return undefined;
    if (
      typeof value.path !== 'string'
      || !isSafeArchivePath(value.path)
      || !isBoundedInteger(value.width, 1, 8_192)
      || !isBoundedInteger(value.height, 1, 8_192)
      || !isBoundedInteger(value.columns, 1, 256)
      || !isBoundedInteger(value.rows, 1, 256)
      || !isBoundedInteger(value.frameCount, 2, 240)
      || (value.columns as number) * (value.rows as number) < (value.frameCount as number)
      || !isBoundedInteger(value.durationMs, 100, 60_000)
    ) return undefined;
    motions[motion] = value as unknown as FrameSequenceTimelineMotion;
  }
  return { schemaVersion: 1, renderer: 'canvas2d', motions };
}

function incompatibleFrameSequence(
  summary: DraftPetPackageSummary,
  reason: Extract<FrameSequenceRuntimeCandidateResult, { status: 'rejected'; code: 'pet-runtime-incompatible' }>['reason'],
): Extract<FrameSequenceRuntimeCandidateResult, { status: 'rejected'; code: 'pet-runtime-incompatible' }> {
  return { status: 'rejected', code: 'pet-runtime-incompatible', reason, package: summary };
}

async function inspectPetPackage(archive: Uint8Array): Promise<InspectedPetPackage> {
  if (archive.byteLength > PET_PACKAGE_LIMITS.archiveBytes) {
    return rejected('pet-package-too-large', 'archive-too-large');
  }

  let files: readonly ArchiveFile[];
  try {
    files = await readArchive(Buffer.from(archive));
  } catch (error) {
    if (error instanceof PetPackagePreflightFailure) return rejected(error.code, error.reason);
    if (isUnsafeArchivePathError(error)) return rejected('pet-package-unsafe', 'unsafe-path');
    return rejected('pet-package-invalid', 'invalid-zip');
  }

  if (new Set(files.map((file) => normalizedPathIdentity(file.path))).size !== files.length) {
    return rejected('pet-package-unsafe', 'duplicate-path');
  }

  const manifestFile = files.find((file) => file.path === 'pet.json');
  if (manifestFile === undefined || manifestFile.data.byteLength > PET_PACKAGE_LIMITS.manifestBytes) {
    return rejected('pet-package-invalid', 'invalid-manifest');
  }

  const manifest = parseManifest(manifestFile.data);
  if (manifest === undefined) return rejected('pet-package-invalid', 'invalid-manifest');

  if (manifest.files.some((file) => isProhibitedPayload(file.path, file.mediaType))) {
    return rejected('pet-package-unsafe', 'prohibited-file');
  }

  const expectedContentHash = sha256(Buffer.from(canonicalJson(withoutContentHash(manifest.raw))));
  if (manifest.packageContentHash !== expectedContentHash) {
    return rejected('pet-package-invalid', 'hash-mismatch');
  }

  const payloadFiles = files.filter((file) => file.path !== 'pet.json');
  const payloadIdentities = new Set(payloadFiles.map((file) => normalizedPathIdentity(file.path)));
  if (payloadIdentities.size !== payloadFiles.length) {
    return rejected('pet-package-unsafe', 'duplicate-path');
  }
  if (payloadFiles.length !== manifest.files.length) {
    return rejected('pet-package-invalid', 'inventory-mismatch');
  }
  const payloadByPath = new Map(payloadFiles.map((file) => [file.path, file]));
  for (const declared of manifest.files) {
    const actual = payloadByPath.get(declared.path);
    if (
      actual === undefined
      || actual.data.byteLength !== declared.byteLength
    ) return rejected('pet-package-invalid', 'inventory-mismatch');
    if (sha256(actual.data) !== declared.sha256) {
      return rejected('pet-package-invalid', 'hash-mismatch');
    }
  }
  const thumbnail = manifest.files.find((file) => file.role === 'thumbnail');
  const thumbnailBytes = thumbnail === undefined ? undefined : payloadByPath.get(thumbnail.path)?.data;
  if (thumbnail === undefined || thumbnailBytes === undefined || !isValidPetThumbnail(thumbnailBytes, thumbnail.mediaType)) {
    return rejected('pet-package-invalid', 'inventory-mismatch');
  }

  const expandedBytes = files.reduce((total, file) => total + file.data.byteLength, 0);
  const summary: DraftPetPackageSummary = {
    schemaVersion: 0,
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    license: manifest.license,
    source: manifest.source,
    packageContentHash: manifest.packageContentHash,
    fileCount: payloadFiles.length,
    expandedBytes,
  };
  return { status: 'accepted', package: summary, files, manifest };
}

function rejected(
  code: 'pet-package-invalid' | 'pet-package-too-large' | 'pet-package-unsafe',
  reason: PetPackageRejectionReason,
): Extract<PetPackagePreflightResult, { status: 'rejected' }> {
  return { status: 'rejected', code, reason };
}

async function readArchive(archive: Buffer): Promise<readonly ArchiveFile[]> {
  const zip = await openArchive(archive);
  try {
    if (zip.entryCount > PET_PACKAGE_LIMITS.fileCount + 1) {
      throw new PetPackagePreflightFailure('pet-package-too-large', 'file-count');
    }
    return await readEntries(zip);
  } finally {
    zip.close();
  }
}

function openArchive(archive: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: false,
    }, (error, zip) => {
      if (error !== null || zip === undefined) reject(error ?? new Error('invalid zip'));
      else resolve(zip);
    });
  });
}

async function readEntries(zip: ZipFile): Promise<readonly ArchiveFile[]> {
  const entries = await collectEntries(zip);
  const files: ArchiveFile[] = [];
  for (const entry of entries) {
    const stream = await openEntryStream(zip, entry);
    files.push({ path: entry.fileName, data: await readStream(stream) });
  }
  return files;
}

function collectEntries(zip: ZipFile): Promise<readonly Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    let declaredExpandedBytes = 0;
    let declaredCompressedBytes = 0;
    const fail = (error: Error): void => reject(error);
    zip.on('error', fail);
    zip.on('end', () => resolve(entries));
    zip.on('entry', (entry: Entry) => {
      if (!isSafeArchivePath(entry.fileName)) {
        reject(new PetPackagePreflightFailure('pet-package-unsafe', 'unsafe-path'));
        return;
      }
      if (entry.isEncrypted() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
        reject(new PetPackagePreflightFailure('pet-package-unsafe', 'prohibited-file'));
        return;
      }
      const unixMode = entry.versionMadeBy >>> 8 === 3 ? entry.externalFileAttributes >>> 16 : undefined;
      if (unixMode !== undefined && (unixMode & 0o170000) === 0o120000) {
        reject(new PetPackagePreflightFailure('pet-package-unsafe', 'link-entry'));
        return;
      }
      if (unixMode !== undefined && (unixMode & 0o170000) !== 0o100000) {
        reject(new PetPackagePreflightFailure('pet-package-unsafe', 'prohibited-file'));
        return;
      }
      if (entry.uncompressedSize > PET_PACKAGE_LIMITS.entryBytes) {
        reject(new PetPackagePreflightFailure('pet-package-too-large', 'entry-too-large'));
        return;
      }
      declaredExpandedBytes += entry.uncompressedSize;
      declaredCompressedBytes += entry.compressedSize;
      if (declaredExpandedBytes > PET_PACKAGE_LIMITS.expandedBytes) {
        reject(new PetPackagePreflightFailure('pet-package-too-large', 'expanded-too-large'));
        return;
      }
      if (
        entry.uncompressedSize > 0
        && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > PET_PACKAGE_LIMITS.entryCompressionRatio
      ) {
        reject(new PetPackagePreflightFailure('pet-package-too-large', 'compression-ratio'));
        return;
      }
      if (
        declaredExpandedBytes > 0
        && declaredExpandedBytes / Math.max(declaredCompressedBytes, 1) > PET_PACKAGE_LIMITS.archiveCompressionRatio
      ) {
        reject(new PetPackagePreflightFailure('pet-package-too-large', 'compression-ratio'));
        return;
      }
      entries.push(entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null) reject(error);
      else resolve(stream);
    });
  });
}

function readStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseManifest(data: Buffer): {
  readonly raw: Record<string, unknown>;
  readonly id: string;
  readonly name: Readonly<{ 'zh-CN': string; en: string }>;
  readonly author: string;
  readonly license: string;
  readonly source: string;
  readonly packageContentHash: string;
  readonly runtime: ManifestRuntime;
  readonly files: readonly ManifestFile[];
} | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, [
    'schemaVersion', 'id', 'name', 'author', 'license', 'source', 'runtime',
    'viewport', 'motions', 'files', 'packageContentHash',
  ])) return undefined;
  if (parsed.schemaVersion !== 0 || typeof parsed.id !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(parsed.id) || parsed.id.length > 128) return undefined;
  if (!isRecord(parsed.name) || !hasExactKeys(parsed.name, ['zh-CN', 'en'])) return undefined;
  const chineseName = validatedDisplayText(parsed.name['zh-CN'], 80);
  const englishName = validatedDisplayText(parsed.name.en, 80);
  const author = validatedDisplayText(parsed.author, 120);
  const license = validatedDisplayText(parsed.license, 64);
  const source = validatedDisplayText(parsed.source, 2_048);
  if (chineseName === undefined || englishName === undefined || author === undefined || license === undefined || source === undefined) return undefined;
  if (!isValidRuntime(parsed.runtime) || !isValidViewport(parsed.viewport) || !isValidMotions(parsed.motions)) return undefined;
  if (
    typeof parsed.packageContentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(parsed.packageContentHash)
    || !Array.isArray(parsed.files)
  ) return undefined;
  const files: ManifestFile[] = [];
  const pathIdentities = new Set<string>();
  let previousPath: string | undefined;
  let thumbnailCount = 0;
  let animationCount = 0;
  for (const file of parsed.files) {
    if (
      !isRecord(file)
      || !hasExactKeys(file, ['path', 'role', 'mediaType', 'byteLength', 'sha256'])
      || typeof file.path !== 'string'
      || (file.role !== 'thumbnail' && file.role !== 'animation' && file.role !== 'license')
      || typeof file.mediaType !== 'string'
      || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(file.mediaType)
      || !Number.isSafeInteger(file.byteLength)
      || (file.byteLength as number) < 0
      || typeof file.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(file.sha256)
    ) return undefined;
    if (!isSafeArchivePath(file.path)) return undefined;
    if (previousPath !== undefined && Buffer.compare(Buffer.from(previousPath), Buffer.from(file.path)) >= 0) return undefined;
    previousPath = file.path;
    const identity = normalizedPathIdentity(file.path);
    if (pathIdentities.has(identity)) return undefined;
    pathIdentities.add(identity);
    if (file.role === 'thumbnail') {
      thumbnailCount += 1;
      if ((file.byteLength as number) > PET_PACKAGE_LIMITS.thumbnailBytes || (file.mediaType !== 'image/png' && file.mediaType !== 'image/webp')) return undefined;
    }
    if (file.role === 'animation') animationCount += 1;
    files.push({
      path: file.path,
      role: file.role,
      mediaType: file.mediaType,
      byteLength: file.byteLength as number,
      sha256: file.sha256,
    });
  }
  if (thumbnailCount !== 1 || animationCount < 1) return undefined;
  return {
    raw: parsed,
    id: parsed.id,
    name: { 'zh-CN': chineseName, en: englishName },
    author,
    license,
    source,
    packageContentHash: parsed.packageContentHash,
    runtime: parsed.runtime as unknown as ManifestRuntime,
    files,
  };
}

function withoutContentHash(value: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...value };
  delete clone.packageContentHash;
  return clone;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) throw new Error('unsupported canonical JSON value');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === expected.length && [...expected].sort().every((key, index) => keys[index] === key);
}

function validatedDisplayText(value: unknown, maxScalars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC');
  if (value !== normalized || normalized.length === 0 || Array.from(normalized).length > maxScalars) return undefined;
  return Array.from(normalized).some(isUnsafeTextCharacter) ? undefined : normalized;
}

function isUnsafeTextCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint === undefined
    || codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

function isValidRuntime(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['adapter', 'adapterContractVersion', 'assetFormat'])) return false;
  if (typeof value.adapter !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.adapter) || value.adapterContractVersion !== 1) return false;
  return isRecord(value.assetFormat)
    && hasExactKeys(value.assetFormat, ['family', 'major'])
    && typeof value.assetFormat.family === 'string'
    && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.assetFormat.family)
    && value.assetFormat.major === 1;
}

function isValidViewport(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['width', 'height', 'baseline'])) return false;
  if (!isBoundedInteger(value.width, 1, 16_384) || !isBoundedInteger(value.height, 1, 16_384)) return false;
  return isBoundedInteger(value.baseline, 0, value.height as number);
}

function isValidMotions(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, PET_MOTIONS)) return false;
  return PET_MOTIONS.every((motion) => isRecord(value[motion]) && Object.keys(value[motion]).length === 0);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isUnsafeArchivePathError(error: unknown): boolean {
  return error instanceof Error
    && (error.message.startsWith('invalid relative path:') || error.message.startsWith('absolute path:'));
}

function isSafeArchivePath(value: string): boolean {
  if (value.length === 0 || value !== value.normalize('NFC') || value.includes('\\') || /^[a-zA-Z]:/.test(value)) return false;
  if (Buffer.byteLength(value, 'utf8') > PET_PACKAGE_LIMITS.pathBytes) return false;
  const segments = value.split('/');
  if (segments.length > PET_PACKAGE_LIMITS.pathDepth) return false;
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    && !Array.from(segment).some(isUnsafeTextCharacter));
}

function isProhibitedPayload(path: string, mediaType: string): boolean {
  const lastDot = path.lastIndexOf('.');
  const extension = lastDot < 0 ? '' : path.slice(lastDot).toLowerCase();
  return PROHIBITED_EXTENSIONS.has(extension)
    || PROHIBITED_MEDIA_TYPES.has(mediaType.toLowerCase())
    || mediaType.toLowerCase().startsWith('audio/')
    || mediaType.toLowerCase().startsWith('font/');
}

function normalizedPathIdentity(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
