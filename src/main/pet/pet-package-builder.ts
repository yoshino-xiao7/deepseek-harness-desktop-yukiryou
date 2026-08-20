import { PET_PACKAGE_LIMITS } from '../../shared/pet-package.js';
import { createHash } from 'node:crypto';

export interface StoredZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export function buildStoredZip(entries: readonly StoredZipEntry[]): Uint8Array {
  if (entries.length < 1 || entries.length > PET_PACKAGE_LIMITS.fileCount + 1) {
    throw new Error('invalid ZIP entry count');
  }
  const identities = new Set<string>();
  const normalized = entries.map((entry) => {
    if (!isSafeRelativePath(entry.path)) throw new Error('unsafe ZIP path');
    const identity = entry.path.normalize('NFC').toLocaleLowerCase('en-US');
    if (identities.has(identity)) throw new Error('duplicate ZIP path');
    identities.add(identity);
    const name = Buffer.from(entry.path);
    const bytes = Buffer.from(entry.bytes);
    if (name.byteLength > PET_PACKAGE_LIMITS.pathBytes || bytes.byteLength > PET_PACKAGE_LIMITS.entryBytes) {
      throw new Error('ZIP entry exceeds package limits');
    }
    return { name, bytes, crc: crc32(bytes) };
  });
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of normalized) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.bytes.byteLength, 18);
    local.writeUInt32LE(entry.bytes.byteLength, 22);
    local.writeUInt16LE(entry.name.byteLength, 26);
    localParts.push(local, entry.name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.bytes.byteLength, 20);
    central.writeUInt32LE(entry.bytes.byteLength, 24);
    central.writeUInt16LE(entry.name.byteLength, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, entry.name);
    localOffset += local.byteLength + entry.name.byteLength + entry.bytes.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  const archive = Buffer.concat([...localParts, centralDirectory, end]);
  if (archive.byteLength > PET_PACKAGE_LIMITS.archiveBytes) throw new Error('ZIP archive exceeds package limits');
  return Uint8Array.from(archive);
}

export function hashPetPackageBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalPetPackageJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPetPackageJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalPetPackageJson(record[key])}`).join(',')}}`;
}

function isSafeRelativePath(path: string): boolean {
  if (path.length < 1 || path !== path.normalize('NFC') || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const parts = path.split('/');
  return parts.length <= PET_PACKAGE_LIMITS.pathDepth
    && parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
