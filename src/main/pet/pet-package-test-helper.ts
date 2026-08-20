import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

export interface ZipEntryInput {
  readonly path: string;
  readonly data: Buffer;
  readonly reportedBytes?: number;
  readonly deflate?: boolean;
  readonly mode?: number;
  readonly mediaType?: string;
}

export function createDraftPetArchive(options: {
  readonly payloadPath?: string;
  readonly mutateManifest?: (manifest: Record<string, unknown>) => void;
  readonly extraEntries?: readonly ZipEntryInput[];
  readonly payloadMediaType?: string;
  readonly reversePayloadEntries?: boolean;
  readonly payloadReportedBytes?: number;
  readonly omitThumbnail?: boolean;
  readonly payloadData?: Buffer;
  readonly deflatePayload?: boolean;
  readonly payloadMode?: number;
  readonly thumbnailSize?: Readonly<{ width: number; height: number }>;
} = {}): Buffer {
  const payloadPath = options.payloadPath ?? 'payload/pet.asset';
  const entries: ZipEntryInput[] = [
    { path: 'LICENSE.txt', data: Buffer.from('MIT\n') },
    {
      path: payloadPath,
      data: options.payloadData ?? Buffer.from('draft animation payload'),
      ...(options.payloadReportedBytes === undefined ? {} : { reportedBytes: options.payloadReportedBytes }),
      ...(options.deflatePayload === true ? { deflate: true } : {}),
      ...(options.payloadMode === undefined ? {} : { mode: options.payloadMode }),
    },
    ...(options.omitThumbnail ? [] : [{ path: 'thumbnail.png', data: createPngHeader(options.thumbnailSize ?? { width: 256, height: 256 }) }]),
    ...(options.extraEntries ?? []),
  ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const files = entries.map(({ path, data, mediaType }) => ({
    path,
    role: path === 'thumbnail.png' ? 'thumbnail' : path === 'LICENSE.txt' ? 'license' : 'animation',
    mediaType: path === 'thumbnail.png' ? 'image/png' : path === 'LICENSE.txt' ? 'text/plain' : mediaType ?? options.payloadMediaType ?? 'application/x-yukiryou-pet-payload',
    byteLength: data.byteLength,
    sha256: sha256(data),
  }));
  const manifestWithoutHash = {
    schemaVersion: 0,
    id: 'author.example-pet',
    name: { 'zh-CN': '示例宠物', en: 'Example Pet' },
    author: 'Example Author',
    license: 'MIT',
    source: 'local-original',
    runtime: {
      adapter: 'pending',
      adapterContractVersion: 1,
      assetFormat: { family: 'pending', major: 1 },
    },
    viewport: { width: 1024, height: 640, baseline: 600 },
    motions: Object.fromEntries([
      'standing', 'drowsy', 'lying-down', 'sleeping', 'waking',
      'rubbing-eyes', 'work-enter', 'eating', 'work-exit',
    ].map((motion) => [motion, {}])),
    files,
  };
  options.mutateManifest?.(manifestWithoutHash);
  const manifest = {
    ...manifestWithoutHash,
    packageContentHash: sha256(Buffer.from(canonicalJson(manifestWithoutHash))),
  };
  const payloadEntries = options.reversePayloadEntries ? [...entries].reverse() : entries;
  return createStoredZip([
    { path: 'pet.json', data: Buffer.from(JSON.stringify(manifest)) },
    ...payloadEntries,
  ]);
}

export function createPngHeader(size: Readonly<{ width: number; height: number }>): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(size.width, 16);
  header.writeUInt32BE(size.height, 20);
  return header;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function createStoredZip(entries: readonly ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const packedData = entry.deflate === true ? deflateRawSync(entry.data) : entry.data;
    const compressionMethod = entry.deflate === true ? 8 : 0;
    const reportedCompressedBytes = entry.deflate === true
      ? packedData.byteLength
      : entry.reportedBytes ?? packedData.byteLength;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(reportedCompressedBytes, 18);
    local.writeUInt32LE(entry.reportedBytes ?? entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, packedData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(reportedCompressedBytes, 20);
    central.writeUInt32LE(entry.reportedBytes ?? entry.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + packedData.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
