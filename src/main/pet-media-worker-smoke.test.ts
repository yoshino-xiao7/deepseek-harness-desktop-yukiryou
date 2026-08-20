import { describe, expect, it } from 'vitest';

import { isPetMediaWorkerSmokeTest, petMediaWorkerSmokeArgument } from './pet-media-worker-smoke.js';

describe('pet media worker smoke argument', () => {
  it('only enables the isolated smoke path for the exact argument', () => {
    expect(isPetMediaWorkerSmokeTest(['app', petMediaWorkerSmokeArgument])).toBe(true);
    expect(isPetMediaWorkerSmokeTest(['app', '--pet-media-worker-smoke-testing'])).toBe(false);
  });
});
