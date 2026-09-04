import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createRuntimeSupervisor } from '../../src/main/runtime/runtime-supervisor.js';

const fakeHarness = fileURLToPath(
  new URL('../fixtures/fake-harness/server.mjs', import.meta.url),
);
const durationMs = Number.parseInt(process.env.DSH_SOAK_DURATION_MS ?? '100', 10);

describe('RuntimeSupervisor soak', () => {
  it(
    `keeps its owned process healthy for ${String(durationMs)}ms`,
    async () => {
      const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-soak-home-'));
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-soak-workspace-'));
      const supervisor = createRuntimeSupervisor({
        command: process.execPath,
        args: [fakeHarness],
        runtimeHome,
        workspaceRoot,
        version: 'fake-soak',
        startupTimeoutMs: 5_000,
        shutdownTimeoutMs: 2_000,
      });

      try {
        const ready = await supervisor.start();
        const deadline = Date.now() + durationMs;
        do {
          await expect(ready.access.fetch(ready.origin)).resolves.toMatchObject({ ok: true });
          await delay(Math.min(1_000, Math.max(10, durationMs / 10)));
        } while (Date.now() < deadline);
      } finally {
        await supervisor.stop('quit');
      }
      expect(supervisor.getState()).toEqual({ kind: 'stopped' });
    },
    durationMs + 10_000,
  );
});

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
