import { mkdir, mkdtemp, readFile, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPluginStartupRecovery, createSafeRuntimeCommand, identifyStartupPluginFailures } from './plugin-startup-recovery.js';

describe('persistent plugin startup recovery', () => {
  it('rebinds the safe module link after a portable upgrade without modifying its previous target', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-safe-move-'));
    const before = join(home, 'old-app');
    const after = join(home, 'new-app');
    await mkdir(join(before, 'dsh', 'node_modules'), { recursive: true });
    await mkdir(join(after, 'dsh', 'node_modules'), { recursive: true });
    const sentinel = join(before, 'dsh', 'node_modules', 'sentinel');
    await writeFile(sentinel, 'keep');
    await createSafeRuntimeCommand(home, before);
    await createSafeRuntimeCommand(home, after);
    expect(await readlink(join(home, 'plugin-management', 'safe-start', 'node_modules'))).toBe(join(after, 'dsh', 'node_modules'));
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
  });
  it('requires a loader entry and inventory identity rather than a package mention', () => {
    const plugin = { packageName: 'dsh-example', version: '1.0.0', entryIds: ['example'] };
    expect(identifyStartupPluginFailures(['plugin dsh-example failed'], [plugin])).toEqual([]);
    expect(identifyStartupPluginFailures(['failed to apply loader entry another (dsh-example): bad'], [plugin])).toEqual([]);
    expect(identifyStartupPluginFailures(['failed to import loader entry example (dsh-example): bad'], [plugin])).toEqual([plugin]);
  });
  it('shares a two-attempt budget across isolation and safe fallback', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-budget-'));
    const recovery = await createPluginStartupRecovery(home, '1.0.9');
    expect(await recovery.isolate([{ packageName: 'example', version: '1.0', entryIds: ['example'] }])).toBe(true);
    const relaunched = await createPluginStartupRecovery(home, '1.0.9');
    expect(await relaunched.isolate([{ packageName: 'other', version: '1.0', entryIds: ['other'] }])).toBe(false);
    expect(await relaunched.enterSafeMode('startup-timeout')).toBe(true);
    expect(relaunched.snapshot().attempts).toBe(2);
    expect(await relaunched.enterSafeMode('startup-timeout')).toBe(false);
  });

  it('preserves other quarantines when a single plugin retry fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-isolated-'));
    const recovery = await createPluginStartupRecovery(home, '1.0.9');
    const a = { packageName: 'a', version: '1', entryIds: ['a'] };
    const b = { packageName: 'b', version: '1', entryIds: ['b'] };
    await recovery.isolate([a, b]);
    await recovery.tryPlugin('a');
    await recovery.isolate([a]);
    expect(recovery.snapshot().isolated).toEqual([b, a]);
  });
  it('preserves corrupt recovery metadata and enters safe mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-corrupt-'));
    await createPluginStartupRecovery(home, '1.0.9');
    await writeFile(join(home, 'plugin-management', 'startup-recovery.json'), '{broken');
    expect((await createPluginStartupRecovery(home, '1.0.9')).snapshot().mode).toBe('safe');
  });
  it('counts transaction rollback before falling back to safe startup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-trial-budget-'));
    const recovery = await createPluginStartupRecovery(home, '1.0.9');
    expect(await recovery.reserveTrialRecovery()).toBe(true);
    expect(await recovery.isolate([{ packageName: 'a', version: '1', entryIds: ['a'] }])).toBe(false);
    expect(await recovery.enterSafeMode('exited-before-ready')).toBe(true);
    expect(recovery.snapshot().attempts).toBe(2);
  });
  it('does not repeat automatic safe starts across desktop relaunches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-startup-'));
    const recovery = await createPluginStartupRecovery(home, '1.0.9');
    await recovery.begin();
    expect(await recovery.enterSafeMode('startup-timeout')).toBe(true);
    await recovery.begin();
    const next = await createPluginStartupRecovery(home, '1.0.9');
    expect(next.snapshot().mode).toBe('safe');
    expect(await next.enterSafeMode('startup-timeout')).toBe(false);
    expect(next.snapshot().attempts).toBe(1);
  });
  it('keeps safe mode after success until the user explicitly trials normal startup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-startup-'));
    const recovery = await createPluginStartupRecovery(home, '1.0.9');
    await recovery.enterSafeMode('exited-before-ready');
    await recovery.healthy();
    expect((await createPluginStartupRecovery(home, '1.0.9')).snapshot().mode).toBe('safe');
    await recovery.tryNormal();
    expect(recovery.snapshot().mode).toBe('normal');
    expect(await recovery.enterSafeMode('exited-before-ready')).toBe(true);
    const persisted = await readFile(join(home, 'plugin-management', 'startup-recovery.json'), 'utf8');
    expect(persisted).not.toContain('message');
  });
});
