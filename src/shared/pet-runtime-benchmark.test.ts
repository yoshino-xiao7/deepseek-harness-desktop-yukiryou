import { describe, expect, it } from 'vitest';

import {
  buildPetRuntimeBenchmarkComparison,
  validatePetRuntimeBenchmarkRecord,
  type PetRuntimeBenchmarkRecord,
} from './pet-runtime-benchmark.js';

const SHA256 = 'a'.repeat(64);

function benchmark(
  overrides: Partial<PetRuntimeBenchmarkRecord> = {},
): PetRuntimeBenchmarkRecord {
  return {
    schemaVersion: 1,
    candidate: {
      id: 'rive-canvas-lite',
      family: 'rive',
      adapterVersion: 'spike-1',
      runtimeVersion: '0.0.0-pinned-for-spike',
      renderer: 'canvas-lite',
    },
    environment: {
      appVersion: '0.2.1-beta.2',
      electronVersion: '43.4.0',
      platform: 'darwin',
      arch: 'arm64',
      packaged: true,
    },
    scenario: {
      id: 'official-pet-semantic-replay-v1',
      creatorInputSha256: SHA256,
      scriptVersion: 1,
      viewport: { width: 340, height: 280, deviceScaleFactor: 2 },
      warmupMs: 10_000,
      durationMs: 300_000,
      switchCycles: 100,
    },
    trials: [
      {
        frame: {
          sampleWindowMs: 300_000,
          refreshPeriodMs: 16.67,
          frameP95Ms: 18,
          frameP99Ms: 25,
          overDoublePeriodRatio: 0.002,
          consecutiveMissedFrames: 1,
        },
        resources: {
          activeCpuPercent: 4.5,
          hiddenCpuPercent: 0.2,
          peakResidentMemoryBytes: 96_000_000,
          residentMemoryDeltaBytes: 1_000_000,
          longTaskCount: 1,
        },
        lifecycle: {
          completedSwitchCycles: 100,
          crashes: 0,
          watchdogRestarts: 0,
          runtimeFailures: 0,
        },
        network: {
          observedRequests: 0,
          blockedRequests: 0,
        },
      },
    ],
    artifact: {
      packageSha256: SHA256,
      petAssetSha256: SHA256,
      runtimeBundleBytes: 800_000,
      petAssetBytes: 1_200_000,
    },
    evidence: {
      capturedAt: '2026-08-20T10:00:00.000Z',
      source: 'packaged-electron',
      runId: 'run-001',
    },
    ...overrides,
  };
}

describe('pet runtime benchmark contract', () => {
  it('rejects incomplete measurements instead of treating missing values as zero', () => {
    const input = benchmark() as unknown as Record<string, unknown>;
    input.trials = [{ frame: input.trials }];

    const result = validatePetRuntimeBenchmarkRecord(input);

    expect(result.status).toBe('invalid');
    expect(result).toMatchObject({ issues: expect.arrayContaining(['trials[0].resources']) });
  });

  it('rejects unknown fields so source paths and secrets cannot enter persisted evidence', () => {
    const input = {
      ...benchmark(),
      sourcePath: '/Users/example/private/pet.riv',
    };

    expect(validatePetRuntimeBenchmarkRecord(input)).toEqual({
      status: 'invalid',
      issues: ['sourcePath'],
    });
  });

  it('requires candidates to use the same scenario, asset, viewport and environment', () => {
    const rive = benchmark();
    const webm = benchmark({
      candidate: {
        id: 'webm-alpha',
        family: 'webm-alpha',
        adapterVersion: 'spike-1',
        runtimeVersion: 'chromium-43.4.0',
        renderer: 'chromium-video',
      },
      scenario: {
        ...benchmark().scenario,
        viewport: { width: 320, height: 280, deviceScaleFactor: 2 },
      },
    });

    const comparison = buildPetRuntimeBenchmarkComparison([rive, webm]);

    expect(comparison.status).toBe('incomparable');
    expect(comparison).toMatchObject({ issues: ['scenario.viewport'] });
  });

  it('aggregates objective trial measurements without manufacturing subjective scores', () => {
    const secondTrial = {
      ...benchmark().trials[0]!,
      frame: { ...benchmark().trials[0]!.frame, frameP95Ms: 20 },
      resources: {
        ...benchmark().trials[0]!.resources,
        activeCpuPercent: 5.5,
        peakResidentMemoryBytes: 100_000_000,
      },
    };
    const record = benchmark({ trials: [...benchmark().trials, secondTrial] });

    const comparison = buildPetRuntimeBenchmarkComparison([record]);

    if (comparison.status !== 'comparable') throw new Error('expected comparable benchmark');
    expect(comparison).toEqual({
      status: 'comparable',
      rows: [
        expect.objectContaining({
          candidateId: 'rive-canvas-lite',
          trialCount: 2,
          frameP95Ms: 20,
          activeCpuPercentMean: 5,
          peakResidentMemoryBytes: 100_000_000,
        }),
      ],
    });
    expect(comparison.rows[0]).not.toHaveProperty('naturalMotion');
  });

  it('marks offline or lifecycle violations as hard evidence failures', () => {
    const record = benchmark({
      trials: [{
        ...benchmark().trials[0]!,
        network: { observedRequests: 1, blockedRequests: 1 },
      }],
    });

    const comparison = buildPetRuntimeBenchmarkComparison([record]);

    expect(comparison).toMatchObject({
      status: 'comparable',
      rows: [{
        candidateId: 'rive-canvas-lite',
        objectiveGates: {
          packagedArm64: 'pass',
          offline: 'fail',
          lifecycleStability: 'pass',
        },
        scorecardImportReady: false,
      }],
    });
  });

  it('treats player-declared runtime failures as lifecycle failures', () => {
    const record = benchmark({
      trials: [{
        ...benchmark().trials[0]!,
        lifecycle: { ...benchmark().trials[0]!.lifecycle, runtimeFailures: 1 },
      }],
    });

    expect(buildPetRuntimeBenchmarkComparison([record])).toMatchObject({
      status: 'comparable',
      rows: [{ objectiveGates: { lifecycleStability: 'fail' } }],
    });
  });
});
