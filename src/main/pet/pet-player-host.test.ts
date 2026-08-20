import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PetPlayerRealm } from './pet-player-realm.js';
import { createPetPlayerHost } from './pet-player-host.js';

function fakeRealm() {
  return {
    start: vi.fn<PetPlayerRealm['start']>().mockResolvedValue(undefined),
    present: vi.fn<PetPlayerRealm['present']>(),
    dispose: vi.fn<PetPlayerRealm['dispose']>(),
  } satisfies PetPlayerRealm;
}

const selection = {
  id: 'builtin.pet',
  runtime: 'rive-canvas-lite' as const,
  assetSha256: 'a'.repeat(64),
  assetBytes: new Uint8Array([1, 2, 3]).buffer,
};

const stage = {
  bounds: { x: 100, y: 120, width: 340, height: 180 },
  visible: true,
  running: false,
  reducedMotion: false,
  devicePixelRatio: 2,
};

describe('pet player host', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hides generation and semantic mapping behind select/present', async () => {
    const realm = fakeRealm();
    const host = createPetPlayerHost(() => realm);

    host.present(stage);
    await expect(host.select(selection)).resolves.toBe('ready');

    expect(realm.start).toHaveBeenCalledWith(expect.objectContaining({ petGeneration: 1 }));
    expect(realm.present).toHaveBeenLastCalledWith(expect.objectContaining({
      petGeneration: 1,
      presentationGeneration: 1,
      state: 'standing',
    }));
    host.present({ ...stage, running: true });
    expect(realm.present).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'work-enter' }));
    vi.advanceTimersByTime(1_000);
    expect(realm.present).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'eating' }));
  });

  it('does not recreate the realm for the same immutable asset', async () => {
    const realm = fakeRealm();
    const createRealm = vi.fn(() => realm);
    const host = createPetPlayerHost(createRealm);

    await host.select(selection);
    await host.select(selection);

    expect(createRealm).toHaveBeenCalledTimes(1);
    expect(realm.start).toHaveBeenCalledTimes(1);
  });

  it('recreates the realm when the same asset identity changes runtime', async () => {
    const first = fakeRealm();
    const second = fakeRealm();
    const realms = [first, second];
    const host = createPetPlayerHost(() => realms.shift()!);

    await host.select(selection);
    await host.select({ ...selection, runtime: 'frame-sequence-canvas2d' });

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.start).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'frame-sequence-canvas2d' }));
  });

  it('joins duplicate selections to the same pending startup', async () => {
    let resolveStart: (() => void) | undefined;
    const realm = fakeRealm();
    realm.start.mockImplementation(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    const host = createPetPlayerHost(() => realm);

    const first = host.select(selection);
    const second = host.select(selection);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    resolveStart?.();

    await expect(first).resolves.toBe('ready');
    await expect(second).resolves.toBe('ready');
    expect(realm.start).toHaveBeenCalledTimes(1);
  });

  it('disposes stale realms when selection changes during startup', async () => {
    let resolveFirst: (() => void) | undefined;
    const first = fakeRealm();
    first.start.mockImplementation(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const second = fakeRealm();
    const realms = [first, second];
    const host = createPetPlayerHost(() => realms.shift()!);

    const firstSelection = host.select(selection);
    await host.select({ ...selection, id: 'imported.pet', assetSha256: 'b'.repeat(64) });
    resolveFirst?.();
    await firstSelection;

    expect(first.dispose).toHaveBeenCalled();
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('hides and disposes the active realm without leaking a presentation', async () => {
    const realm = fakeRealm();
    const host = createPetPlayerHost(() => realm);
    await host.select(selection);

    host.present({ ...stage, visible: false });
    expect(realm.present).toHaveBeenLastCalledWith();
    await expect(host.select()).resolves.toBe('unavailable');
    expect(realm.dispose).toHaveBeenCalledTimes(1);
  });

  it('routes owner activation through the wake-up sequence', async () => {
    const realm = fakeRealm();
    const host = createPetPlayerHost(() => realm);
    host.present(stage);
    await host.select(selection);
    vi.advanceTimersByTime(45_000 + 1_800 + 1_900);
    expect(realm.present).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'sleeping' }));

    host.wake();

    expect(realm.present).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'waking' }));
    vi.advanceTimersByTime(2_100);
    expect(realm.present).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'rubbing-eyes' }));
  });
});
