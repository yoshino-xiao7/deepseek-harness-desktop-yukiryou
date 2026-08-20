import { describe, expect, it } from 'vitest';

import { createPetLayeredRigBundle, parsePetLayeredRigBundle } from './pet-layered-rig-bundle.js';
import { validLayeredRigManifest } from './pet-layered-rig-test-fixture.js';

describe('pet layered rig bundle', () => {
  it('round-trips a validated declaration and exact local image payloads', () => {
    const manifest = validLayeredRigManifest();
    const bundle = createPetLayeredRigBundle({
      manifest,
      assets: new Map([['body', { mediaType: 'image/png' as const, bytes: Uint8Array.of(1, 2, 3).buffer }]]),
    });
    expect(bundle).toBeInstanceOf(ArrayBuffer);
    const parsed = parsePetLayeredRigBundle(bundle!);
    expect(parsed?.manifest.renderer).toBe('canvas2d-layered-rig');
    expect([...new Uint8Array(parsed!.assets.get('body')!.bytes)]).toEqual([1, 2, 3]);
  });

  it('rejects undeclared, truncated, and trailing payload data', () => {
    const manifest = validLayeredRigManifest();
    expect(createPetLayeredRigBundle({
      manifest,
      assets: new Map([
        ['body', { mediaType: 'image/png' as const, bytes: Uint8Array.of(1).buffer }],
        ['extra', { mediaType: 'image/png' as const, bytes: Uint8Array.of(2).buffer }],
      ]),
    })).toBeUndefined();
    const bundle = createPetLayeredRigBundle({
      manifest,
      assets: new Map([['body', { mediaType: 'image/png' as const, bytes: Uint8Array.of(1, 2).buffer }]]),
    })!;
    expect(parsePetLayeredRigBundle(bundle.slice(0, -1))).toBeUndefined();
    const trailing = new Uint8Array(bundle.byteLength + 1);
    trailing.set(new Uint8Array(bundle));
    expect(parsePetLayeredRigBundle(trailing.buffer)).toBeUndefined();
  });
});
