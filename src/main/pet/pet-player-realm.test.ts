import { describe, expect, it } from 'vitest';

import {
  PET_PLAYER_PARTITION,
  createPetPlayerWebPreferences,
  isPetPlayerNavigationAllowed,
  isPetPlayerRequestAllowed,
} from './pet-player-policy.js';
import { isSafePetPlayerAsset } from './pet-player-realm.js';

describe('pet player realm security policy', () => {
  it('accepts only bounded, hashed, supported player assets', () => {
    const valid = {
      petGeneration: 4,
      runtime: 'rive-canvas-lite' as const,
      assetSha256: 'a'.repeat(64),
      assetBytes: new Uint8Array([1, 2, 3]).buffer,
    };

    expect(isSafePetPlayerAsset(valid)).toBe(true);
    expect(isSafePetPlayerAsset({ ...valid, petGeneration: -1 })).toBe(false);
    expect(isSafePetPlayerAsset({ ...valid, assetSha256: 'A'.repeat(64) })).toBe(false);
    expect(isSafePetPlayerAsset({ ...valid, assetBytes: new ArrayBuffer(0) })).toBe(false);
    expect(isSafePetPlayerAsset({ ...valid, runtime: 'frame-sequence-canvas2d' })).toBe(true);
    expect(isSafePetPlayerAsset({ ...valid, runtime: 'layered-rig-canvas2d' })).toBe(true);
  });

  it('creates an isolated, sandboxed web preference set without Workspace capabilities', () => {
    expect(createPetPlayerWebPreferences('/signed/pet-player-preload.cjs')).toEqual({
      preload: '/signed/pet-player-preload.cjs',
      partition: PET_PLAYER_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    });
  });

  it('allows only the exact signed player document to navigate', () => {
    const entry = 'file:///Applications/DeepSeek.app/Contents/Resources/app.asar/.vite/renderer/pet_player/index.html';

    expect(isPetPlayerNavigationAllowed(entry, entry)).toBe(true);
    expect(isPetPlayerNavigationAllowed(entry, `${entry}?debug=true`)).toBe(false);
    expect(isPetPlayerNavigationAllowed(entry, 'https://example.com/player')).toBe(false);
  });

  it('blocks every network request for a packaged file entry', () => {
    const entry = 'file:///Applications/DeepSeek.app/Contents/Resources/app.asar/.vite/renderer/pet_player/index.html';

    expect(isPetPlayerRequestAllowed(entry, entry)).toBe(true);
    expect(isPetPlayerRequestAllowed(entry, 'file:///Applications/DeepSeek.app/Contents/Resources/app.asar/.vite/renderer/pet_player/assets/player.js')).toBe(true);
    expect(isPetPlayerRequestAllowed(entry, 'https://cdn.example.com/runtime.wasm')).toBe(false);
    expect(isPetPlayerRequestAllowed(entry, 'data:application/wasm;base64,AAAA')).toBe(false);
  });

  it('allows only the same loopback origin during development', () => {
    const entry = 'http://127.0.0.1:5174/index.html';

    expect(isPetPlayerRequestAllowed(entry, 'http://127.0.0.1:5174/pet-player.ts')).toBe(true);
    expect(isPetPlayerRequestAllowed(entry, 'ws://127.0.0.1:5174/')).toBe(true);
    expect(isPetPlayerRequestAllowed(entry, 'http://localhost:5174/pet-player.ts')).toBe(false);
    expect(isPetPlayerRequestAllowed(entry, 'https://example.com/runtime.wasm')).toBe(false);
  });
});
