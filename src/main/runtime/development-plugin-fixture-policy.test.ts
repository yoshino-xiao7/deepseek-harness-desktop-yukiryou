import { describe, expect, it } from 'vitest';

import { developmentPluginFixtureEnabled } from './development-plugin-fixture-policy.js';

describe('development plugin fixture policy', () => {
  it('enables the fixture only for an unpackaged development host', () => {
    expect(developmentPluginFixtureEnabled(false)).toBe(true);
    expect(developmentPluginFixtureEnabled(true)).toBe(false);
  });
});
