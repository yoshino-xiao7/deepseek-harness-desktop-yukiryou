import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { PET_PACKAGE_LIMITS } from '../../shared/pet-package.js';
import { isValidPetThumbnail, type PetThumbnailMediaType } from './pet-thumbnail-validation.js';

export interface PetThumbnailRegistration {
  readonly id: string;
  readonly revision: string;
  readonly mediaType: PetThumbnailMediaType;
  readonly path: string;
}

export type PetThumbnailResponse =
  | {
      readonly status: 'ok';
      readonly mediaType: PetThumbnailMediaType;
      readonly data: Uint8Array;
      readonly etag: string;
    }
  | { readonly status: 'not-found' };

export interface PetThumbnailStore {
  resolve(url: string): Promise<PetThumbnailResponse>;
}

export function openPetThumbnailStore(
  registrations: readonly PetThumbnailRegistration[],
): PetThumbnailStore {
  const assets = new Map(
    registrations.map((asset) => [`${asset.id}\u0000${asset.revision}`, asset]),
  );
  return {
    async resolve(value) {
      const key = thumbnailKey(value);
      const asset = key === undefined ? undefined : assets.get(key);
      if (asset === undefined) return { status: 'not-found' };
      let handle;
      try {
        handle = await open(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size > PET_PACKAGE_LIMITS.thumbnailBytes) {
          return { status: 'not-found' };
        }
        const data = await handle.readFile();
        if (!isValidPetThumbnail(data, asset.mediaType)) return { status: 'not-found' };
        const digest = createHash('sha256').update(data).digest('base64url');
        return { status: 'ok', mediaType: asset.mediaType, data, etag: `"${digest}"` };
      } catch {
        return { status: 'not-found' };
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
  };
}

function thumbnailKey(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== 'dsh-pet:'
    || url.hostname !== 'thumbnail'
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
    || url.search !== ''
    || url.hash !== ''
  ) return undefined;
  const encodedSegments = url.pathname.split('/').slice(1);
  if (encodedSegments.length !== 2) return undefined;
  try {
    const id = decodeURIComponent(encodedSegments[0] as string);
    const revision = decodeURIComponent(encodedSegments[1] as string);
    if (!isSafeSegment(id) || !isSafeSegment(revision)) return undefined;
    return `${id}\u0000${revision}`;
  } catch {
    return undefined;
  }
}

function isSafeSegment(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && value === value.normalize('NFC')
    && !value.includes('/')
    && !value.includes('\\')
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}
