import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from '../../shared/pet-package.js';
import { buildFrameSequencePetPackage } from './frame-sequence-authoring-adapter.js';
import { createPngHeader } from './pet-package-test-helper.js';
import {
  BUILT_IN_PET_PREVIEW_ID,
  loadBuiltInPetPreview,
} from './built-in-pet-preview.js';

describe('built-in pet preview', () => {
  it('loads only a fully validated package with the reserved built-in identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-built-in-pet-'));
    const archivePath = join(root, 'preview.yukipet');
    const thumbnailPath = join(root, 'preview.png');
    const thumbnail = createPngHeader({ width: 256, height: 256 });
    await writeFile(thumbnailPath, thumbnail);
    await writeFile(archivePath, buildFrameSequencePetPackage({
      displayName: '开发预览',
      thumbnail: { mediaType: 'image/png', bytes: thumbnail },
      atlases: PET_MOTIONS.map((motion) => ({
        motion,
        mediaType: 'image/png',
        bytes: createPngHeader({ width: 64, height: 96 }),
        width: 64,
        height: 96,
        columns: 1,
        rows: 2,
        frameCount: 2,
        durationMs: 1_000,
      })),
      metadata: {
        id: BUILT_IN_PET_PREVIEW_ID,
        author: 'YukiRyou',
        license: 'private-original',
        source: 'bundled-development-preview',
        englishName: 'Development Preview',
      },
    }));

    const preview = await loadBuiltInPetPreview({ archivePath, thumbnailPath });

    expect(preview.summary).toMatchObject({
      id: BUILT_IN_PET_PREVIEW_ID,
      status: 'ready',
      origin: 'built-in',
    });
    expect(preview.selection).toMatchObject({
      id: BUILT_IN_PET_PREVIEW_ID,
      runtime: 'frame-sequence-canvas2d',
    });
    expect(preview.thumbnail.revision).toBe(preview.summary.thumbnailRevision);
  });

  it('fails closed when the bundled archive is absent or uses another identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-built-in-pet-'));
    const preview = await loadBuiltInPetPreview({
      archivePath: join(root, 'missing.yukipet'),
      thumbnailPath: join(root, 'preview.png'),
    });
    expect(preview.summary.status).toBe('damaged');
    expect(preview.selection).toBeUndefined();
  });
});
