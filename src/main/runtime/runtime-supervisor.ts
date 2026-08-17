import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { delimiter } from 'node:path';

export type RuntimeFailureCode =
  | 'spawn-failed'
  | 'exited-before-ready'
  | 'unexpected-exit'
  | 'startup-timeout'
  | 'renderer-crashed';

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
  readonly onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

class OwnedRuntimeSupervisor implements RuntimeSupervisor {
  readonly #options: RuntimeSupervisorOptions;
  readonly #listeners = new Set<(state: RuntimeState) => void>();
  #state: RuntimeState = { kind: 'stopped' };
  #child: ChildProcess | undefined;
  #startPromise:
    | Promise<Extract<RuntimeState, { kind: 'ready' }>>
    | undefined;
  #stopping = false;

  constructor(options: RuntimeSupervisorOptions) {
    this.#options = options;
  }

  getState(): RuntimeState {
    return this.#state;
  }

  subscribe(listener: (state: RuntimeState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
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

  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#child;
    if (child === undefined) {
      this.#setState({ kind: 'stopped' });
      this.#stopping = false;
      return;
    }

    this.#signalOwnedProcess(child, 'SIGTERM');
    const exited = await waitForExit(child, this.#options.shutdownTimeoutMs);
    if (!exited) {
      this.#signalOwnedProcess(child, 'SIGKILL');
      await waitForExit(child, this.#options.shutdownTimeoutMs);
    }

    if (this.#child === child) {
      this.#child = undefined;
    }
    this.#setState({ kind: 'stopped' });
    this.#stopping = false;
  }

  async #startOwnedRuntime(): Promise<
    Extract<RuntimeState, { kind: 'ready' }>
  > {
    this.#stopping = false;
    this.#setState({ kind: 'starting', attempt: 1 });
    const port = await allocateLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;

    const child = spawn(
      this.#options.command,
      [
        ...this.#options.args,
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

    const failure = await waitUntilReady(
      child,
      origin,
      this.#options.startupTimeoutMs,
      () => spawnError,
    );
    if (failure !== undefined) {
      this.#setState({ kind: 'failed', failure });
      this.#signalOwnedProcess(child, 'SIGTERM');
      throw new Error(failure.message);
    }

    const ready: Extract<RuntimeState, { kind: 'ready' }> = {
      kind: 'ready',
      origin,
      version: this.#options.version,
    };
    this.#setState(ready);
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

  #setState(state: RuntimeState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
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
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { DSH_HOME: runtimeHome };
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
): Promise<RuntimeFailure | undefined> {
  const deadline = Date.now() + timeoutMs;
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
      if (response.ok) {
        return undefined;
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
