import { describe, expect, it } from 'vitest';

import { pluginProfileRestartKind } from './plugin-profile-restart-policy.js';

describe('pluginProfileRestartKind', () => {
  it('keeps the Forge renderer host alive in development', () => {
    expect(pluginProfileRestartKind(false)).toBe('runtime');
  });

  it('relaunches the signed application for a packaged build', () => {
    expect(pluginProfileRestartKind(true)).toBe('application');
  });
});
