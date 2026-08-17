import { describe, expect, it } from 'vitest';

import { createRuntimeRecoveryPolicy } from './runtime-recovery-policy.js';

describe('RuntimeRecoveryPolicy', () => {
  it('allows two bounded retries with backoff, then stops', () => {
    const policy = createRuntimeRecoveryPolicy([250, 1_000]);

    expect(policy.nextDelay()).toBe(250);
    expect(policy.nextDelay()).toBe(1_000);
    expect(policy.nextDelay()).toBeUndefined();
  });

  it('resets after an explicit user restart', () => {
    const policy = createRuntimeRecoveryPolicy([250, 1_000]);
    policy.nextDelay();
    policy.nextDelay();

    policy.reset();

    expect(policy.nextDelay()).toBe(250);
  });
});
