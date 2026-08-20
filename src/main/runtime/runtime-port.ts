import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

const STATE_FILE_NAME = 'runtime-endpoint.json';
const STATE_VERSION = 1;
const LOOPBACK_HOST = '127.0.0.1';
const LOG_BACKUP_COUNT = 3;

export type StableRuntimePortResult = {
  readonly port: number;
  readonly source: 'state' | 'legacy-log' | 'allocated';
};

export class StableRuntimePortOccupiedError extends Error {
  readonly code = 'ERUNTIMEPORTOCCUPIED';
  readonly port: number;
  readonly source: 'state' | 'legacy-log';

  constructor(port: number, source: 'state' | 'legacy-log') {
    super(`Stable Runtime endpoint is still occupied (port=${String(port)} source=${source})`);
    this.name = 'StableRuntimePortOccupiedError';
    this.port = port;
    this.source = source;
  }
}

export interface StableRuntimePortOptions {
  readonly allocatePort?: () => Promise<number>;
  readonly isPortAvailable?: (port: number) => Promise<boolean>;
  readonly portReleaseGraceMs?: number;
}

type PersistedRuntimePortResult = {
  readonly port: number;
  readonly source: 'state' | 'legacy-log';
};

/**
 * Keep the Harness HTTP origin stable across app and Runtime restarts so its
 * origin-scoped localStorage can restore the last selected session. Existing
 * installs migrate to the final ready origin recorded by the previous app.
 */
export async function resolveStableRuntimePort(
  userData: string,
  options: StableRuntimePortOptions = {},
): Promise<StableRuntimePortResult> {
  const statePath = join(userData, STATE_FILE_NAME);
  const [stored, loggedReadyPorts] = await Promise.all([
    readStoredPort(statePath),
    readReadyPorts(join(userData, 'logs')),
  ]);
  const logged = loggedReadyPorts[loggedReadyPorts.length - 1];
  let selected: PersistedRuntimePortResult | undefined;
  if (
    stored !== undefined &&
    (logged === undefined || logged.port === stored.port)
  ) {
    selected = { port: stored.port, source: 'state' };
  } else if (logged !== undefined) {
    selected = { port: logged.port, source: 'legacy-log' };
  }

  if (selected !== undefined) {
    const portsToCheck = selected.source === 'legacy-log'
      ? [...new Set(loggedReadyPorts.map(({ port }) => port))]
      : [selected.port];
    const occupiedPort = await waitUntilPortsAvailable(
      portsToCheck,
      options.isPortAvailable ?? isLoopbackPortAvailable,
      options.portReleaseGraceMs ?? 1_500,
    );
    if (occupiedPort !== undefined) {
      // An older public build could leave a detached Runtime on any origin it
      // previously reported as ready. Looking only at the final origin would
      // allow that orphan and the upgraded Runtime to write one Home at once.
      throw new StableRuntimePortOccupiedError(occupiedPort, selected.source);
    }
    if (selected.source === 'legacy-log') {
      await writePortState(
        statePath,
        selected.port,
        logged?.observedAt ?? Date.now(),
      );
    }
    return selected;
  }

  const port = await (options.allocatePort ?? allocateLoopbackPort)();
  assertValidPort(port);
  await writePortState(statePath, port, Date.now());
  return {
    port,
    source: 'allocated',
  };
}

async function waitUntilPortsAvailable(
  ports: readonly number[],
  isAvailable: (port: number) => Promise<boolean>,
  graceMs: number,
): Promise<number | undefined> {
  let unavailable = await findUnavailablePorts(ports, isAvailable);
  if (unavailable.length === 0) return undefined;
  const deadline = Date.now() + Math.max(0, graceMs);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    unavailable = await findUnavailablePorts(unavailable, isAvailable);
    if (unavailable.length === 0) return undefined;
  }
  return unavailable[0];
}

async function findUnavailablePorts(
  ports: readonly number[],
  isAvailable: (port: number) => Promise<boolean>,
): Promise<number[]> {
  const unavailable: number[] = [];
  for (const port of ports) {
    if (!await isAvailable(port)) unavailable.push(port);
  }
  return unavailable;
}

async function readStoredPort(
  statePath: string,
): Promise<{ port: number; selectedAt: number } | undefined> {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8')) as unknown;
    if (value === null || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (
      record.version !== STATE_VERSION ||
      record.host !== LOOPBACK_HOST ||
      !isValidPort(record.port) ||
      typeof record.selectedAt !== 'string'
    ) {
      return undefined;
    }
    const selectedAt = Date.parse(record.selectedAt);
    return Number.isFinite(selectedAt)
      ? { port: record.port, selectedAt }
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function readReadyPorts(
  logDirectory: string,
): Promise<readonly { port: number; observedAt: number }[]> {
  const readyPorts: { port: number; observedAt: number }[] = [];
  // Rotation order and line order are the durable sequence here. Wall-clock
  // timestamps can move backwards after a rollback or system clock change,
  // so they are metadata only and must not decide which origin was last used.
  for (let index = LOG_BACKUP_COUNT; index >= 0; index -= 1) {
    const path = join(
      logDirectory,
      index === 0 ? 'desktop.log' : `desktop.log.${String(index)}`,
    );
    let contents: string;
    try {
      contents = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const line of contents.split('\n')) {
      const candidate = readyPortFromLogLine(line);
      if (candidate !== undefined) readyPorts.push(candidate);
    }
  }
  return readyPorts;
}

function readyPortFromLogLine(
  line: string,
): { port: number; observedAt: number } | undefined {
  if (line.trim() === '') return undefined;
  try {
    const record = JSON.parse(line) as unknown;
    if (record === null || typeof record !== 'object') return undefined;
    const { event, details, timestamp } = record as Record<string, unknown>;
    if (
      event !== 'runtime.state' ||
      typeof details !== 'string' ||
      typeof timestamp !== 'string'
    ) {
      return undefined;
    }
    const observedAt = Date.parse(timestamp);
    if (!Number.isFinite(observedAt)) return undefined;
    const state = JSON.parse(details) as unknown;
    if (state === null || typeof state !== 'object') return undefined;
    const stateRecord = state as Record<string, unknown>;
    if (stateRecord.kind !== 'ready' || typeof stateRecord.origin !== 'string') {
      return undefined;
    }
    const port = portFromLoopbackOrigin(stateRecord.origin);
    return port === undefined ? undefined : { port, observedAt };
  } catch {
    return undefined;
  }
}

function portFromLoopbackOrigin(origin: string): number | undefined {
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== LOOPBACK_HOST ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined;
    }
    const port = Number(url.port);
    return isValidPort(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

async function writePortState(
  statePath: string,
  port: number,
  selectedAt: number,
): Promise<void> {
  const temporaryPath = `${statePath}.${String(process.pid)}.tmp`;
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({
        version: STATE_VERSION,
        host: LOOPBACK_HOST,
        port,
        selectedAt: new Date(selectedAt).toISOString(),
      }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a stable loopback port'));
        return;
      }
      server.close((error) => {
        if (error !== undefined) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, LOOPBACK_HOST, () => {
      server.close((error) => {
        if (error !== undefined) reject(error);
        else resolve(true);
      });
    });
  });
}

function assertValidPort(port: number): void {
  if (!isValidPort(port)) {
    throw new Error(`Invalid stable Runtime port: ${String(port)}`);
  }
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1_024 && Number(value) <= 65_535;
}
