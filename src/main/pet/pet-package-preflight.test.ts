import { describe, expect, it } from 'vitest';

import { PET_PACKAGE_LIMITS } from '../../shared/pet-package.js';
import {
  preflightPetPackage,
  prepareRiveRuntimeCandidate,
} from './pet-package-preflight.js';
import { createDraftPetArchive } from './pet-package-test-helper.js';

describe('pet package preflight', () => {
  it('accepts a complete draft-0 package through the public interface', async () => {
    const archive = createDraftPetArchive();

    const result = await preflightPetPackage(archive);

    expect(result).toMatchObject({
      status: 'accepted',
      package: {
        id: 'author.example-pet',
        schemaVersion: 0,
        name: { 'zh-CN': '示例宠物', en: 'Example Pet' },
        fileCount: 3,
      },
    });
  });

  it('rejects a package whose archive path escapes its root', async () => {
    const archive = createDraftPetArchive({ payloadPath: '../escape.asset' });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-unsafe',
      reason: 'unsafe-path',
    });
  });

  it('rejects a draft envelope that omits a semantic motion', async () => {
    const archive = createDraftPetArchive({
      mutateManifest(manifest) {
        delete (manifest.motions as Record<string, unknown>).sleeping;
      },
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-invalid',
      reason: 'invalid-manifest',
    });
  });

  it('rejects an archive with more than 64 payload files before installation', async () => {
    const archive = createDraftPetArchive({
      extraEntries: Array.from({ length: 62 }, (_, index) => ({
        path: `payload/extra-${String(index).padStart(2, '0')}.asset`,
        data: Buffer.from([index]),
      })),
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-too-large',
      reason: 'file-count',
    });
  });

  it('accepts payload entries regardless of their physical ZIP order', async () => {
    const archive = createDraftPetArchive({ reversePayloadEntries: true });

    await expect(preflightPetPackage(archive)).resolves.toMatchObject({
      status: 'accepted',
      package: { id: 'author.example-pet', fileCount: 3 },
    });
  });

  it('rejects executable payloads even when the draft manifest declares them', async () => {
    const archive = createDraftPetArchive({
      payloadPath: 'payload/runtime.wasm',
      payloadMediaType: 'application/wasm',
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-unsafe',
      reason: 'prohibited-file',
    });
  });

  it('rejects oversized entries from ZIP metadata before reading their payload', async () => {
    const archive = createDraftPetArchive({
      payloadReportedBytes: 64 * 1024 * 1024 + 1,
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-too-large',
      reason: 'entry-too-large',
    });
  });

  it('rejects duplicate payload paths instead of letting one shadow another', async () => {
    const archive = createDraftPetArchive({
      extraEntries: [{ path: 'payload/pet.asset', data: Buffer.from('shadow payload') }],
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-unsafe',
      reason: 'duplicate-path',
    });
  });

  it('rejects a draft envelope without exactly one thumbnail', async () => {
    const archive = createDraftPetArchive({ omitThumbnail: true });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-invalid',
      reason: 'invalid-manifest',
    });
  });

  it('rejects highly compressed payloads before decompression', async () => {
    const archive = createDraftPetArchive({
      payloadData: Buffer.alloc(1024 * 1024),
      deflatePayload: true,
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-too-large',
      reason: 'compression-ratio',
    });
  });

  it('rejects symbolic links in the archive', async () => {
    const archive = createDraftPetArchive({ payloadMode: 0o120777 });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-unsafe',
      reason: 'link-entry',
    });
  });

  it('rejects payload bytes that do not match the declared inventory hash', async () => {
    const archive = createDraftPetArchive();
    const payloadOffset = archive.indexOf(Buffer.from('draft animation payload'));
    expect(payloadOffset).toBeGreaterThanOrEqual(0);
    archive[payloadOffset] = (archive[payloadOffset] ?? 0) ^ 0xff;

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-invalid',
      reason: 'hash-mismatch',
    });
  });

  it('rejects an archive over the compressed byte budget before ZIP parsing', async () => {
    const archive = Buffer.alloc(PET_PACKAGE_LIMITS.archiveBytes + 1);

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-too-large',
      reason: 'archive-too-large',
    });
  });

  it('rejects an archive whose declared expanded total exceeds the budget', async () => {
    const archive = createDraftPetArchive({
      extraEntries: Array.from({ length: 3 }, (_, index) => ({
        path: `payload/large-${index}.asset`,
        data: Buffer.from([index]),
        reportedBytes: 40 * 1024 * 1024,
      })),
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-too-large',
      reason: 'expanded-too-large',
    });
  });

  it('rejects paths deeper than the draft envelope permits', async () => {
    const archive = createDraftPetArchive({ payloadPath: 'a/b/c/d/e/f/g/h/pet.asset' });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-unsafe',
      reason: 'unsafe-path',
    });
  });

  it('rejects unknown manifest fields instead of accepting an ambiguous schema', async () => {
    const archive = createDraftPetArchive({
      mutateManifest(manifest) {
        manifest.unexpected = true;
      },
    });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-invalid',
      reason: 'invalid-manifest',
    });
  });

  it('rejects thumbnails whose decoded dimensions exceed the pixel budget', async () => {
    const archive = createDraftPetArchive({ thumbnailSize: { width: 2048, height: 1024 } });

    await expect(preflightPetPackage(archive)).resolves.toEqual({
      status: 'rejected',
      code: 'pet-package-invalid',
      reason: 'inventory-mismatch',
    });
  });
});

describe('Rive runtime candidate preparation', () => {
  const riveManifest = (manifest: Record<string, unknown>): void => {
    manifest.runtime = {
      adapter: 'rive-canvas-lite',
      adapterContractVersion: 1,
      assetFormat: { family: 'rive', major: 1 },
    };
  };

  it('extracts one immutable, hash-bound .riv candidate after the common preflight', async () => {
    const payload = Buffer.from('not-yet-probed-rive-bytes');
    const archive = createDraftPetArchive({
      payloadPath: 'payload/pet.riv',
      payloadMediaType: 'application/x-rive',
      payloadData: payload,
      mutateManifest: riveManifest,
    });

    const result = await prepareRiveRuntimeCandidate(archive);

    expect(result).toMatchObject({
      status: 'accepted',
      package: { id: 'author.example-pet' },
      candidate: { runtime: 'rive-canvas-lite', assetSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    if (result.status !== 'accepted') throw new Error('candidate should be accepted');
    expect(Buffer.from(result.candidate.assetBytes)).toEqual(payload);
    archive.fill(0);
    expect(Buffer.from(result.candidate.assetBytes)).toEqual(payload);
  });

  it('rejects an unselected runtime contract without exposing animation bytes', async () => {
    const archive = createDraftPetArchive({
      payloadPath: 'payload/pet.riv',
      payloadMediaType: 'application/x-rive',
    });

    await expect(prepareRiveRuntimeCandidate(archive)).resolves.toMatchObject({
      status: 'rejected',
      code: 'pet-runtime-incompatible',
      reason: 'runtime-contract',
    });
  });

  it('requires exactly one declared application/x-rive animation', async () => {
    const archive = createDraftPetArchive({
      payloadPath: 'payload/pet.riv',
      payloadMediaType: 'application/x-rive',
      mutateManifest: riveManifest,
      extraEntries: [{ path: 'payload/second.riv', data: Buffer.from('second') }],
    });

    await expect(prepareRiveRuntimeCandidate(archive)).resolves.toMatchObject({
      status: 'rejected',
      code: 'pet-runtime-incompatible',
      reason: 'animation-inventory',
    });
  });
});
