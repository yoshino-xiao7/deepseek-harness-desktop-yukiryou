import { describe, expect, it } from 'vitest';

import { runtimeStartupTimeoutMs } from './runtime-startup-policy.js';

describe('runtime startup policy', () => {
  it('allows a cold Windows runtime to finish without weakening macOS startup feedback', () => {
    expect(runtimeStartupTimeoutMs('win32')).toBe(60_000);
    expect(runtimeStartupTimeoutMs('darwin')).toBe(20_000);
    expect(runtimeStartupTimeoutMs('linux')).toBe(20_000);
  });
});
