import { describe, expect, it } from 'vitest';

import { parsePetLayeredRigBundle } from '../../shared/pet-layered-rig-bundle.js';
import { validLayeredRigManifest } from '../../shared/pet-layered-rig-test-fixture.js';
import { createDraftPetArchive, createPngHeader } from './pet-package-test-helper.js';
import { prepareLayeredRigRuntimeCandidate } from './pet-package-preflight.js';

function archive(overrides: { width?: number; extra?: boolean } = {}) {
  const rig = validLayeredRigManifest();
  const width = overrides.width ?? 64;
  return createDraftPetArchive({
    payloadPath: 'payload/rig.json',
    payloadMediaType: 'application/json',
    payloadData: Buffer.from(JSON.stringify(rig)),
    extraEntries: [
      { path: 'payload/parts/body.png', data: createPngHeader({ width, height: 96 }), mediaType: 'image/png' },
      ...(overrides.extra ? [{ path: 'payload/parts/undeclared.png', data: createPngHeader({ width: 1, height: 1 }), mediaType: 'image/png' }] : []),
    ],
    mutateManifest(manifest) {
      manifest.runtime = {
        adapter: 'layered-rig-canvas2d',
        adapterContractVersion: 1,
        assetFormat: { family: 'layered-rig', major: 1 },
      };
    },
  });
}

describe('layered rig runtime candidate', () => {
  it('deep-validates declaration and raster dimensions before creating an internal player bundle', async () => {
    const result = await prepareLayeredRigRuntimeCandidate(archive());
    expect(result).toMatchObject({
      status: 'accepted',
      candidate: { runtime: 'layered-rig-canvas2d', assetSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    if (result.status === 'accepted') {
      expect(parsePetLayeredRigBundle(result.candidate.assetBytes)?.manifest.assets).toHaveLength(1);
    }
  });

  it('rejects mismatched dimensions and undeclared animation payloads', async () => {
    await expect(prepareLayeredRigRuntimeCandidate(archive({ width: 63 }))).resolves.toMatchObject({
      status: 'rejected', reason: 'animation-metadata',
    });
    await expect(prepareLayeredRigRuntimeCandidate(archive({ extra: true }))).resolves.toMatchObject({
      status: 'rejected', reason: 'animation-inventory',
    });
  });
});
