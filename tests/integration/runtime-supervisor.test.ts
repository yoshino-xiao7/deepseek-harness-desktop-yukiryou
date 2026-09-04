import { mkdtemp, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createRuntimeSupervisor,
  type RuntimeSupervisor,
} from '../../src/main/runtime/runtime-supervisor.js';

const fakeHarness = fileURLToPath(
  new URL('../fixtures/fake-harness/server.mjs', import.meta.url),
);
const idleChild = fileURLToPath(
  new URL('../fixtures/fake-harness/idle-child.mjs', import.meta.url),
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
      createCompanionToken: () => 'test-companion-token-that-never-enters-state',
      developmentPluginFixture: true,
    });

    const ready = await supervisor.start();

    expect(ready.kind).toBe('ready');
    expect(ready.version).toBe('fake-1.0.0');
    await expect(fetch(ready.origin)).resolves.toMatchObject({ status: 401 });
    const runtimeResponse = await ready.access.fetch(ready.origin).then((response) =>
      response.json() as Promise<Record<string, unknown>>
    );
    expect(runtimeResponse).toMatchObject({
        status: 'ready',
        home: runtimeHome,
        companionTokenConfigured: true,
        developmentPluginFixture: true,
      });
    expect(String(runtimeResponse.path).split(delimiter)[0]).toBe(
      runtimeBinDirectory,
    );
    await expect(realpath(String(runtimeResponse.workspace))).resolves.toBe(
      canonicalWorkspaceRoot,
    );
    const serializedState = JSON.stringify(supervisor.getState());
    expect(serializedState).not.toContain('test-companion-token');
    expect(serializedState).not.toContain('fake_runtime_launch_token');
    expect(serializedState).not.toContain('fake-browser-session');
    expect(serializedState).toContain('"access":{}');
    await expect(
      ready.access.fetch('https://example.com/'),
    ).rejects.toThrow('off-origin');

    await supervisor.stop('quit');
    expect(supervisor.getState()).toEqual({ kind: 'stopped' });
    await expect(ready.access.fetch(ready.origin)).rejects.toThrow(
      'no longer active',
    );
  });

  it('waits for the protected Companion route before reporting readiness', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-runtime-test-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-workspace-test-'));
    supervisor = createRuntimeSupervisor({
      command: process.execPath,
      args: [fakeHarness, '--companion-ready-delay-ms', '150'],
      runtimeHome,
      workspaceRoot,
      version: 'fake-1.0.0',
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 2_000,
      createCompanionToken: () =>
        'test-companion-token-that-never-enters-state',
    });

    const ready = await supervisor.start();
    const response = await ready.access.fetch(
      `${ready.origin}/plugins/@dsh-desktop/companion/rpc`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"kind":"account.balance"}',
      },
    );

    expect(response.status).toBe(403);
  });

  it('reconfigures a stopped Runtime without replacing its supervisor', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-runtime-test-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-workspace-test-'));
    supervisor = createRuntimeSupervisor({
      command: process.execPath,
      args: [fakeHarness, '--launch-marker', 'before'],
      runtimeHome,
      workspaceRoot,
      version: 'fake-1.0.0',
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 2_000,
    });

    const before = await supervisor.start();
    await expect(before.access.fetch(before.origin).then((response) => response.json()))
      .resolves.toMatchObject({ launchMarker: 'before' });
    expect(() => supervisor?.configureLaunch(
      process.execPath,
      [fakeHarness, '--launch-marker', 'invalid'],
    )).toThrow('while stopped');

    await supervisor.stop('restart');
    supervisor.configureLaunch(
      process.execPath,
      [fakeHarness, '--launch-marker', 'after'],
    );
    const after = await supervisor.start();
    await expect(after.access.fetch(after.origin).then((response) => response.json()))
      .resolves.toMatchObject({ launchMarker: 'after' });
  });

  it.each([
    {
      label: 'returns a forged proof',
      status: 200,
      body: JSON.stringify({ status: 'ready', proof: 'forged' }),
    },
    {
      label: 'only matches the legacy unauthenticated 403 probe',
      status: 403,
      body: '',
    },
  ])('rejects a fixed-port service that $label', async ({ status, body }) => {
    const impostor = createServer(async (request, response) => {
      for await (const chunk of request) void chunk;
      if (request.url === '/') {
        response.writeHead(200);
        response.end('{}');
        return;
      }
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
    await new Promise<void>((resolve, reject) => {
      impostor.once('error', reject);
      impostor.listen(0, '127.0.0.1', resolve);
    });
    const address = impostor.address();
    if (address === null || typeof address === 'string') {
      throw new Error('impostor did not bind a TCP port');
    }

    const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-runtime-test-'));
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-workspace-test-'));
    supervisor = createRuntimeSupervisor({
      command: process.execPath,
      args: [idleChild],
      runtimeHome,
      workspaceRoot,
      version: 'fake-1.0.0',
      startupTimeoutMs: 500,
      shutdownTimeoutMs: 1_000,
      port: address.port,
      createCompanionToken: () =>
        'fixed-port-ownership-secret-that-is-long-enough',
    });

    try {
      await expect(supervisor.start()).rejects.toThrow();
      expect(supervisor.getState()).toMatchObject({
        kind: 'failed',
        failure: { code: 'startup-timeout' },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        impostor.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    }
  });
});
