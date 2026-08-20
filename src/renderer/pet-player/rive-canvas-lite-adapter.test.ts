import { describe, expect, it, vi } from 'vitest';

import {
  RIVE_SPIKE_MOTION_CODES,
  createRiveCanvasLiteAdapter,
  type RiveCanvasLiteInstance,
  type RiveCanvasLiteRuntime,
} from './rive-canvas-lite-adapter.js';

const CANVAS = {} as HTMLCanvasElement;

function fixture() {
  const instance: RiveCanvasLiteInstance = {
    setMotion: vi.fn(),
    resize: vi.fn(),
    startRendering: vi.fn(),
    stopRendering: vi.fn(),
    drawFrame: vi.fn(),
    cleanup: vi.fn(),
  };
  const runtime = {
    prepare: vi.fn(async () => undefined),
    create: vi.fn(async () => instance),
  } satisfies RiveCanvasLiteRuntime;
  return { instance, runtime, adapter: createRiveCanvasLiteAdapter(runtime) };
}

describe('Rive Canvas Lite adapter', () => {
  it('prepares the offline runtime before loading validated asset bytes', async () => {
    const { runtime, adapter } = fixture();
    const canvas = CANVAS;
    const assetBytes = new Uint8Array([1, 2, 3]).buffer;

    await expect(adapter.load({ canvas, assetBytes })).resolves.toEqual({ status: 'ready' });

    expect(runtime.prepare).toHaveBeenCalledOnce();
    expect(runtime.create).toHaveBeenCalledWith({ canvas, assetBytes });
    expect(runtime.prepare.mock.invocationCallOrder[0]).toBeLessThan(runtime.create.mock.invocationCallOrder[0]!);
  });

  it('maps semantic motion inside the adapter and pauses when hidden', async () => {
    const { instance, adapter } = fixture();
    await adapter.load({ canvas: CANVAS, assetBytes: new ArrayBuffer(8) });

    expect(adapter.present({
      state: 'eating',
      visible: true,
      reducedMotion: false,
      viewport: { width: 340, height: 280, devicePixelRatio: 2 },
    })).toEqual({ status: 'presented' });
    expect(instance.resize).toHaveBeenCalledWith(340, 280, 2);
    expect(instance.setMotion).toHaveBeenCalledWith(RIVE_SPIKE_MOTION_CODES.eating);
    expect(instance.startRendering).toHaveBeenCalledOnce();

    adapter.present({
      state: 'sleeping',
      visible: false,
      reducedMotion: false,
      viewport: { width: 340, height: 280, devicePixelRatio: 2 },
    });
    expect(instance.stopRendering).toHaveBeenCalledOnce();
  });

  it('uses a static standing frame for reduced motion', async () => {
    const { instance, adapter } = fixture();
    await adapter.load({ canvas: CANVAS, assetBytes: new ArrayBuffer(8) });

    adapter.present({
      state: 'eating',
      visible: true,
      reducedMotion: true,
      viewport: { width: 340, height: 280, devicePixelRatio: 2 },
    });

    expect(instance.setMotion).toHaveBeenCalledWith(RIVE_SPIKE_MOTION_CODES.standing);
    expect(instance.stopRendering).toHaveBeenCalledOnce();
    expect(instance.drawFrame).toHaveBeenCalledOnce();
    expect(instance.startRendering).not.toHaveBeenCalled();
  });

  it('fails closed and cleans up a partially created runtime', async () => {
    const { instance, runtime, adapter } = fixture();
    runtime.create.mockRejectedValueOnce(new Error('missing PetMachine'));

    await expect(adapter.load({
      canvas: CANVAS,
      assetBytes: new ArrayBuffer(8),
    })).resolves.toEqual({ status: 'rejected', code: 'asset-incompatible' });

    expect(adapter.present({
      state: 'standing',
      visible: true,
      reducedMotion: false,
      viewport: { width: 340, height: 280, devicePixelRatio: 2 },
    })).toEqual({ status: 'not-ready' });
    expect(instance.cleanup).not.toHaveBeenCalled();
  });

  it('disposes the active runtime exactly once', async () => {
    const { instance, adapter } = fixture();
    await adapter.load({ canvas: CANVAS, assetBytes: new ArrayBuffer(8) });

    adapter.dispose();
    adapter.dispose();

    expect(instance.cleanup).toHaveBeenCalledOnce();
  });
});
