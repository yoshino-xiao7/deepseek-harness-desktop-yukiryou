import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import { delimiter, win32 } from 'node:path';

export type RuntimeFailureCode =
  | 'spawn-failed'
  | 'exited-before-ready'
  | 'unexpected-exit'
  | 'startup-timeout'
  | 'renderer-crashed'
  | 'runtime-endpoint-occupied'
  | 'upgrade-preparation-failed';

export interface RuntimeFailure {
  readonly code: RuntimeFailureCode;
  readonly message: string;
  readonly exitCode?: number | null;
}

export type RuntimeState =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting'; readonly attempt: number }
  | {
      readonly kind: 'ready';
      readonly origin: string;
      readonly version: string;
    }
  | { readonly kind: 'failed'; readonly failure: RuntimeFailure };

export interface RuntimeSupervisor {
  start(): Promise<Extract<RuntimeState, { kind: 'ready' }>>;
  stop(reason: 'quit' | 'restart' | 'update'): Promise<void>;
  configureLaunch(command: string, args: readonly string[]): void;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  getState(): RuntimeState;
}

export interface RuntimeSupervisorOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly runtimeHome: string;
  readonly runtimeBinDirectories?: readonly string[];
  readonly workspaceRoot: string;
  readonly version: string;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly port?: number;
  readonly developmentPluginFixture?: boolean;
  readonly distributionRegion?: 'china' | 'global';
  readonly createCompanionToken?: () => string;
  readonly onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

const COMPANION_RPC_ROUTE = '/plugins/@dsh-desktop/companion/rpc';

class OwnedRuntimeSupervisor implements RuntimeSupervisor {
  readonly #options: RuntimeSupervisorOptions;
  #command: string;
  #args: readonly string[];
  readonly #listeners = new Set<(state: RuntimeState) => void>();
  #state: RuntimeState = { kind: 'stopped' };
  #child: ChildProcess | undefined;
  #startPromise:
    | Promise<Extract<RuntimeState, { kind: 'ready' }>>
    | undefined;
  #stopping = false;

  constructor(options: RuntimeSupervisorOptions) {
    this.#options = options;
    this.#command = options.command;
    this.#args = options.args;
  }

  getState(): RuntimeState {
    return this.#state;
  }

  subscribe(listener: (state: RuntimeState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  configureLaunch(command: string, args: readonly string[]): void {
    if (this.#state.kind !== 'stopped' || this.#child !== undefined || this.#startPromise !== undefined) {
      throw new Error('Runtime launch can only be configured while stopped');
    }
    this.#command = command;
    this.#args = Object.freeze([...args]);
  }

  start(): Promise<Extract<RuntimeState, { kind: 'ready' }>> {
    if (this.#state.kind === 'ready') {
      return Promise.resolve(this.#state);
    }
    if (this.#startPromise !== undefined) {
      return this.#startPromise;
    }

    this.#startPromise = this.#startOwnedRuntime().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async stop(reason: 'quit' | 'restart' | 'update'): Promise<void> {
    this.#stopping = true;
    try {
      const child = this.#child;
      if (child === undefined) {
        this.#setState({ kind: 'stopped' });
        return;
      }

      await this.#terminateOwnedProcess(child, reason);
      this.#setState({ kind: 'stopped' });
    } finally {
      this.#stopping = false;
    }
  }

  async #startOwnedRuntime(): Promise<
    Extract<RuntimeState, { kind: 'ready' }>
  > {
    this.#stopping = false;
    this.#setState({ kind: 'starting', attempt: 1 });
    const port = this.#options.port ?? await allocateLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const companionToken = this.#options.createCompanionToken?.();

    const child = spawn(
      this.#command,
      [
        ...this.#args,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        cwd: this.#options.workspaceRoot,
        detached: process.platform !== 'win32',
        env: buildRuntimeEnvironment(
          this.#options.runtimeHome,
          this.#options.runtimeBinDirectories ?? [],
          companionToken,
          this.#options.developmentPluginFixture === true,
          this.#options.distributionRegion,
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    this.#child = child;
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) =>
      this.#options.onOutput?.('stdout', chunk),
    );
    child.stderr?.on('data', (chunk: string) =>
      this.#options.onOutput?.('stderr', chunk),
    );
    child.once('exit', (code) => {
      if (this.#child === child) {
        this.#child = undefined;
      }
      if (!this.#stopping && this.#state.kind === 'ready') {
        this.#setState({
          kind: 'failed',
          failure: {
            code: 'unexpected-exit',
            message: `Harness runtime exited unexpectedly with code ${String(code)}`,
            exitCode: code,
          },
        });
      }
    });

    const failure = await waitUntilReady(
      child,
      origin,
      this.#options.startupTimeoutMs,
      () => spawnError,
      companionToken,
    );
    if (failure !== undefined) {
      this.#setState({ kind: 'failed', failure });
      await this.#terminateOwnedProcess(child);
      throw new Error(failure.message);
    }

    const ready: Extract<RuntimeState, { kind: 'ready' }> = {
      kind: 'ready',
      origin,
      version: this.#options.version,
    };
    this.#setState(ready);
    return ready;
  }

  #signalOwnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined || child.exitCode !== null) {
      return;
    }
    try {
      if (process.platform === 'win32') {
        child.kill(signal);
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error;
      }
    }
  }

