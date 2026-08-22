import { describe, expect, it, vi } from 'vitest';

interface ManagedPreviewVault {
  issue(identity: Record<string, unknown>): Promise<Record<string, unknown>>;
  stage(previewId: string): Promise<Record<string, unknown>>;
}

async function createVault(options: Record<string, unknown>): Promise<ManagedPreviewVault> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/managed-preview-vault.js', import.meta.url).href
  ) as { createManagedPreviewVault(value: Record<string, unknown>): ManagedPreviewVault };
  return module.createManagedPreviewVault(options);
}

const generation = `gen-${'a'.repeat(64)}`;
const candidate = {
  packageName: '@community/example', version: '1.2.3', integrity: 'sha512-example',
  sourceId: 'dshfind', bundlePath: 'cordis.patch.yml',
  graphHash: `sha256:${'b'.repeat(64)}`, lockHash: `sha256:${'c'.repeat(64)}`,
};
const plan = { schemaVersion: 1, root: '@community/example@1.2.3' };

function inspector(installation: unknown = { generation, candidate, plan }) {
  return {
    inspectVerified: vi.fn(async () => ({
      value: { status: installation == null ? 'blocked' : 'artifact-verified', executionReady: false },
      installation,
    })),
  };
}

describe('desktop market managed preview vault', () => {
  it('keeps the frozen plan private until one-shot staging', async () => {
    const stage = vi.fn(async () => ({ status: 'staged', path: '/managed/generation' }));
    const release = vi.fn();
    const hold = vi.fn(() => release);
    const digest = `sha512:${'d'.repeat(128)}`;
    const planWithArtifacts = { ...plan, artifacts: [{ digest }] };
    const vault = await createVault({
      inspector: inspector({
        generation, candidate, plan: planWithArtifacts,
      }),
      installer: { stage }, artifactCache: { hold },
      randomId: () => '11111111-1111-4111-8111-111111111111',
    });

    const preview = await vault.issue({ sourceRecordId: 'dshfind', itemId: 'example' });
    expect(preview).toMatchObject({
      previewId: 'preview-11111111-1111-4111-8111-111111111111',
      profileGeneration: generation,
      expiresInSeconds: 300,
      candidate,
      inspection: { status: 'artifact-verified', executionReady: false },
    });
    expect(preview).not.toHaveProperty('plan');
    await expect(vault.stage(preview.previewId as string)).resolves.toMatchObject({
      status: 'staged', profileGeneration: generation, candidate, cacheDigests: [digest],
    });
    expect(hold).toHaveBeenCalledWith([digest]);
    expect(release).toHaveBeenCalledOnce();
    expect(stage).toHaveBeenCalledWith({ generation, plan: planWithArtifacts });
    await expect(vault.stage(preview.previewId as string)).rejects
      .toMatchObject({ code: 'catalog:vault-preview-unavailable' });
  });

  it('expires previews and blocks unverified inspections without staging', async () => {
    let timestamp = 1_000;
    const stage = vi.fn();
    const vault = await createVault({
      inspector: inspector(), installer: { stage }, now: () => timestamp, ttlMs: 1_000,
      randomId: () => '22222222-2222-4222-8222-222222222222',
    });
    const preview = await vault.issue({ sourceRecordId: 'dshfind', itemId: 'example' });
    timestamp += 1_000;
    await expect(vault.stage(preview.previewId as string)).rejects
      .toMatchObject({ code: 'catalog:vault-preview-unavailable' });
    expect(stage).not.toHaveBeenCalled();

    const blocked = await createVault({ inspector: inspector(null), installer: { stage } });
    await expect(blocked.issue({ sourceRecordId: 'dshfind', itemId: 'blocked' })).rejects
      .toMatchObject({ code: 'catalog:vault-not-installable' });
  });

  it('rejects concurrent staging without consuming the waiting preview', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let stageCount = 0;
    const vault = await createVault({
      inspector: inspector(),
      installer: { stage: async () => {
        stageCount += 1;
        if (stageCount === 1) await waiting;
        return { status: 'staged', path: '/managed/generation' };
      } },
      randomId: (() => {
        const ids = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
        return () => ids.shift() ?? '';
      })(),
    });
    const first = await vault.issue({ sourceRecordId: 'dshfind', itemId: 'one' });
    const running = vault.stage(first.previewId as string);
    const second = await vault.issue({ sourceRecordId: 'dshfind', itemId: 'two' });
    await expect(vault.stage(second.previewId as string)).rejects
      .toMatchObject({ code: 'catalog:vault-busy' });
    release?.();
    await running;
    await expect(vault.stage(second.previewId as string)).resolves.toMatchObject({ status: 'staged' });
  });

  it('automatically releases cache leases when a preview times out', async () => {
    const digest = `sha512:${'e'.repeat(128)}`;
    const release = vi.fn();
    let expire: (() => void) | undefined;
    const vault = await createVault({
      inspector: inspector({
        generation, candidate, plan: { ...plan, artifacts: [{ digest }] },
      }),
      installer: { stage: vi.fn() },
      artifactCache: { hold: () => release },
      ttlMs: 1_000,
      schedule: (callback: () => void) => { expire = callback; return 42; },
      cancel: vi.fn(),
      randomId: () => '55555555-5555-4555-8555-555555555555',
    });
    const preview = await vault.issue({ sourceRecordId: 'dshfind', itemId: 'example' });
    expire?.();

    expect(release).toHaveBeenCalledOnce();
    await expect(vault.stage(preview.previewId as string)).rejects
      .toMatchObject({ code: 'catalog:vault-preview-unavailable' });
  });
});
