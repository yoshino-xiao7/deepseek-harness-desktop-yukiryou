import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createPluginProfileBootstrap,
  createPluginProfileGeneration,
} from './plugin-profile-bootstrap.js';

const candidate = {
  packageName: '@example/dsh-tool',
  version: '1.2.3',
  integrity: 'sha512-example',
  sourceId: 'npmjs',
  bundlePath: 'cordis.patch.yml',
  graphHash: `sha256:${'a'.repeat(64)}`,
  lockHash: `sha256:${'b'.repeat(64)}`,
};

describe('PluginProfileBootstrap', () => {
  it('starts fail-closed without creating profile state', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const bootstrap = createPluginProfileBootstrap(runtimeHome);

    await expect(bootstrap.inspect()).resolves.toEqual({
      currentGeneration: null,
      pendingGeneration: null,
      receiptCount: 0,
      blocklistCount: 0,
      mutationReady: true,
    });
  });

  it('prepares and commits an exact opaque generation', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });
    await installCandidateBundle(runtimeHome);

    const cacheDigests = [`sha512:${'d'.repeat(128)}`];
    await bootstrap.prepare(generation, candidate, cacheDigests);
    await expect(bootstrap.inspect()).resolves.toMatchObject({ pendingGeneration: generation });
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(generation);
    await expect(bootstrap.inspect()).resolves.toMatchObject({
      currentGeneration: generation,
      pendingGeneration: null,
      receiptCount: 1,
    });
    await expect(bootstrap.inventory()).resolves.toEqual({
      currentGeneration: generation,
      entries: [{
        packageName: candidate.packageName,
        version: candidate.version,
        generation,
        installedAt: '2026-08-21T12:41:40.475Z',
        enabled: true,
        rollbackTarget: null,
        lastBlockedAttempt: null,
      }],
    });
    const receipts = JSON.parse(await readFile(
      join(runtimeHome, 'plugin-management', 'receipts.json'),
      'utf8',
    )) as { receipts: Array<{ cacheDigests: string[] }> };
    expect(receipts.receipts[0]?.cacheDigests).toEqual(cacheDigests);
  });

  it('refuses to commit before the candidate has completed a trial launch', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(generation, candidate);

    await expect(bootstrap.commit(generation)).rejects.toThrow(
      'was not trial-launched',
    );
  });

  it('rejects a generation that does not bind the supplied graph and lock', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    const mismatched = createPluginProfileGeneration({
      ...candidate,
      lockHash: `sha256:${'c'.repeat(64)}`,
    });

    await expect(bootstrap.prepare(mismatched, candidate)).rejects.toThrow(
      'does not match its verified candidate',
    );
  });

  it('recovers an interrupted prepare before Runtime and blocklists its candidate', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });

    await bootstrap.prepare(generation, candidate);
    await expect(bootstrap.recover(generation, 'startup-interrupted')).resolves
      .toBeUndefined();
    await expect(bootstrap.inspect()).resolves.toMatchObject({
      pendingGeneration: null,
      blocklistCount: 1,
    });
    const blocklist = JSON.parse(await readFile(
      join(runtimeHome, 'plugin-management', 'blocklist.json'),
      'utf8',
    )) as { entries: Array<Record<string, unknown>> };
    expect(blocklist.entries).toEqual([
      expect.objectContaining({
        packageName: candidate.packageName,
        generation,
        reason: 'startup-interrupted',
        blockedAt: '2026-08-21T12:41:40.475Z',
      }),
    ]);
  });

  it('refuses recovery after an unknown receipt edit', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(generation, candidate);
    await writeFile(
      join(runtimeHome, 'plugin-management', 'receipts.json'),
      '{"schemaVersion":1,"receipts":[{"unexpected":true}]}\n',
    );

    await expect(bootstrap.recover(generation, 'startup-interrupted')).rejects.toThrow(
      'Invalid plugin profile state',
    );
  });

  it('recovers if commit was interrupted after publishing its known receipt', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });
    await installCandidateBundle(runtimeHome);
    await bootstrap.prepare(generation, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await writeFile(
      join(runtimeHome, 'plugin-management', 'receipts.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        receipts: [{
          ...candidate,
          generation,
          installedAt: '2026-08-21T12:41:40.475Z',
        }],
      })}\n`,
    );

    await expect(bootstrap.recover(generation, 'startup-interrupted')).resolves
      .toBeUndefined();
    await expect(bootstrap.inspect()).resolves.toMatchObject({
      receiptCount: 0,
      blocklistCount: 1,
    });
  });

  it('rejects symlinked durable state', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const outside = join(runtimeHome, 'outside.json');
    const management = join(runtimeHome, 'plugin-management');
    await writeFile(outside, '{"schemaVersion":1,"receipts":[]}');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(management));
    await symlink(outside, join(management, 'receipts.json'));

    await expect(createPluginProfileBootstrap(runtimeHome).inspect()).rejects.toThrow(
      'regular file',
    );
  });

  it('derives stable generations from the verified graph and lock', () => {
    const input = candidate;
    expect(createPluginProfileGeneration(input)).toBe(createPluginProfileGeneration(input));
    expect(createPluginProfileGeneration({ ...input, lockHash: `sha256:${'c'.repeat(64)}` }))
      .not.toBe(createPluginProfileGeneration(input));
  });

  it('returns only committed, non-blocklisted bundle patches for Runtime launch', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });
    await bootstrap.prepare(generation, candidate);
    const installedPatch = await realpath(join(
      runtimeHome,
      'user-plugins',
      'generations',
      generation,
      'node_modules',
      '@example',
      'dsh-tool',
      'cordis.patch.yml',
    ));
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: null,
      patchPaths: [installedPatch],
      recoveredGeneration: null,
      trialGeneration: generation,
    });
    await expect(realpath(join(
      runtimeHome,
      'profiles',
      'node_modules',
      '@example',
      'dsh-tool',
    ))).resolves.toBe(await realpath(join(
      runtimeHome,
      'user-plugins',
      'generations',
      generation,
      'node_modules',
      '@example',
      'dsh-tool',
    )));
    await bootstrap.commit(generation);
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: generation,
      patchPaths: [installedPatch],
      recoveredGeneration: null,
      trialGeneration: null,
    });
  });

  it('refuses to replace a profile package outside plugin management', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    await installCandidateBundle(runtimeHome);
    const conflicting = join(
      runtimeHome,
      'profiles',
      'node_modules',
      '@example',
      'dsh-tool',
    );
    await mkdir(conflicting, { recursive: true });
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(generation, candidate);

    await expect(bootstrap.prepareRuntimeLaunch()).rejects.toThrow(
      'profile target is not a symbolic link',
    );
  });

  it('fails closed when a receipt bundle escapes the managed profile', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    const generation = generationForCandidate(candidate);
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });
    await bootstrap.prepare(generation, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(generation);
    const bundle = join(
      runtimeHome,
      'user-plugins',
      'generations',
      generation,
      'node_modules',
      '@example',
      'dsh-tool',
      'cordis.patch.yml',
    );
    const outside = join(runtimeHome, 'outside.patch.yml');
    await writeFile(outside, '[]\n');
    await import('node:fs/promises').then(({ rm }) => rm(bundle));
    await symlink(outside, bundle);

    await expect(bootstrap.prepareRuntimeLaunch()).rejects.toThrow('escapes its profile');
  });

  it('restores the committed package after its replacement generation is recovered', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });
    const installedGeneration = generationForCandidate(candidate);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const replacement = {
      ...candidate,
      version: '1.2.4',
      graphHash: hashFor('failed-update-graph'),
      lockHash: hashFor('failed-update-lock'),
    };
    const failedGeneration = createPluginProfileGeneration(replacement);
    await bootstrap.prepare(failedGeneration, replacement);
    await bootstrap.recover(failedGeneration, 'runtime-unhealthy');

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: installedGeneration,
      patchPaths: [expect.stringContaining(installedGeneration)],
      recoveredGeneration: null,
      trialGeneration: null,
    });
    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{ version: candidate.version, generation: installedGeneration }],
    });
  });

  it('updates an exact managed receipt and commits the replacement generation', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);

    const replacement = {
      ...candidate,
      version: '1.2.4',
      graphHash: hashFor('replacement-graph'),
      lockHash: hashFor('replacement-lock'),
    };
    const replacementGeneration = generationForCandidate(replacement);
    await installCandidateBundle(runtimeHome, replacement);
    await bootstrap.prepare(replacementGeneration, replacement, [], {
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      trialGeneration: replacementGeneration,
      patchPaths: [expect.stringContaining(replacementGeneration)],
    });
    await bootstrap.commit(replacementGeneration);

    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{
        version: replacement.version,
        generation: replacementGeneration,
        rollbackTarget: {
          version: candidate.version,
          generation: installedGeneration,
        },
      }],
    });
  });

  it('rolls back to the previous verified generation only after a healthy trial', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const replacement = {
      ...candidate,
      version: '1.2.4',
      graphHash: hashFor('rollback-graph'),
      lockHash: hashFor('rollback-lock'),
    };
    const replacementGeneration = generationForCandidate(replacement);
    await installCandidateBundle(runtimeHome, replacement);
    await bootstrap.prepare(replacementGeneration, replacement, [], {
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
    });
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(replacementGeneration);

    const rollback = await bootstrap.prepareRollback({
      packageName: candidate.packageName,
      version: replacement.version,
      generation: replacementGeneration,
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      trialGeneration: rollback.generation,
      patchPaths: [expect.stringContaining(installedGeneration)],
    });
    await bootstrap.commit(rollback.generation);

    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{
        version: candidate.version,
        generation: installedGeneration,
        rollbackTarget: null,
      }],
    });
  });

  it('restores the current version when a rollback trial is interrupted', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const replacement = {
      ...candidate,
      version: '1.2.4',
      graphHash: hashFor('rollback-recover-graph'),
      lockHash: hashFor('rollback-recover-lock'),
    };
    const replacementGeneration = generationForCandidate(replacement);
    await installCandidateBundle(runtimeHome, replacement);
    await bootstrap.prepare(replacementGeneration, replacement, [], {
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
    });
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(replacementGeneration);
    const rollback = await bootstrap.prepareRollback({
      packageName: candidate.packageName,
      version: replacement.version,
      generation: replacementGeneration,
    });
    await bootstrap.prepareRuntimeLaunch();

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      recoveredGeneration: rollback.generation,
      trialGeneration: null,
      patchPaths: [expect.stringContaining(replacementGeneration)],
    });
    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{ version: replacement.version, generation: replacementGeneration }],
    });
  });

  it('rejects an update preview after its expected receipt changes', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const replacement = {
      ...candidate,
      version: '1.2.4',
      graphHash: hashFor('stale-preview-graph'),
      lockHash: hashFor('stale-preview-lock'),
    };

    await expect(
      bootstrap.prepare(generationForCandidate(replacement), replacement, [], {
        packageName: candidate.packageName,
        version: '1.2.2',
        generation: installedGeneration,
      }),
    ).rejects.toThrow('receipt no longer matches');
  });

  it('allows one pending trial and recovers it before a second Runtime launch', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-21T12:41:40.475Z'),
    });
    await bootstrap.prepare(generation, candidate);

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      recoveredGeneration: null,
      trialGeneration: generation,
      patchPaths: [expect.stringContaining('cordis.patch.yml')],
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: null,
      recoveredGeneration: generation,
      trialGeneration: null,
      patchPaths: [],
    });
    await expect(bootstrap.inspect()).resolves.toMatchObject({
      pendingGeneration: null,
      blocklistCount: 1,
    });
  });

  it('allows an explicitly prepared install to retry a blocklisted package', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-22T02:00:00.000Z'),
    });
    await bootstrap.prepare(generation, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.recover(generation, 'runtime-unhealthy');
    await expect(bootstrap.inspect()).resolves.toMatchObject({ blocklistCount: 1 });

    await bootstrap.prepare(generation, candidate);

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      patchPaths: [expect.stringContaining('cordis.patch.yml')],
      trialGeneration: generation,
    });
    await bootstrap.recover(generation, 'runtime-unhealthy');
    await expect(bootstrap.inspect()).resolves.toMatchObject({ blocklistCount: 1 });
  });

  it('removes a receipt only after a healthy removal trial is committed', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-22T01:00:00.000Z'),
    });
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);

    const removal = await bootstrap.prepareRemoval({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
    });
    expect(removal.generation).toMatch(/^gen-[a-f0-9]{64}$/u);
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: installedGeneration,
      patchPaths: [],
      recoveredGeneration: null,
      trialGeneration: removal.generation,
    });
    await expect(realpath(join(
      runtimeHome, 'profiles', 'node_modules', '@example', 'dsh-tool',
    ))).rejects.toMatchObject({ code: 'ENOENT' });
    await bootstrap.commit(removal.generation);

    await expect(bootstrap.inventory()).resolves.toEqual({
      currentGeneration: removal.generation,
      entries: [],
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: removal.generation,
      patchPaths: [],
      recoveredGeneration: null,
      trialGeneration: null,
    });
  });

  it('restores a removed package when its trial does not complete', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-22T01:00:00.000Z'),
    });
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const removal = await bootstrap.prepareRemoval({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
    });
    await bootstrap.prepareRuntimeLaunch();

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toEqual({
      currentGeneration: installedGeneration,
      patchPaths: [expect.stringContaining('cordis.patch.yml')],
      recoveredGeneration: removal.generation,
      trialGeneration: null,
    });
    await expect(realpath(join(
      runtimeHome, 'profiles', 'node_modules', '@example', 'dsh-tool',
    ))).resolves.toContain(join(
      'generations', installedGeneration, 'node_modules', '@example', 'dsh-tool',
    ));
    await expect(bootstrap.inventory()).resolves.toMatchObject({
      currentGeneration: installedGeneration,
      entries: [{ packageName: candidate.packageName }],
    });
  });

  it('fails closed when a removal request no longer matches the exact receipt', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);

    await expect(bootstrap.prepareRemoval({
      packageName: candidate.packageName,
      version: '9.9.9',
      generation: installedGeneration,
    })).rejects.toThrow('receipt no longer matches');
  });

  it('refuses removal commit after receipt state drifts during the trial', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const removal = await bootstrap.prepareRemoval({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
    });
    await bootstrap.prepareRuntimeLaunch();
    await writeFile(
      join(runtimeHome, 'plugin-management', 'receipts.json'),
      '{"schemaVersion":1,"receipts":[]}\n',
    );

    await expect(bootstrap.commit(removal.generation)).rejects.toThrow(
      'state changed before commit',
    );
  });

  it('disables and re-enables a managed receipt through healthy trial launches', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome, {
      now: () => new Date('2026-08-22T02:00:00.000Z'),
    });
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);

    const disabled = await bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
      enabled: false,
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      patchPaths: [], trialGeneration: disabled.generation,
    });
    await bootstrap.commit(disabled.generation);
    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{ packageName: candidate.packageName, enabled: false }],
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({ patchPaths: [] });

    const enabled = await bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
      enabled: true,
    });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      patchPaths: [expect.stringContaining('cordis.patch.yml')],
      trialGeneration: enabled.generation,
    });
    await bootstrap.commit(enabled.generation);
    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{ packageName: candidate.packageName, enabled: true }],
    });
  });

  it('restores the previous enabled state when an activation trial is interrupted', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const disabled = await bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
      enabled: false,
    });
    await bootstrap.prepareRuntimeLaunch();

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      recoveredGeneration: disabled.generation,
      patchPaths: [expect.stringContaining('cordis.patch.yml')],
    });
    await expect(bootstrap.inventory()).resolves.toMatchObject({
      entries: [{ enabled: true }],
    });
    await expect(bootstrap.inspect()).resolves.toMatchObject({ blocklistCount: 0 });
  });

  it('clears a prior package blocklist only after an explicit enable trial succeeds', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);
    const replacement = {
      ...candidate,
      version: '1.2.4',
      graphHash: hashFor('blocked-replacement-graph'),
      lockHash: hashFor('blocked-replacement-lock'),
    };
    const failedGeneration = createPluginProfileGeneration(replacement);
    await bootstrap.prepare(failedGeneration, replacement);
    await bootstrap.recover(failedGeneration, 'runtime-unhealthy');

    const disabled = await bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
      enabled: false,
    });
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(disabled.generation);
    await expect(bootstrap.inspect()).resolves.toMatchObject({ blocklistCount: 1 });

    const enabled = await bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
      enabled: true,
    });
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(enabled.generation);

    await expect(bootstrap.inspect()).resolves.toMatchObject({ blocklistCount: 0 });
    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      patchPaths: [expect.stringContaining('cordis.patch.yml')],
    });
  });

  it('rejects redundant and stale managed enabled mutations', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const installedGeneration = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(installedGeneration, candidate);
    await bootstrap.prepareRuntimeLaunch();
    await bootstrap.commit(installedGeneration);

    await expect(bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: candidate.version,
      generation: installedGeneration,
      enabled: true,
    })).rejects.toThrow('already matches');
    await expect(bootstrap.prepareEnabled({
      packageName: candidate.packageName,
      version: '9.9.9',
      generation: installedGeneration,
      enabled: false,
    })).rejects.toThrow('receipt no longer matches');
  });

  it('treats a pre-trial schema-v1 pending record as prepared', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'plugin-profile-'));
    await installCandidateBundle(runtimeHome);
    const generation = generationForCandidate(candidate);
    const bootstrap = createPluginProfileBootstrap(runtimeHome);
    await bootstrap.prepare(generation, candidate);
    const statePath = join(runtimeHome, 'plugin-management', 'load-state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      pending: Record<string, unknown>;
    };
    delete state.pending.phase;
    delete state.pending.trialStartedAt;
    await writeFile(statePath, `${JSON.stringify(state)}\n`);

    await expect(bootstrap.prepareRuntimeLaunch()).resolves.toMatchObject({
      trialGeneration: generation,
    });
  });
});

function generationForCandidate(value: typeof candidate): string {
  return createPluginProfileGeneration(value);
}

function hashFor(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`;
}

async function installCandidateBundle(
  runtimeHome: string,
  value: typeof candidate = candidate,
): Promise<void> {
  const generation = generationForCandidate(value);
  const directory = join(
    runtimeHome,
    'user-plugins',
    'generations',
    generation,
    'node_modules',
    '@example',
    'dsh-tool',
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n');
}
