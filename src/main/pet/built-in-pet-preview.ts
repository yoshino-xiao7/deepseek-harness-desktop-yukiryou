import { readFile } from 'node:fs/promises';

import type { PetAssetSummary } from '../../shared/pet-library.js';
import type { PetPlayerSelection } from './pet-player-host.js';
import { prepareFrameSequenceRuntimeCandidate } from './pet-package-preflight.js';
import type { PetThumbnailRegistration } from './pet-thumbnail-store.js';

export const BUILT_IN_PET_PREVIEW_ID = 'builtin.yukiryou-whale-maid-preview';

export interface BuiltInPetPreview {
  readonly summary: PetAssetSummary;
  readonly thumbnail: PetThumbnailRegistration;
  readonly selection?: PetPlayerSelection;
}

export async function loadBuiltInPetPreview(options: {
  readonly archivePath: string;
  readonly thumbnailPath: string;
}): Promise<BuiltInPetPreview> {
  const fallback = unavailablePreview(options.thumbnailPath);
  let archive: Buffer;
  try {
    archive = await readFile(options.archivePath);
  } catch {
    return fallback;
  }
  const prepared = await prepareFrameSequenceRuntimeCandidate(archive);
  if (prepared.status !== 'accepted' || prepared.package.id !== BUILT_IN_PET_PREVIEW_ID) {
    return fallback;
  }
  const revision = prepared.package.packageContentHash.slice(0, 16);
  const summary: PetAssetSummary = {
    id: prepared.package.id,
    name: prepared.package.name['zh-CN'],
    author: prepared.package.author,
    origin: 'built-in',
    status: 'ready',
    thumbnailUrl: thumbnailUrl(prepared.package.id, revision),
    thumbnailRevision: revision,
    license: prepared.package.license,
    source: prepared.package.source,
  };
  return {
    summary,
    thumbnail: {
      id: summary.id,
      revision,
      mediaType: 'image/png',
      path: options.thumbnailPath,
    },
    selection: {
      id: summary.id,
      ...prepared.candidate,
    },
  };
}

function unavailablePreview(thumbnailPath: string): BuiltInPetPreview {
  const revision = 'unavailable';
  return {
    summary: {
      id: BUILT_IN_PET_PREVIEW_ID,
      name: 'YukiRyou 鲸鱼女仆（开发预览）',
      author: 'YukiRyou',
      origin: 'built-in',
      status: 'damaged',
      thumbnailUrl: thumbnailUrl(BUILT_IN_PET_PREVIEW_ID, revision),
      thumbnailRevision: revision,
      license: 'Bundled project asset',
      source: 'bundled-development-preview',
    },
    thumbnail: {
      id: BUILT_IN_PET_PREVIEW_ID,
      revision,
      mediaType: 'image/png',
      path: thumbnailPath,
    },
  };
}

function thumbnailUrl(id: string, revision: string): string {
  return `dsh-pet://thumbnail/${encodeURIComponent(id)}/${encodeURIComponent(revision)}`;
}
