import { describe, expect, it } from 'vitest';

import {
  createPetPlayerOutputGuard,
  parsePetPlayerHostMessage,
  parsePetPlayerInitEnvelope,
} from './pet-player-protocol.js';

const context = {
  realmEpoch: 'a'.repeat(32),
  nonce: 'b'.repeat(32),
  petGeneration: 3,
  presentationGeneration: 7,
};

describe('pet player output protocol', () => {
  it('rejects every player event until the one-shot hello handshake succeeds', () => {
    const guard = createPetPlayerOutputGuard(context);

    expect(guard.accept({
      kind: 'heartbeat',
      realmEpoch: context.realmEpoch,
    }, 1_000)).toEqual({ status: 'rejected', code: 'hello-required' });
    expect(guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_001)).toMatchObject({ status: 'accepted', message: { kind: 'hello' } });
    expect(guard.accept({
      kind: 'heartbeat',
      realmEpoch: context.realmEpoch,
    }, 2_001)).toMatchObject({ status: 'accepted', message: { kind: 'heartbeat' } });
  });

  it('allows one coalesced heartbeat but rejects a third in the rolling second', () => {
    const guard = createPetPlayerOutputGuard(context);
    guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000);
    const heartbeat = { kind: 'heartbeat', realmEpoch: context.realmEpoch } as const;
    expect(guard.accept(heartbeat, 1_010)).toMatchObject({ status: 'accepted' });
    expect(guard.accept(heartbeat, 1_020)).toMatchObject({ status: 'accepted' });
    expect(guard.accept(heartbeat, 1_030)).toEqual({ status: 'rejected', code: 'rate-limit' });
  });

  it('rejects stale pet and presentation generations after a valid handshake', () => {
    const guard = createPetPlayerOutputGuard(context);
    guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000);

    expect(guard.accept({
      kind: 'marker',
      realmEpoch: context.realmEpoch,
      petGeneration: 2,
      presentationGeneration: context.presentationGeneration,
      marker: 'transition-complete',
    }, 1_010)).toEqual({ status: 'rejected', code: 'stale-generation' });
    expect(guard.accept({
      kind: 'marker',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      marker: 'transition-complete',
    }, 1_020)).toMatchObject({ status: 'accepted', message: { kind: 'marker' } });

    guard.updateGenerations({ petGeneration: 4, presentationGeneration: 8 });
    expect(guard.accept({
      kind: 'marker',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      marker: 'transition-complete',
    }, 1_030)).toEqual({ status: 'rejected', code: 'stale-generation' });
  });

  it('rate limits activation events without permanently poisoning a realm', () => {
    const guard = createPetPlayerOutputGuard(context);
    guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000);
    const activation = {
      kind: 'activation',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
    } as const;

    for (let offset = 0; offset < 4; offset += 1) {
      expect(guard.accept(activation, 1_010 + offset)).toMatchObject({ status: 'accepted' });
    }
    expect(guard.accept(activation, 1_020)).toEqual({ status: 'rejected', code: 'rate-limit' });
    expect(guard.accept(activation, 2_011)).toMatchObject({ status: 'accepted' });
  });

  it('accepts bounded ready, metrics, and failure events for the current pet', () => {
    const guard = createPetPlayerOutputGuard(context);
    guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000);

    expect(guard.accept({
      kind: 'ready',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
    }, 1_010)).toMatchObject({ status: 'accepted', message: { kind: 'ready' } });
    expect(guard.accept({
      kind: 'metrics',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      sampleWindowMs: 5_000,
      refreshPeriodMs: 16.67,
      frameP95Ms: 18.1,
      frameP99Ms: 28.2,
      overDoublePeriodRatio: 0.01,
      consecutiveMissedFrames: 1,
      longTaskCount: 0,
    }, 1_020)).toMatchObject({ status: 'accepted', message: { kind: 'metrics' } });
    expect(guard.accept({
      kind: 'failure',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      code: 'asset-load-failed',
      detail: 'invalid embedded image',
    }, 1_030)).toMatchObject({ status: 'accepted', message: { kind: 'failure' } });
  });

  it('rejects malformed metrics and stale ready events', () => {
    const guard = createPetPlayerOutputGuard(context);
    guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000);

    expect(guard.accept({
      kind: 'ready',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration - 1,
    }, 1_010)).toEqual({ status: 'rejected', code: 'stale-generation' });
    expect(guard.accept({
      kind: 'metrics',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      sampleWindowMs: 5_000,
      refreshPeriodMs: 16.67,
      frameP95Ms: 18.1,
      frameP99Ms: 28.2,
      overDoublePeriodRatio: 1.01,
      consecutiveMissedFrames: 1,
      longTaskCount: 0,
    }, 1_020)).toEqual({ status: 'rejected', code: 'invalid-message' });
  });

  it('limits metrics to two samples per second', () => {
    const guard = createPetPlayerOutputGuard(context);
    guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000);
    const metrics = {
      kind: 'metrics',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      sampleWindowMs: 5_000,
      refreshPeriodMs: 16.67,
      frameP95Ms: 18.1,
      frameP99Ms: 28.2,
      overDoublePeriodRatio: 0.01,
      consecutiveMissedFrames: 1,
      longTaskCount: 0,
    } as const;

    expect(guard.accept(metrics, 1_010)).toMatchObject({ status: 'accepted' });
    expect(guard.accept(metrics, 1_020)).toMatchObject({ status: 'accepted' });
    expect(guard.accept(metrics, 1_030)).toEqual({ status: 'rejected', code: 'rate-limit' });
  });

  it('rejects an oversized message before parsing its schema', () => {
    const guard = createPetPlayerOutputGuard(context);

    expect(guard.accept({
      kind: 'unknown',
      realmEpoch: context.realmEpoch,
      payload: 'x'.repeat(20_000),
    }, 1_000)).toEqual({ status: 'rejected', code: 'message-too-large' });
  });

  it('enforces a rolling aggregate byte budget', () => {
    const guard = createPetPlayerOutputGuard(context, { maxBytesPerSecond: 240 });
    expect(guard.accept({
      kind: 'hello',
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    }, 1_000)).toMatchObject({ status: 'accepted' });

    expect(guard.accept({
      kind: 'failure',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      code: 'runtime-error',
      detail: 'x'.repeat(100),
    }, 1_010)).toEqual({ status: 'rejected', code: 'byte-rate-limit' });
    expect(guard.accept({
      kind: 'heartbeat',
      realmEpoch: context.realmEpoch,
    }, 2_001)).toMatchObject({ status: 'accepted' });
  });
});

