import type { PetRuntimeBenchmarkTrial } from '../../shared/pet-runtime-benchmark.js';
import type { PetPlayerOutputMessage } from '../../shared/pet-player-protocol.js';

type MetricsMessage = Extract<PetPlayerOutputMessage, { kind: 'metrics' }>;

export interface PetRuntimeResourceSample {
  readonly visible: boolean;
  readonly cpuPercent: number;
  readonly residentMemoryBytes: number;
}

export interface PetRuntimeTrialRecorder {
  recordPlayerOutput(message: PetPlayerOutputMessage): void;
  recordResourceSample(sample: PetRuntimeResourceSample): void;
  recordNetworkRequest(blocked: boolean): void;
  recordSwitchCompleted(): void;
  recordCrash(): void;
  recordWatchdogRestart(): void;
  finish(input: { readonly networkObservationComplete: boolean }): PetRuntimeTrialResult;
}

export type PetRuntimeTrialResult =
  | { readonly status: 'complete'; readonly trial: PetRuntimeBenchmarkTrial }
  | { readonly status: 'incomplete'; readonly issues: readonly string[] };

export function createPetRuntimeTrialRecorder(): PetRuntimeTrialRecorder {
  const metrics: MetricsMessage[] = [];
  const resources: PetRuntimeResourceSample[] = [];
  const issues = new Set<string>();
  let completedSwitchCycles = 0;
  let crashes = 0;
  let watchdogRestarts = 0;
  let runtimeFailures = 0;
  let observedRequests = 0;
  let blockedRequests = 0;
  let finished = false;

  return {
    recordPlayerOutput(message): void {
      if (!acceptEvent()) return;
      if (message.kind === 'metrics') metrics.push(message);
      if (message.kind === 'failure') runtimeFailures += 1;
    },
    recordResourceSample(sample): void {
      if (!acceptEvent()) return;
      if (!validResourceSample(sample)) {
        issues.add('resource-sample');
        return;
      }
      resources.push(Object.freeze({ ...sample }));
    },
    recordNetworkRequest(blocked): void {
      if (!acceptEvent()) return;
      observedRequests += 1;
      if (blocked) blockedRequests += 1;
    },
    recordSwitchCompleted(): void {
      if (acceptEvent()) completedSwitchCycles += 1;
    },
    recordCrash(): void {
      if (acceptEvent()) crashes += 1;
    },
    recordWatchdogRestart(): void {
      if (acceptEvent()) watchdogRestarts += 1;
    },
    finish(input): PetRuntimeTrialResult {
      if (finished) return { status: 'incomplete', issues: ['already-finished'] };
      finished = true;
      if (metrics.length === 0) issues.add('frame-metrics');
      const activeResources = resources.filter((sample) => sample.visible);
      const hiddenResources = resources.filter((sample) => !sample.visible);
      if (activeResources.length === 0) issues.add('active-resources');
      if (hiddenResources.length === 0) issues.add('hidden-resources');
      if (input.networkObservationComplete !== true) issues.add('network-observation');
      if (issues.size > 0) return { status: 'incomplete', issues: [...issues].sort() };

      const firstMemory = resources[0]!.residentMemoryBytes;
      const lastMemory = resources.at(-1)!.residentMemoryBytes;
      return {
        status: 'complete',
        trial: {
          frame: aggregateFrameMetrics(metrics),
          resources: {
            activeCpuPercent: mean(activeResources.map((sample) => sample.cpuPercent)),
            hiddenCpuPercent: mean(hiddenResources.map((sample) => sample.cpuPercent)),
            peakResidentMemoryBytes: maximum(resources.map((sample) => sample.residentMemoryBytes)),
            residentMemoryDeltaBytes: lastMemory - firstMemory,
            longTaskCount: sum(metrics.map((sample) => sample.longTaskCount)),
          },
          lifecycle: {
            completedSwitchCycles,
            crashes,
            watchdogRestarts,
            runtimeFailures,
          },
          network: { observedRequests, blockedRequests },
        },
      };
    },
  };

  function acceptEvent(): boolean {
    if (!finished) return true;
    issues.add('event-after-finish');
    return false;
  }
}

function aggregateFrameMetrics(samples: readonly MetricsMessage[]): PetRuntimeBenchmarkTrial['frame'] {
  return {
    sampleWindowMs: sum(samples.map((sample) => sample.sampleWindowMs)),
    refreshPeriodMs: median(samples.map((sample) => sample.refreshPeriodMs)),
    frameP95Ms: maximum(samples.map((sample) => sample.frameP95Ms)),
    frameP99Ms: maximum(samples.map((sample) => sample.frameP99Ms)),
    overDoublePeriodRatio: maximum(samples.map((sample) => sample.overDoublePeriodRatio)),
    consecutiveMissedFrames: maximum(samples.map((sample) => sample.consecutiveMissedFrames)),
  };
}

function validResourceSample(sample: PetRuntimeResourceSample): boolean {
  return typeof sample.visible === 'boolean'
    && Number.isFinite(sample.cpuPercent)
    && sample.cpuPercent >= 0
    && sample.cpuPercent <= 1_000
    && Number.isSafeInteger(sample.residentMemoryBytes)
    && sample.residentMemoryBytes >= 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return round(sum(values) / values.length);
}

function maximum(values: readonly number[]): number {
  return Math.max(...values);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
