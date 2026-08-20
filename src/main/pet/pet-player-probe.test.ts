import { describe, expect, it, vi } from 'vitest';

import type { PetPlayerRealm } from './pet-player-realm.js';
import { createPetPlayerProbe } from './pet-player-probe.js';

function fakeRealm() {
  return {
    start: vi.fn<PetPlayerRealm['start']>().mockResolvedValue(undefined),
    present: vi.fn<PetPlayerRealm['present']>(),
    dispose: vi.fn<PetPlayerRealm['dispose']>(),
  } satisfies PetPlayerRealm;
}

const candidate = {
  runtime: 'rive-canvas-lite' as const,
  assetSha256: 'a'.repeat(64),
  assetBytes: new Uint8Array([1, 2, 3]).buffer,
};

describe('pet player probe', () => {
  it('uses a fresh isolated realm once without presenting it', async () => {
    const realm = fakeRealm();
    const probe = createPetPlayerProbe(() => realm);

    await expect(probe.validate(candidate)).resolves.toBe('compatible');
    expect(realm.start).toHaveBeenCalledWith({ petGeneration: 1, ...candidate });
    expect(realm.present).not.toHaveBeenCalled();
    await expect(probe.validate(candidate)).resolves.toBe('incompatible');
  });

  it('maps startup rejection to incompatibility and always allows external disposal', async () => {
    const realm = fakeRealm();
    realm.start.mockRejectedValue(new Error('asset rejected'));
    const probe = createPetPlayerProbe(() => realm);

    await expect(probe.validate(candidate)).resolves.toBe('incompatible');
    probe.dispose();
    probe.dispose();
    expect(realm.dispose).toHaveBeenCalledTimes(1);
  });
});
