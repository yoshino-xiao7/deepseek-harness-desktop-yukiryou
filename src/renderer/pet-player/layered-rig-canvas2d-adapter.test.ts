import { describe, expect, it, vi } from 'vitest';

import { createPetLayeredRigBundle } from '../../shared/pet-layered-rig-bundle.js';
import { validLayeredRigManifest } from '../../shared/pet-layered-rig-test-fixture.js';
import {
  createLayeredRigCanvas2dAdapter,
  type LayeredRigCanvasRuntime,
} from './layered-rig-canvas2d-adapter.js';

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>();
  const close = vi.fn();
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getTransform: () => ({ a: 1 }),
    globalAlpha: 1,
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    transform: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  let handle = 0;
  const runtime: LayeredRigCanvasRuntime = {
    decode: vi.fn(async () => ({ source: {} as CanvasImageSource, width: 64, height: 96, close })),
    requestFrame: vi.fn((callback) => { callbacks.set(++handle, callback); return handle; }),
    cancelFrame: vi.fn((id) => { callbacks.delete(id); }),
  };
  const bundle = createPetLayeredRigBundle({
    manifest: validLayeredRigManifest(),
    assets: new Map([['body', { mediaType: 'image/png' as const, bytes: Uint8Array.of(137, 80, 78, 71).buffer }]]),
  })!;
  return { bundle, callbacks, canvas, close, context, runtime };
}

describe('layered rig canvas2d adapter', () => {
  it('decodes once and renders elapsed-time poses through the shared player interface', async () => {
    const test = fixture();
    const adapter = createLayeredRigCanvas2dAdapter(test.runtime);
    await expect(adapter.load({ canvas: test.canvas, assetBytes: test.bundle })).resolves.toEqual({ status: 'ready' });
    expect(adapter.present({
      state: 'standing', visible: true, reducedMotion: false,
      viewport: { width: 192, height: 208, devicePixelRatio: 2 },
    })).toEqual({ status: 'presented' });
    expect(test.canvas.width).toBe(384);
    const first = [...test.callbacks.values()][0]!;
    first(100);
    const second = [...test.callbacks.values()].at(-1)!;
    second(600);
    expect(test.context.drawImage).toHaveBeenCalledTimes(2);
    const transform = vi.mocked(test.context.transform).mock.lastCall!;
    expect(transform.slice(0, 2)).toEqual([1, 0]);
    expect(Math.abs(transform[2]!)).toBe(0);
    expect(transform.slice(3)).toEqual([1, 96, 198]);
    adapter.dispose();
    expect(test.close).toHaveBeenCalledOnce();
  });

  it('stops scheduling while hidden and draws only standing frame zero in reduced motion', async () => {
    const test = fixture();
    const adapter = createLayeredRigCanvas2dAdapter(test.runtime);
    await adapter.load({ canvas: test.canvas, assetBytes: test.bundle });
    adapter.present({ state: 'eating', visible: true, reducedMotion: false, viewport: { width: 192, height: 208, devicePixelRatio: 1 } });
    adapter.present({ state: 'eating', visible: false, reducedMotion: false, viewport: { width: 192, height: 208, devicePixelRatio: 1 } });
    expect(test.runtime.cancelFrame).toHaveBeenCalledOnce();
    adapter.present({ state: 'eating', visible: true, reducedMotion: true, viewport: { width: 192, height: 208, devicePixelRatio: 1 } });
    expect(test.context.drawImage).toHaveBeenCalledOnce();
    expect(test.runtime.requestFrame).toHaveBeenCalledOnce();
  });

  it('rejects a decoded part whose actual dimensions differ from the declaration', async () => {
    const test = fixture();
    test.runtime.decode = vi.fn(async () => ({ source: {} as CanvasImageSource, width: 63, height: 96, close: test.close }));
    const adapter = createLayeredRigCanvas2dAdapter(test.runtime);
    await expect(adapter.load({ canvas: test.canvas, assetBytes: test.bundle })).resolves.toEqual({ status: 'rejected', code: 'asset-incompatible' });
    expect(test.close).toHaveBeenCalledOnce();
  });
});
