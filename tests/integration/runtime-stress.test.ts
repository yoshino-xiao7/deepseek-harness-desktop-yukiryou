import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createRuntimeSupervisor } from '../../src/main/runtime/runtime-supervisor.js';

const fakeHarness = fileURLToPath(
  new URL('../fixtures/fake-harness/server.mjs', import.meta.url),
);
const cycles = Number.parseInt(process.env.DSH_STRESS_CYCLES ?? '1', 10);

describe('RuntimeSupervisor stress', () => {
  it(
    `starts and stops its owned process ${String(cycles)} times without a stale listener`,
    async () => {
      const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-stress-home-'));
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-stress-workspace-'));
      const supervisor = createRuntimeSupervisor({
        command: process.execPath,
        args: [fakeHarness],
        runtimeHome,
        workspaceRoot,
        version: 'fake-stress',
        startupTimeoutMs: 5_000,
        shutdownTimeoutMs: 2_000,
      });

      for (let cycle = 0; cycle < cycles; cycle += 1) {
        const ready = await supervisor.start();
        await expect(ready.access.fetch(ready.origin)).resolves.toMatchObject({ ok: true });
        await supervisor.stop('restart');
        expect(supervisor.getState()).toEqual({ kind: 'stopped' });
        await expect(ready.access.fetch(ready.origin)).rejects.toThrow();
      }
    },
    Math.max(10_000, cycles * 1_000),
  );
});
