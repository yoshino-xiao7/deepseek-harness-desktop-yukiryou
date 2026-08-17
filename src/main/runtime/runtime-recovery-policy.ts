export interface RuntimeRecoveryPolicy {
  nextDelay(): number | undefined;
  reset(): void;
}

export function createRuntimeRecoveryPolicy(
  retryDelaysMs: readonly number[],
): RuntimeRecoveryPolicy {
  let attempt = 0;
  return {
    nextDelay(): number | undefined {
      const delay = retryDelaysMs[attempt];
      attempt += 1;
      return delay;
    },
    reset(): void {
      attempt = 0;
    },
  };
}
