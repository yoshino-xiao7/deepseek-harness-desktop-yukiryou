export interface PetFrameMetrics {
  readonly sampleWindowMs: number;
  readonly refreshPeriodMs: number;
  readonly frameP95Ms: number;
  readonly frameP99Ms: number;
  readonly overDoublePeriodRatio: number;
  readonly consecutiveMissedFrames: number;
}

export function summarizePetFrameTimestamps(
  timestamps: readonly number[],
): PetFrameMetrics | undefined {
  if (timestamps.length < 3 || timestamps.some((value) => !Number.isFinite(value))) return undefined;
  const intervals: number[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const current = timestamps[index];
    const previous = timestamps[index - 1];
    if (current === undefined || previous === undefined || current <= previous) return undefined;
    intervals.push(current - previous);
  }
  const first = timestamps[0];
  const last = timestamps.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const sorted = [...intervals].sort((left, right) => left - right);
  const refreshPeriodMs = median(sorted);
  const missedThreshold = refreshPeriodMs * 2;
  let missedCount = 0;
  let consecutiveMissedFrames = 0;
  let currentConsecutive = 0;
  for (const interval of intervals) {
    if (interval > missedThreshold) {
      missedCount += 1;
      currentConsecutive += 1;
      consecutiveMissedFrames = Math.max(consecutiveMissedFrames, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }
  return {
    sampleWindowMs: last - first,
    refreshPeriodMs,
    frameP95Ms: percentile(sorted, 0.95),
    frameP99Ms: percentile(sorted, 0.99),
    overDoublePeriodRatio: missedCount / intervals.length,
    consecutiveMissedFrames,
  };
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? 0;
}
