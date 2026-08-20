import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from './pet-package.js';
import { encodePetFrameSequenceBundle, parsePetFrameSequenceBundle } from './pet-frame-sequence-bundle.js';

function bundle() {
  return {
    motions: Object.fromEntries(PET_MOTIONS.map((motion, index) => [motion, {
      mediaType: 'image/png' as const,
      bytes: new Uint8Array([index, index + 1]).buffer,
      width: 1024,
      height: 1024,
      columns: 8,
      rows: 8,
      frameCount: 60,
      durationMs: 1_000,
    }])) as Parameters<typeof encodePetFrameSequenceBundle>[0]['motions'],
  };
}

describe('pet frame-sequence bundle', () => {
  it('round trips exact semantic motion assets without paths or ZIP parsing', () => {
    const encoded = encodePetFrameSequenceBundle(bundle());
    const decoded = parsePetFrameSequenceBundle(encoded);

    expect(decoded?.motions.standing).toMatchObject({ width: 1024, frameCount: 60 });
    expect([...new Uint8Array(decoded!.motions.eating.bytes)]).toEqual([7, 8]);
  });

  it('rejects trailing bytes and corrupted headers', () => {
    const encoded = new Uint8Array(encodePetFrameSequenceBundle(bundle()));
    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    expect(parsePetFrameSequenceBundle(trailing.buffer)).toBeUndefined();

    encoded[0] = 0;
    expect(parsePetFrameSequenceBundle(encoded.buffer)).toBeUndefined();
  });
});
