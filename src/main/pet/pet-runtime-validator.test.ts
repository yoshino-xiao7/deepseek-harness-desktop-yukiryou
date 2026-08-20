import { describe, expect, it, vi } from 'vitest';

import { createDraftPetArchive } from './pet-package-test-helper.js';
import {
  createPetRuntimeValidator,
  type PetRuntimeProbe,
} from './pet-runtime-validator.js';

function riveArchive(): Buffer {
  return createDraftPetArchive({
    payloadPath: 'payload/pet.riv',
    payloadMediaType: 'application/x-rive',
    payloadData: Buffer.from('probe candidate'),
    mutateManifest(manifest) {
      manifest.runtime = {
        adapter: 'rive-canvas-lite',
        adapterContractVersion: 1,
        assetFormat: { family: 'rive', major: 1 },
      };
    },
  });
}

function fakeProbe(result: 'compatible' | 'incompatible' = 'compatible') {
  return {
    validate: vi.fn<PetRuntimeProbe['validate']>().mockResolvedValue(result),
    dispose: vi.fn<PetRuntimeProbe['dispose']>(),
  } satisfies PetRuntimeProbe;
}

describe('pet runtime validator', () => {
  it('returns a player asset only after the isolated probe accepts it', async () => {
    const probe = fakeProbe();
    const validator = createPetRuntimeValidator({ createProbe: () => probe });

    const result = await validator.validate(riveArchive());

    expect(result).toMatchObject({
      status: 'accepted',
      package: { id: 'author.example-pet' },
      playerAsset: { runtime: 'rive-canvas-lite' },
    });
    expect(probe.validate).toHaveBeenCalledTimes(1);
    expect(probe.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not create a probe when the envelope is not a Rive candidate', async () => {
    const createProbe = vi.fn(() => fakeProbe());
    const validator = createPetRuntimeValidator({ createProbe });

    await expect(validator.validate(createDraftPetArchive())).resolves.toMatchObject({
      status: 'rejected',
      code: 'pet-runtime-incompatible',
    });
    expect(createProbe).not.toHaveBeenCalled();
  });

  it('fails closed and disposes the probe when the runtime rejects the asset', async () => {
    const probe = fakeProbe('incompatible');
    const validator = createPetRuntimeValidator({ createProbe: () => probe });

    await expect(validator.validate(riveArchive())).resolves.toMatchObject({
      status: 'rejected',
      code: 'pet-player-unavailable',
      reason: 'probe-incompatible',
    });
    expect(probe.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses a main-owned deadline and disposes a hung probe', async () => {
    const probe = fakeProbe();
    probe.validate.mockReturnValue(new Promise(() => undefined));
    const validator = createPetRuntimeValidator({ createProbe: () => probe, timeoutMs: 100 });

    await expect(validator.validate(riveArchive())).resolves.toMatchObject({
      status: 'rejected',
      code: 'pet-player-unavailable',
      reason: 'probe-timeout',
    });
    expect(probe.dispose).toHaveBeenCalledTimes(1);
  });
});
