import { describe, expect, it } from 'vitest';

import type { PetPlayerOutputMessage } from '../../shared/pet-player-protocol.js';
import { createPetRuntimeTrialRecorder } from './pet-runtime-trial-recorder.js';

function metrics(overrides: Partial<Extract<PetPlayerOutputMessage, { kind: 'metrics' }>> = {}): Extract<PetPlayerOutputMessage, { kind: 'metrics' }> {
  return {
    kind: 'metrics',
    realmEpoch: 'a'.repeat(32),
    petGeneration: 1,
    presentationGeneration: 1,
    sampleWindowMs: 5_000,
    refreshPeriodMs: 16.67,
    frameP95Ms: 18,
    frameP99Ms: 24,
    overDoublePeriodRatio: 0.002,
    consecutiveMissedFrames: 1,
    longTaskCount: 2,
    ...overrides,
  };
}

describe('pet runtime trial recorder', () => {
  it('fails closed when frame, active, hidden, or network coverage is missing', () => {
    const recorder = createPetRuntimeTrialRecorder();

    expect(recorder.finish({ networkObservationComplete: false })).toEqual({
      status: 'incomplete',
      issues: ['active-resources', 'frame-metrics', 'hidden-resources', 'network-observation'],
    });
  });

  it('aggregates guarded Player output and process samples into one objective trial', () => {
    const recorder = createPetRuntimeTrialRecorder();
    recorder.recordPlayerOutput(metrics());
    recorder.recordPlayerOutput(metrics({
      sampleWindowMs: 4_000,
      refreshPeriodMs: 16.69,
      frameP95Ms: 20,
      frameP99Ms: 28,
      overDoublePeriodRatio: 0.004,
      consecutiveMissedFrames: 3,
      longTaskCount: 1,
    }));
    recorder.recordPlayerOutput({
      kind: 'failure',
      realmEpoch: 'a'.repeat(32),
      petGeneration: 1,
      code: 'runtime-error',
    });
    recorder.recordResourceSample({ visible: true, cpuPercent: 4, residentMemoryBytes: 90_000_000 });
    recorder.recordResourceSample({ visible: true, cpuPercent: 6, residentMemoryBytes: 96_000_000 });
    recorder.recordResourceSample({ visible: false, cpuPercent: 0.2, residentMemoryBytes: 92_000_000 });
    recorder.recordNetworkRequest(true);
    recorder.recordSwitchCompleted();
    recorder.recordCrash();
    recorder.recordWatchdogRestart();

    expect(recorder.finish({ networkObservationComplete: true })).toEqual({
      status: 'complete',
      trial: {
        frame: {
          sampleWindowMs: 9_000,
          refreshPeriodMs: 16.68,
          frameP95Ms: 20,
          frameP99Ms: 28,
          overDoublePeriodRatio: 0.004,
          consecutiveMissedFrames: 3,
        },
        resources: {
          activeCpuPercent: 5,
          hiddenCpuPercent: 0.2,
          peakResidentMemoryBytes: 96_000_000,
          residentMemoryDeltaBytes: 2_000_000,
          longTaskCount: 3,
        },
        lifecycle: {
          completedSwitchCycles: 1,
          crashes: 1,
          watchdogRestarts: 1,
          runtimeFailures: 1,
        },
        network: { observedRequests: 1, blockedRequests: 1 },
      },
    });
  });

  it('rejects invalid process samples instead of coercing them to zero', () => {
    const recorder = createPetRuntimeTrialRecorder();
    recorder.recordPlayerOutput(metrics());
    recorder.recordResourceSample({ visible: true, cpuPercent: Number.NaN, residentMemoryBytes: 1 });
    recorder.recordResourceSample({ visible: false, cpuPercent: 0, residentMemoryBytes: 1 });

    expect(recorder.finish({ networkObservationComplete: true })).toEqual({
      status: 'incomplete',
      issues: ['active-resources', 'resource-sample'],
    });
  });

  it('cannot be finalized twice', () => {
    const recorder = createPetRuntimeTrialRecorder();
    recorder.finish({ networkObservationComplete: false });

    expect(recorder.finish({ networkObservationComplete: true })).toEqual({
      status: 'incomplete',
      issues: ['already-finished'],
    });
  });
});
