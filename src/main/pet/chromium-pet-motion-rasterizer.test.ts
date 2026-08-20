import { describe, expect, it } from 'vitest';

import { PET_MEDIA_WORKER_FRAME_BYTES, type PetMediaWorkerOutputMessage } from '../../shared/pet-media-worker-protocol.js';
import { decodedPetAtlasFromWorkerMessage } from './chromium-pet-motion-rasterizer.js';

describe('decodedPetAtlasFromWorkerMessage', () => {
  it('splits the bounded worker buffer into independently owned QA frames', () => {
    const framesBytes = new ArrayBuffer(PET_MEDIA_WORKER_FRAME_BYTES * 2);
    const combined = new Uint8Array(framesBytes);
    combined[0] = 11;
    combined[PET_MEDIA_WORKER_FRAME_BYTES] = 22;
    const message = {
      kind: 'decoded-atlas', realmEpoch: 'a'.repeat(32), jobGeneration: 1, framesBytes,
      cellWidth: 192, cellHeight: 208, frameCount: 2,
    } satisfies PetMediaWorkerOutputMessage;

    const decoded = decodedPetAtlasFromWorkerMessage(message, { frameCount: 2 });
    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames[0]![0]).toBe(11);
    expect(decoded.frames[1]![0]).toBe(22);
    decoded.frames[0]![0] = 99;
    expect(decoded.frames[1]![0]).toBe(22);
    expect(combined[0]).toBe(11);
  });

  it('fails closed when the worker responds with the wrong job shape', () => {
    const message = {
      kind: 'decoded-atlas', realmEpoch: 'a'.repeat(32), jobGeneration: 1,
      framesBytes: new ArrayBuffer(PET_MEDIA_WORKER_FRAME_BYTES * 2), cellWidth: 192, cellHeight: 208, frameCount: 2,
    } satisfies PetMediaWorkerOutputMessage;
    expect(() => decodedPetAtlasFromWorkerMessage(message, { frameCount: 3 })).toThrow('unexpected decoded pet atlas result');
  });
});
