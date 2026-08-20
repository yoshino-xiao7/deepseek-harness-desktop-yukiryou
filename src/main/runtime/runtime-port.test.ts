import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveStableRuntimePort } from './runtime-port.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('stable Runtime port', () => {
  it('allocates once and reuses the persisted loopback port', async () => {
    const userData = await createTemporaryDirectory();
    const allocatePort = vi.fn().mockResolvedValue(54_321);

    await expect(
      resolveStableRuntimePort(userData, {
        allocatePort,
        isPortAvailable: async () => true,
      }),
    ).resolves.toEqual({ port: 54_321, source: 'allocated' });
    await expect(
      resolveStableRuntimePort(userData, {
        allocatePort: () => Promise.reject(new Error('must not reallocate')),
        isPortAvailable: async () => true,
      }),
    ).resolves.toEqual({ port: 54_321, source: 'state' });
    expect(allocatePort).toHaveBeenCalledTimes(1);
    expect((await stat(join(userData, 'runtime-endpoint.json'))).mode & 0o777).toBe(
      0o600,
    );
  });

  it('migrates the most recent legacy ready origin from rotated app logs', async () => {
    const userData = await createTemporaryDirectory();
    const logs = join(userData, 'logs');
    await mkdir(logs);
    await writeFile(
      join(logs, 'desktop.log.1'),
      `${runtimeStateLine('http://127.0.0.1:51111')}\n`,
    );
    await writeFile(
      join(logs, 'desktop.log'),
      [
        '{not-json',
        runtimeStateLine('http://localhost:52222'),
        runtimeStateLine('http://127.0.0.1:53333'),
      ].join('\n'),
    );

    await expect(
      resolveStableRuntimePort(userData, {
        allocatePort: () => Promise.reject(new Error('legacy log must win')),
        isPortAvailable: async () => true,
      }),
    ).resolves.toEqual({ port: 53_333, source: 'legacy-log' });

    const state = JSON.parse(
      await readFile(join(userData, 'runtime-endpoint.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(state).toMatchObject({
      version: 1,
      host: '127.0.0.1',
      port: 53_333,
      selectedAt: '2026-08-21T00:00:00.000Z',
    });
  });

  it('adopts the physically latest legacy origin after rollback even if the clock moved backwards', async () => {
    const userData = await createTemporaryDirectory();
    await writeFile(
      join(userData, 'runtime-endpoint.json'),
      `${JSON.stringify({
        version: 1,
        host: '127.0.0.1',
        port: 54_321,
        selectedAt: '2026-08-21T00:00:00.000Z',
      })}\n`,
    );
    const logs = join(userData, 'logs');
    await mkdir(logs);
    await writeFile(
      join(logs, 'desktop.log'),
      `${runtimeStateLine('http://127.0.0.1:54444', '2026-08-20T00:00:00.000Z')}\n`,
    );

    await expect(resolveStableRuntimePort(userData, {
      isPortAvailable: async () => true,
    })).resolves.toEqual({
      port: 54_444,
      source: 'legacy-log',
    });
  });

  it('fails closed when a stable endpoint remains occupied', async () => {
    const userData = await createTemporaryDirectory();
    const availability = vi.fn().mockResolvedValue(false);
    await writeFile(
      join(userData, 'runtime-endpoint.json'),
      `${JSON.stringify({
        version: 1,
        host: '127.0.0.1',
        port: 54_321,
        selectedAt: '2026-08-21T00:00:00.000Z',
      })}\n`,
    );

    await expect(resolveStableRuntimePort(userData, {
      allocatePort: async () => 54_322,
      isPortAvailable: availability,
      portReleaseGraceMs: 0,
    })).rejects.toMatchObject({
      name: 'StableRuntimePortOccupiedError',
      code: 'ERUNTIMEPORTOCCUPIED',
      port: 54_321,
      source: 'state',
    });
    expect(availability).toHaveBeenCalledWith(54_321);

    const state = JSON.parse(
      await readFile(join(userData, 'runtime-endpoint.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(state.port).toBe(54_321);
  });

  it('does not replace an occupied legacy origin before an rc.8 upgrade', async () => {
    const userData = await createTemporaryDirectory();
    const logs = join(userData, 'logs');
    await mkdir(logs);
    await writeFile(
      join(logs, 'desktop.log'),
      `${runtimeStateLine('http://127.0.0.1:54555')}\n`,
    );

    await expect(resolveStableRuntimePort(userData, {
      allocatePort: async () => 54_556,
      isPortAvailable: async () => false,
      portReleaseGraceMs: 0,
    })).rejects.toMatchObject({
      name: 'StableRuntimePortOccupiedError',
      port: 54_555,
      source: 'legacy-log',
    });
    await expect(
      stat(join(userData, 'runtime-endpoint.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when an older logged Runtime remains alive after a newer one exited', async () => {
    const userData = await createTemporaryDirectory();
    const logs = join(userData, 'logs');
    await mkdir(logs);
    await writeFile(
      join(logs, 'desktop.log'),
      [
        runtimeStateLine('http://127.0.0.1:54555'),
        runtimeStateLine('http://127.0.0.1:54556'),
      ].join('\n'),
    );
    const availability = vi.fn(async (port: number) => port !== 54_555);

    await expect(resolveStableRuntimePort(userData, {
      allocatePort: async () => 54_557,
      isPortAvailable: availability,
      portReleaseGraceMs: 0,
    })).rejects.toMatchObject({
      name: 'StableRuntimePortOccupiedError',
      port: 54_555,
      source: 'legacy-log',
    });
    expect(availability).toHaveBeenCalledWith(54_555);
    expect(availability).toHaveBeenCalledWith(54_556);
    await expect(
      stat(join(userData, 'runtime-endpoint.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-runtime-port-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runtimeStateLine(
  origin: string,
  timestamp = '2026-08-21T00:00:00.000Z',
): string {
  return JSON.stringify({
    timestamp,
    event: 'runtime.state',
    details: JSON.stringify({ kind: 'ready', origin, version: '0.1.0-rc.7' }),
  });
}
