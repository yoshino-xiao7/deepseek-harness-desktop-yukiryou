import { describe, expect, it } from 'vitest';

import { createRendererRecoveryPolicy } from './renderer-recovery-policy.js';

describe('renderer recovery policy', () => {
  it('tracks toolbar and Harness retry budgets independently', () => {
    const policy = createRendererRecoveryPolicy([250, 1_000], 30_000);

    expect(policy.nextDelay('toolbar', 1_000)).toBe(250);
    expect(policy.nextDelay('toolbar', 2_000)).toBe(1_000);
    expect(policy.nextDelay('toolbar', 3_000)).toBeUndefined();
    expect(policy.nextDelay('harness', 3_000)).toBe(250);
  });

  it('allows recovery again after the stability window', () => {
    const policy = createRendererRecoveryPolicy([250, 1_000], 30_000);
    policy.nextDelay('harness', 1_000);
    policy.nextDelay('harness', 2_000);

    expect(policy.nextDelay('harness', 32_001)).toBe(250);
  });

  it('can reset one target explicitly', () => {
    const policy = createRendererRecoveryPolicy([250], 30_000);
    policy.nextDelay('toolbar', 1_000);
    policy.nextDelay('harness', 1_000);

    policy.reset('toolbar');

    expect(policy.nextDelay('toolbar', 2_000)).toBe(250);
    expect(policy.nextDelay('harness', 2_000)).toBeUndefined();
  });
});
