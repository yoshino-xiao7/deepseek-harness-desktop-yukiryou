import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createRuntimeSupervisor,
  type RuntimeSupervisor,
} from '../../src/main/runtime/runtime-supervisor.js';

const fakeHarness = fileURLToPath(
  new URL('../fixtures/fake-harness/server.mjs', import.meta.url),
);

describe('RuntimeSupervisor', () => {
  let supervisor: RuntimeSupervisor | undefined;

  afterEach(async () => {
    await supervisor?.stop('quit');
  });

  it('starts an owned runtime, waits for readiness, and stops it', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-runtime-test-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-workspace-test-'));
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const runtimeBinDirectory = join(runtimeHome, 'bundled-bin');
    supervisor = createRuntimeSupervisor({
      command: process.execPath,
      args: [fakeHarness],
      runtimeHome,
      runtimeBinDirectories: [runtimeBinDirectory],
      workspaceRoot,
      version: 'fake-1.0.0',
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 2_000,
    });

    const ready = await supervisor.start();

    expect(ready.kind).toBe('ready');
    expect(ready.version).toBe('fake-1.0.0');
    await expect(fetch(ready.origin).then((response) => response.json())).resolves
      .toMatchObject({
        status: 'ready',
        home: runtimeHome,
        path: expect.stringMatching(
          new RegExp(`^${runtimeBinDirectory.replaceAll('/', '\\/')}:`),
        ),
        workspace: canonicalWorkspaceRoot,
      });

    await supervisor.stop('quit');
    expect(supervisor.getState()).toEqual({ kind: 'stopped' });
    await expect(fetch(ready.origin)).rejects.toThrow();
  });
});
