import { describe, expect, it, vi } from 'vitest';

import { createManagedInstallConfirmation } from './managed-install-confirmation.js';

const requestId = 'request-11111111-1111-4111-8111-111111111111';
const previewId = 'preview-22222222-2222-4222-8222-222222222222';
const summary = {
  packageName: '@community/example',
  version: '1.2.3',
  artifact: {
    verifiedArtifacts: 2,
    verifiedCompressedBytes: 10,
    verifiedUnpackedBytes: 20,
    verifiedFileCount: 3,
  },
  dependencies: {
    direct: 1,
    peers: 0,
    nodes: 2,
    edges: 1,
    maxDepth: 1,
    peerRequirements: 0,
    peerSatisfied: 0,
    peerOptionalMissing: 0,
    optionalSkipped: 0,
  },
  lifecycleScripts: [],
};
const candidate = {
  packageName: '@community/example',
  version: '1.2.3',
  integrity: 'sha512-example',
  sourceId: 'dshfind',
  bundlePath: 'cordis.patch.yml',
  graphHash: `sha256:${'a'.repeat(64)}`,
  lockHash: `sha256:${'b'.repeat(64)}`,
};

function setup(overrides: Record<string, unknown> = {}) {
  const execute = vi.fn(async () => ({
    status: 'prepared' as const,
    profileGeneration: 'generation',
    stagingStatus: 'staged',
  }));
  const issue = vi.fn(() => ({
    previewId,
    profileGeneration: `gen-${'c'.repeat(64)}`,
    expiresInSeconds: 300,
  }));
  const confirm = vi.fn(async () => true);
  const scheduleRestart = vi.fn();
  const confirmation = createManagedInstallConfirmation({
    transaction: { issue, execute },
    confirm,
    runtimeAvailable: () => true,
    scheduleRestart,
    ...overrides,
  });
  const issued = confirmation.issue({
    generation: `gen-${'c'.repeat(64)}`,
    candidate,
    stagingPreviewId: 'preview-33333333-3333-4333-8333-333333333333',
    expiresInSeconds: 240,
    summary,
    operation: { kind: 'install' },
    expectedReceipt: null,
  });
  return { confirmation, confirm, execute, issue, issued, scheduleRestart };
}

describe('ManagedInstallConfirmation', () => {
  it('requires main-owned confirmation before executing and scheduling restart', async () => {
    const { confirmation, confirm, execute, issued, scheduleRestart } = setup();

    expect(issued).toMatchObject({ previewId, expiresInSeconds: 240, summary });
    await expect(confirmation.execute({ requestId, previewId })).resolves.toEqual({
      requestId,
      status: 'prepared',
      restartScheduled: true,
    });
    expect(confirm).toHaveBeenCalledWith(summary, { kind: 'install' });
    expect(execute).toHaveBeenCalledWith(previewId);
    expect(scheduleRestart).toHaveBeenCalledOnce();
  });

  it('keeps a preview reusable when the user cancels', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { confirmation, execute } = setup({ confirm });

    await expect(confirmation.execute({ requestId, previewId })).resolves.toEqual({
      requestId,
      status: 'cancelled',
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(confirmation.execute({ requestId, previewId })).resolves.toMatchObject({
      status: 'prepared',
    });
  });

  it('rechecks expiry and Runtime identity after the native dialog', async () => {
    let timestamp = 1_000;
    let runtimeAvailable = true;
    const confirm = vi.fn(async () => {
      timestamp += 240_000;
      runtimeAvailable = false;
      return true;
    });
    const { confirmation, execute } = setup({
      confirm,
      now: () => timestamp,
      runtimeAvailable: () => runtimeAvailable,
    });

    await expect(confirmation.execute({ requestId, previewId })).resolves.toEqual({
      requestId,
      status: 'unavailable',
      reason: 'preview-unavailable',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
