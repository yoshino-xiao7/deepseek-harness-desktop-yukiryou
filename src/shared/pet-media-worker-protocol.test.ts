import { describe, expect, it } from 'vitest';

import { PET_MOTION_GENERATION_SPECS } from '../main/pet/frame-sequence-generation-orchestrator.js';
import { parsePetMediaWorkerHostMessage, parsePetMediaWorkerInitEnvelope, parsePetMediaWorkerOutputMessage } from './pet-media-worker-protocol.js';

const epoch = 'a'.repeat(32);
const nonce = 'b'.repeat(32);

describe('pet media worker protocol', () => {
  it('accepts one bounded rasterization job and exact handshake', () => {
    expect(parsePetMediaWorkerInitEnvelope({ protocolVersion: 1, realmEpoch: epoch, nonce }))
      .toEqual({ protocolVersion: 1, realmEpoch: epoch, nonce });
    expect(parsePetMediaWorkerHostMessage({
      kind: 'rasterize', realmEpoch: epoch, jobGeneration: 3, clipBytes: new ArrayBuffer(4), spec: PET_MOTION_GENERATION_SPECS.standing,
    }, epoch)).toBeDefined();
    expect(parsePetMediaWorkerOutputMessage({ kind: 'hello', protocolVersion: 1, realmEpoch: epoch, nonce }, { realmEpoch: epoch, nonce, jobGeneration: 3 }))
      .toBeDefined();
  });

  it('accepts a bounded atlas decode job and exact raw-frame result', () => {
    const atlas = {
      motion: 'work-enter', mediaType: 'image/png', width: 3_072, height: 1_248,
      columns: 16, rows: 6, frameCount: 90, durationMs: 1_500,
    } as const;
    expect(parsePetMediaWorkerHostMessage({
      kind: 'decode-atlas', realmEpoch: epoch, jobGeneration: 4, atlasBytes: new ArrayBuffer(8), atlas,
    }, epoch)).toBeDefined();
    expect(parsePetMediaWorkerOutputMessage({
      kind: 'decoded-atlas', realmEpoch: epoch, jobGeneration: 4,
      framesBytes: new ArrayBuffer(90 * 192 * 208 * 4), cellWidth: 192, cellHeight: 208, frameCount: 90,
    }, { realmEpoch: epoch, nonce, jobGeneration: 4 })).toBeDefined();
  });

  it('rejects stale generations, extra fields and oversized clips', () => {
    expect(parsePetMediaWorkerHostMessage({
      kind: 'rasterize', realmEpoch: epoch, jobGeneration: 3, clipBytes: new ArrayBuffer(4), spec: PET_MOTION_GENERATION_SPECS.standing, extra: true,
    }, epoch)).toBeUndefined();
    expect(parsePetMediaWorkerHostMessage({
      kind: 'rasterize', realmEpoch: epoch, jobGeneration: 3, clipBytes: new ArrayBuffer(64 * 1024 * 1024 + 1), spec: PET_MOTION_GENERATION_SPECS.standing,
    }, epoch)).toBeUndefined();
    expect(parsePetMediaWorkerOutputMessage({ kind: 'failure', realmEpoch: epoch, jobGeneration: 2, code: 'decode-failed' }, { realmEpoch: epoch, nonce, jobGeneration: 3 }))
      .toBeUndefined();
  });

  it('rejects unsafe atlas geometry and mismatched decoded byte counts', () => {
    expect(parsePetMediaWorkerHostMessage({
      kind: 'decode-atlas', realmEpoch: epoch, jobGeneration: 4, atlasBytes: new ArrayBuffer(8),
      atlas: { motion: 'standing', mediaType: 'image/png', width: 3_071, height: 1_248, columns: 16, rows: 6, frameCount: 90, durationMs: 1_500 },
    }, epoch)).toBeUndefined();
    expect(parsePetMediaWorkerOutputMessage({
      kind: 'decoded-atlas', realmEpoch: epoch, jobGeneration: 4,
      framesBytes: new ArrayBuffer(90 * 192 * 208 * 4 - 1), cellWidth: 192, cellHeight: 208, frameCount: 90,
    }, { realmEpoch: epoch, nonce, jobGeneration: 4 })).toBeUndefined();
  });
});
