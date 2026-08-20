import { PET_PACKAGE_LIMITS } from '../../shared/pet-package.js';

export type PetThumbnailMediaType = 'image/png' | 'image/webp';

export function isValidPetThumbnail(data: Buffer, mediaType: string): mediaType is PetThumbnailMediaType {
  if (data.byteLength > PET_PACKAGE_LIMITS.thumbnailBytes) return false;
  const dimensions = petRasterDimensions(data, mediaType);
  return dimensions !== undefined
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width * dimensions.height <= PET_PACKAGE_LIMITS.thumbnailPixels;
}

export function petRasterDimensions(
  data: Buffer,
  mediaType: string,
): { readonly width: number; readonly height: number } | undefined {
  if (mediaType === 'image/png') {
    if (
      data.byteLength < 24
      || !data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || data.subarray(12, 16).toString('ascii') !== 'IHDR'
    ) return undefined;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (
    mediaType !== 'image/webp'
    || data.byteLength < 20
    || data.subarray(0, 4).toString('ascii') !== 'RIFF'
    || data.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) return undefined;
  const chunk = data.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && data.byteLength >= 30) {
    return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  }
  if (chunk === 'VP8 ' && data.byteLength >= 30 && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && data.byteLength >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return undefined;
}