describe('pet player input protocol', () => {
  it('accepts only an exact 128-bit one-shot initialization envelope', () => {
    expect(parsePetPlayerInitEnvelope({
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    })).toEqual({
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
    });
    expect(parsePetPlayerInitEnvelope({
      protocolVersion: 1,
      realmEpoch: 'short',
      nonce: context.nonce,
    })).toBeUndefined();
    expect(parsePetPlayerInitEnvelope({
      protocolVersion: 1,
      realmEpoch: context.realmEpoch,
      nonce: context.nonce,
      extra: true,
    })).toBeUndefined();
  });

  it('accepts a bounded presentation for the active generations', () => {
    expect(parsePetPlayerHostMessage({
      kind: 'present',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      state: 'eating',
      visible: true,
      reducedMotion: false,
      viewport: { width: 360, height: 260, devicePixelRatio: 2 },
    }, context)).toMatchObject({ kind: 'present', state: 'eating' });
  });

  it('accepts one bounded Rive asset envelope for the active pet generation', () => {
    const assetBytes = new Uint8Array([1, 2, 3]).buffer;

    expect(parsePetPlayerHostMessage({
      kind: 'load-asset',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      runtime: 'rive-canvas-lite',
      assetByteLength: 3,
      assetSha256: 'c'.repeat(64),
      assetBytes,
    }, context)).toMatchObject({
      kind: 'load-asset',
      petGeneration: context.petGeneration,
      assetBytes,
    });
  });

  it('accepts the same bounded envelope for a prevalidated frame-sequence bundle', () => {
    const assetBytes = new Uint8Array([1, 2, 3]).buffer;

    expect(parsePetPlayerHostMessage({
      kind: 'load-asset',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      runtime: 'frame-sequence-canvas2d',
      assetByteLength: 3,
      assetSha256: 'd'.repeat(64),
      assetBytes,
    }, context)).toMatchObject({ kind: 'load-asset', runtime: 'frame-sequence-canvas2d' });
  });

  it('accepts the same bounded envelope for a prevalidated layered-rig bundle', () => {
    const assetBytes = new Uint8Array([1, 2, 3]).buffer;
    expect(parsePetPlayerHostMessage({
      kind: 'load-asset', realmEpoch: context.realmEpoch, petGeneration: context.petGeneration,
      runtime: 'layered-rig-canvas2d', assetByteLength: 3, assetSha256: 'e'.repeat(64), assetBytes,
    }, context)).toMatchObject({ kind: 'load-asset', runtime: 'layered-rig-canvas2d' });
  });

  it('rejects stale, malformed, oversized, and extensible asset envelopes', () => {
    const base = {
      kind: 'load-asset',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      runtime: 'rive-canvas-lite',
      assetByteLength: 3,
      assetSha256: 'c'.repeat(64),
      assetBytes: new Uint8Array([1, 2, 3]).buffer,
    } as const;

    expect(parsePetPlayerHostMessage({ ...base, petGeneration: 2 }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({ ...base, assetByteLength: 4 }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({ ...base, assetSha256: 'not-a-hash' }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({ ...base, runtime: 'remote-script' }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({ ...base, extra: true }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({
      ...base,
      assetByteLength: 64 * 1024 * 1024 + 1,
      assetBytes: new ArrayBuffer(64 * 1024 * 1024 + 1),
    }, context)).toBeUndefined();
  });

  it('rejects stale, oversized, and unknown presentations', () => {
    const base = {
      kind: 'present',
      realmEpoch: context.realmEpoch,
      petGeneration: context.petGeneration,
      presentationGeneration: context.presentationGeneration,
      state: 'standing',
      visible: true,
      reducedMotion: false,
      viewport: { width: 360, height: 260, devicePixelRatio: 2 },
    } as const;

    expect(parsePetPlayerHostMessage({ ...base, petGeneration: 2 }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({
      ...base,
      viewport: { ...base.viewport, width: 10_000 },
    }, context)).toBeUndefined();
    expect(parsePetPlayerHostMessage({ ...base, state: 'remote-script' }, context)).toBeUndefined();
  });
});
