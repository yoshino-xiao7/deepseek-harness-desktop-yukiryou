export type RendererTarget = 'toolbar' | 'harness' | 'pet-player';

export interface RendererRecoveryPolicy {
  nextDelay(target: RendererTarget, now?: number): number | undefined;
  reset(target: RendererTarget): void;
}

export function createRendererRecoveryPolicy(
  retryDelaysMs: readonly number[],
  windowMs: number,
): RendererRecoveryPolicy {
  const attempts = new Map<RendererTarget, number[]>();
  return {
    nextDelay(target: RendererTarget, now = Date.now()): number | undefined {
      const recent = (attempts.get(target) ?? []).filter(
        (attempt) => now - attempt < windowMs,
      );
      const delay = retryDelaysMs[recent.length];
      if (delay === undefined) {
        attempts.set(target, recent);
        return undefined;
      }
      attempts.set(target, [...recent, now]);
      return delay;
    },
    reset(target: RendererTarget): void {
      attempts.delete(target);
    },
  };
}
