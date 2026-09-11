import { describe, expect, it } from 'vitest';

import { runtimeStartupTimeoutMs } from './runtime-startup-policy.js';

describe('runtime startup policy', () => {
  it('waits for fail-loud loader diagnostics before treating startup as timed out', () => {
    expect(runtimeStartupTimeoutMs('win32')).toBe(60_000);
    expect(runtimeStartupTimeoutMs('darwin')).toBe(60_000);
    expect(runtimeStartupTimeoutMs('linux')).toBe(60_000);
  });
});
