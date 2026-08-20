import { describe, expect, it } from 'vitest';

import { createPetMediaWorkerWebPreferences } from './pet-media-worker-policy.js';

describe('pet media worker policy', () => {
  it('uses a non-persistent sandboxed partition without Node or throttling', () => {
    expect(createPetMediaWorkerWebPreferences('/signed/media-preload.cjs', 'dsh-pet-media-aabb')).toEqual({
      preload: '/signed/media-preload.cjs',
      partition: 'dsh-pet-media-aabb',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    });
    expect(() => createPetMediaWorkerWebPreferences('/signed/media-preload.cjs', 'persist:dsh-pet-media-aabb')).toThrow();
  });
});
