import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { verifyPetPlayerAsset } from './pet-player-asset.js';

describe('pet player asset verification', () => {
  it('accepts bytes only when their length and SHA-256 match the host envelope', async () => {
    const bytes = new TextEncoder().encode('validated-rive-asset').buffer;
    const sha256 = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

    await expect(verifyPetPlayerAsset({ bytes, byteLength: bytes.byteLength, sha256 })).resolves.toBe(true);
    await expect(verifyPetPlayerAsset({ bytes, byteLength: bytes.byteLength + 1, sha256 })).resolves.toBe(false);
    await expect(verifyPetPlayerAsset({ bytes, byteLength: bytes.byteLength, sha256: '0'.repeat(64) })).resolves.toBe(false);
  });
});
