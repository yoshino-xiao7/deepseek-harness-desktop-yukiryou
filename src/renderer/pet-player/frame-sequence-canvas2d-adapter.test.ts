import { describe, expect, it, vi } from 'vitest';

import { encodePetFrameSequenceBundle } from '../../shared/pet-frame-sequence-bundle.js';
import { PET_MOTIONS } from '../../shared/pet-package.js';
import {
  createFrameSequenceCanvas2dAdapter,
  type DecodedPetAtlas,
  type FrameSequenceCanvasRuntime,
} from './frame-sequence-canvas2d-adapter.js';

function encodedBundle(): ArrayBuffer {
  return encodePetFrameSequenceBundle({
    motions: Object.fromEntries(PET_MOTIONS.map((motion, index) => [motion, {
      mediaType: 'image/png',
      bytes: new Uint8Array([index + 1]).buffer,
      width: 800,
      height: 800,
      columns: 8,
      rows: 8,
      frameCount: 60,
      durationMs: 1_000,
    }])) as Parameters<typeof encodePetFrameSequenceBundle>[0]['motions'],
  });
}

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  const close = vi.fn();
  const atlas: DecodedPetAtlas = { source: {} as CanvasImageSource, width: 800, height: 800, close };
  const runtime: FrameSequenceCanvasRuntime = {
    decode: vi.fn(async () => atlas),
    requestFrame: vi.fn((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancelFrame: vi.fn((handle) => { callbacks.delete(handle); }),
  };
  let scale = 1;
  const context = {
    setTransform: vi.fn((nextScale: number) => { scale = nextScale; }),
    getTransform: vi.fn(() => ({ a: scale })),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { adapter: createFrameSequenceCanvas2dAdapter(runtime), runtime, callbacks, close, context, canvas };
}

const PRESENTATION = {
  state: 'eating' as const,
  visible: true,
  reducedMotion: false,
  viewport: { width: 340, height: 280, devicePixelRatio: 2 },
};

describe('frame sequence Canvas2D adapter', () => {
  it('decodes the standing atlas eagerly, loads requested motions lazily, and advances frames from elapsed display time', async () => {
    const { adapter, runtime, callbacks, context, canvas } = fixture();
    await expect(adapter.load({ canvas, assetBytes: encodedBundle() })).resolves.toEqual({ status: 'ready' });
    expect(runtime.decode).toHaveBeenCalledOnce();

    expect(adapter.present(PRESENTATION)).toEqual({ status: 'presented' });
    await Promise.resolve();
    expect(runtime.decode).toHaveBeenCalledTimes(2);
    const first = callbacks.values().next().value;
    expect(first).toBeTypeOf('function');
    first!(0);
    const second = [...callbacks.values()].at(-1);
    second!(500);

    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenLastCalledWith(
      expect.anything(),
      600,
      300,
      100,
      100,
      30,
      0,
      280,
      280,
    );
  });

  it('stops scheduling while hidden and renders only standing frame zero for reduced motion', async () => {
    const { adapter, runtime, context, canvas } = fixture();
    await adapter.load({ canvas, assetBytes: encodedBundle() });
    adapter.present(PRESENTATION);
    adapter.present({ ...PRESENTATION, visible: false });
    expect(runtime.cancelFrame).toHaveBeenCalledOnce();

    adapter.present({ ...PRESENTATION, reducedMotion: true });
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(runtime.requestFrame).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the required standing image cannot be decoded', async () => {
    const { adapter, runtime, close, canvas } = fixture();
    vi.mocked(runtime.decode).mockRejectedValueOnce(new Error('decode failed'));

    await expect(adapter.load({ canvas, assetBytes: encodedBundle() })).resolves.toEqual({
      status: 'rejected',
      code: 'asset-incompatible',
    });
    expect(close).not.toHaveBeenCalled();
  });
});