  async #terminateOwnedProcess(
    child: ChildProcess,
    reason?: 'quit' | 'restart' | 'update',
  ): Promise<void> {
    if (process.platform === 'win32') {
      const result = terminateWindowsProcessTree(child);
      if (!result.started && child.exitCode === null) {
        throw new Error(
          `Could not terminate Windows Runtime process tree during ${reason ?? 'startup cleanup'}: ` +
          result.detail,
        );
      }
      const exited = await waitForExit(child, this.#options.shutdownTimeoutMs);
      if (!exited) {
        throw new Error(
          `Windows Runtime root process ${String(child.pid)} remained after taskkill`,
        );
      }
      if (this.#child === child) this.#child = undefined;
      return;
    }
    this.#signalOwnedProcess(child, 'SIGTERM');
    const exited = await waitForExit(child, this.#options.shutdownTimeoutMs);
    if (!exited) {
      this.#signalOwnedProcess(child, 'SIGKILL');
      await waitForExit(child, this.#options.shutdownTimeoutMs);
    }
    if (this.#child === child) this.#child = undefined;
  }

  #setState(state: RuntimeState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

export interface WindowsProcessTreeTerminationResult {
  readonly started: boolean;
  readonly detail: string;
}

export interface WindowsProcessTreeTerminationOptions {
  readonly platform?: NodeJS.Platform;
  readonly systemRoot?: string;
  readonly runTaskkill?: (
    executable: string,
    args: readonly string[],
  ) => { readonly error?: Error; readonly status: number | null };
}

/**
 * Terminate a Windows-owned Runtime tree while its root PID still identifies
 * every descendant. Killing the root first would orphan cmd/conhost/provider
 * children and can leave installed Runtime files locked during an update.
 */
export function terminateWindowsProcessTree(
  child: ChildProcess,
  options: WindowsProcessTreeTerminationOptions = {},
): WindowsProcessTreeTerminationResult {
  if ((options.platform ?? process.platform) !== 'win32') {
    return { started: false, detail: 'not-windows' };
  }
  if (child.pid === undefined || child.exitCode !== null) {
    return { started: true, detail: 'already-exited' };
  }
  const taskkill = win32.join(
    options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'taskkill.exe',
  );
  const result = (options.runTaskkill ?? ((executable, args) => spawnSync(
    executable,
    [...args],
    { stdio: 'ignore', windowsHide: true },
  )))(taskkill, ['/PID', String(child.pid), '/T', '/F']);
  if (result.error !== undefined) {
    return { started: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    return { started: false, detail: `taskkill-exit-${String(result.status)}` };
  }
  return { started: true, detail: 'taskkill-exit-0' };
}

export function createRuntimeSupervisor(
  options: RuntimeSupervisorOptions,
): RuntimeSupervisor {
  return new OwnedRuntimeSupervisor(options);
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback port'));
        return;
      }
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

function buildRuntimeEnvironment(
  runtimeHome: string,
  runtimeBinDirectories: readonly string[],
  companionToken?: string,
  developmentPluginFixture = false,
  distributionRegion?: 'china' | 'global',
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { DSH_HOME: runtimeHome };
  environment.DSH_DESKTOP_OWNER_PID = String(process.pid);
  if (companionToken !== undefined) {
    environment.DSH_DESKTOP_COMPANION_TOKEN = companionToken;
  }
  if (developmentPluginFixture) {
    environment.DSH_DESKTOP_DEVELOPMENT_PLUGIN_FIXTURE = '1';
  }
  if (distributionRegion !== undefined) {
    environment.DSH_DESKTOP_DISTRIBUTION_REGION = distributionRegion;
  }
  for (const name of ['TMPDIR', 'LANG', 'LC_ALL'] as const) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  environment.PATH = [...runtimeBinDirectories, process.env.PATH]
    .filter((entry): entry is string => entry !== undefined && entry !== '')
    .join(delimiter);
  return environment;
}

async function waitUntilReady(
  child: ChildProcess,
  origin: string,
  timeoutMs: number,
  getSpawnError: () => Error | undefined,
  companionToken: string | undefined,
): Promise<RuntimeFailure | undefined> {
  const deadline = Date.now() + timeoutMs;
  const healthNonce = randomBytes(32).toString('base64url');
  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError !== undefined) {
      return {
        code: 'spawn-failed',
        message: `Could not start Harness runtime: ${spawnError.message}`,
      };
    }
    if (child.exitCode !== null) {
      return {
        code: 'exited-before-ready',
        message: `Harness runtime exited before readiness with code ${String(child.exitCode)}`,
        exitCode: child.exitCode,
      };
    }
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(Math.min(500, timeoutMs)),
      });
      const rootReady = response.ok;
      await response.body?.cancel();
      if (
        rootReady &&
        (companionToken === undefined ||
          await companionRouteReady(
            origin,
            timeoutMs,
            companionToken,
            healthNonce,
          ))
      ) {
        await delay(0);
        if (child.exitCode === null) return undefined;
      }
    } catch {
      // The runtime is still starting.
    }
    await delay(50);
  }
  return {
    code: 'startup-timeout',
    message: `Harness runtime did not become ready within ${String(timeoutMs)}ms`,
  };
}

async function companionRouteReady(
  origin: string,
  timeoutMs: number,
  companionToken: string,
  nonce: string,
): Promise<boolean> {
  const response = await fetch(new URL(COMPANION_RPC_ROUTE, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'runtime.health', nonce }),
    signal: AbortSignal.timeout(Math.min(500, timeoutMs)),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    return false;
  }
  const payload = await readBoundedJson(response, 4_096);
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    (payload as Record<string, unknown>).status !== 'ready' ||
    typeof (payload as Record<string, unknown>).proof !== 'string'
  ) {
    return false;
  }
  const expected = createHmac('sha256', companionToken)
    .update(nonce)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(
      (payload as Record<string, unknown>).proof as string,
      'base64url',
    );
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return true;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
