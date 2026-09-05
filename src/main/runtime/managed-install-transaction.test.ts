import { describe, expect, it, vi } from 'vitest';

import { createManagedInstallTransaction } from './managed-install-transaction.js';
import { createPluginProfileGeneration } from './plugin-profile-bootstrap.js';

const candidate = {
  packageName: '@community/example',
  version: '1.2.3',
  integrity: 'sha512-example',
  sourceId: 'dshfind',
  bundlePath: 'cordis.patch.yml',
  graphHash: `sha256:${'a'.repeat(64)}`,
  lockHash: `sha256:${'b'.repeat(64)}`,
};
const generation = createPluginProfileGeneration(candidate);
const stagingPreviewId = 'preview-99999999-9999-4999-8999-999999999999';
const cacheDigests = [`sha512:${'d'.repeat(128)}`];

describe('ManagedInstallTransaction', () => {
  it('keeps the frozen plan private and prepares the exact staged generation', async () => {
    const stage = vi.fn(async () => ({
      status: 'staged',
      profileGeneration: generation,
      candidate,
      cacheDigests,
    }));
    const prepare = vi.fn(async () => undefined);
    const transaction = createManagedInstallTransaction({
      installer: { stage },
      bootstrap: { prepare },
      randomId: () => '11111111-1111-4111-8111-111111111111',
    });

    const preview = transaction.issue({
      generation,
      candidate,
      stagingPreviewId,
      expectedReceipt: null,
    });
    expect(preview).toEqual({
      previewId: 'preview-11111111-1111-4111-8111-111111111111',
      profileGeneration: generation,
      expiresInSeconds: 300,
    });
    expect(preview).not.toHaveProperty('plan');
    await expect(transaction.execute(preview.previewId)).resolves.toEqual({
      status: 'prepared',
      profileGeneration: generation,
      stagingStatus: 'staged',
    });
    expect(stage).toHaveBeenCalledWith({
      generation,
      previewId: stagingPreviewId,
    });
    expect(prepare).toHaveBeenCalledWith(generation, candidate, cacheDigests, null, undefined);
  });

  it('expires previews without touching the installer', async () => {
    let timestamp = 1_000;
    const stage = vi.fn();
    const transaction = createManagedInstallTransaction({
      installer: { stage },
      bootstrap: { prepare: vi.fn() },
      now: () => timestamp,
      ttlMs: 1_000,
      randomId: () => '22222222-2222-4222-8222-222222222222',
    });
    const preview = transaction.issue({
      generation,
      candidate,
      stagingPreviewId,
      expectedReceipt: null,
    });
    timestamp += 1_000;

    await expect(transaction.execute(preview.previewId)).rejects.toMatchObject({
      code: 'catalog:transaction-preview-unavailable',
    });
    expect(stage).not.toHaveBeenCalled();
  });

  it('consumes a preview before mutation and cannot replay it after failure', async () => {
    const transaction = createManagedInstallTransaction({
      installer: {
        stage: async () => {
          throw new Error('disk failure');
        },
      },
      bootstrap: { prepare: vi.fn() },
      randomId: () => '33333333-3333-4333-8333-333333333333',
    });
    const preview = transaction.issue({
      generation,
      candidate,
      stagingPreviewId,
      expectedReceipt: null,
    });

    await expect(transaction.execute(preview.previewId)).rejects.toMatchObject({
      code: 'catalog:transaction-execute-failed',
    });
    await expect(transaction.execute(preview.previewId)).rejects.toMatchObject({
      code: 'catalog:transaction-preview-unavailable',
    });
  });

  it('rejects concurrent mutations without consuming the waiting preview', async () => {
    let release: (() => void) | undefined;
    const firstStage = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const transaction = createManagedInstallTransaction({
      installer: {
        stage: async () => {
          calls += 1;
          if (calls === 1) await firstStage;
          return calls === 1
            ? {
                status: 'staged',
                profileGeneration: generation,
                candidate,
                cacheDigests,
              }
            : {
                status: 'staged',
                profileGeneration: secondGeneration,
                candidate: secondCandidate,
                cacheDigests,
              };
        },
      },
      bootstrap: { prepare: vi.fn(async () => undefined) },
      randomId: (() => {
        const ids = [
          '44444444-4444-4444-8444-444444444444',
          '55555555-5555-4555-8555-555555555555',
        ];
        return () => ids.shift() ?? '';
      })(),
    });
    const first = transaction.issue({
      generation,
      candidate,
      stagingPreviewId,
      expectedReceipt: null,
    });
    const secondCandidate = { ...candidate, version: '1.2.4' };
    const secondGeneration = createPluginProfileGeneration(secondCandidate);
    const second = transaction.issue({
      generation: secondGeneration,
      candidate: secondCandidate,
      stagingPreviewId: 'preview-88888888-8888-4888-8888-888888888888',
      expectedReceipt: null,
    });
    const running = transaction.execute(first.previewId);

    await expect(transaction.execute(second.previewId)).rejects.toMatchObject({
      code: 'catalog:transaction-busy',
    });
    release?.();
    await running;
    await expect(transaction.execute(second.previewId)).resolves.toMatchObject({
      status: 'prepared',
      profileGeneration: secondGeneration,
    });
  });

  it('rejects a preview whose generation does not bind its candidate', () => {
    const transaction = createManagedInstallTransaction({
      installer: { stage: vi.fn() },
      bootstrap: { prepare: vi.fn() },
    });
    expect(() =>
      transaction.issue({
        generation: `gen-${'f'.repeat(64)}`,
        candidate,
        stagingPreviewId,
        expectedReceipt: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'catalog:transaction-generation-mismatch',
      }),
    );
  });

  it('rejects a staging response that swaps the frozen candidate', async () => {
    const transaction = createManagedInstallTransaction({
      installer: {
        stage: async () => ({
          status: 'staged',
          profileGeneration: generation,
          candidate: { ...candidate, sourceId: 'other-source' },
          cacheDigests,
        }),
      },
      bootstrap: { prepare: vi.fn() },
      randomId: () => '66666666-6666-4666-8666-666666666666',
    });
    const preview = transaction.issue({
      generation,
      candidate,
      stagingPreviewId,
      expectedReceipt: null,
    });

    await expect(transaction.execute(preview.previewId)).rejects.toMatchObject({
      code: 'catalog:transaction-generation-mismatch',
    });
  });

  it('suppresses an exact external plugin before preparing its managed replacement', async () => {
    const prepareAdoption = vi.fn(async () => ({ enabled: false }));
    const recoverAdoption = vi.fn(async () => undefined);
    const prepare = vi.fn(async () => undefined);
    const transaction = createManagedInstallTransaction({
      installer: {
        stage: async () => ({
          status: 'staged', profileGeneration: generation, candidate, cacheDigests,
        }),
      },
      bootstrap: { prepare },
      externalAdoption: { prepareAdoption, recoverAdoption },
      randomId: () => '77777777-7777-4777-8777-777777777777',
    });
    const externalIdentity = {
      packageName: candidate.packageName,
      version: '1.2.2',
      entryId: 'community-example',
    };
    const preview = transaction.issue({
      generation,
      candidate,
      stagingPreviewId,
      expectedReceipt: null,
      expectedExternal: externalIdentity,
    });

    await transaction.execute(preview.previewId);

    expect(prepareAdoption).toHaveBeenCalledWith(externalIdentity, generation);
    expect(prepare).toHaveBeenCalledWith(generation, candidate, cacheDigests, null, false);
    expect(recoverAdoption).not.toHaveBeenCalled();
  });
});
