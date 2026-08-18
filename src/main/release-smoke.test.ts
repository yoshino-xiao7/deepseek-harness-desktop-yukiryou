import { describe, expect, it } from 'vitest';

import {
  isReleaseSmokeTest,
  releaseSmokeArgument,
} from './release-smoke.js';

describe('release smoke argument', () => {
  it('only enables the isolated smoke path for the explicit argument', () => {
    expect(isReleaseSmokeTest(['electron', releaseSmokeArgument])).toBe(true);
    expect(isReleaseSmokeTest(['electron', '--release-smoke-testing'])).toBe(
      false,
    );
  });
});
