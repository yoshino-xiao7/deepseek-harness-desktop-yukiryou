import { once } from 'node:events';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { closeElectronTestApplication } from './electron-cleanup.js';
import { resolveE2eExecutablePath } from './executable-path.js';

const currentSessionStorageKey = 'dsh.sessions.current';

describe('Harness session selection across desktop restarts', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await closeElectronTestApplication(electronApp);
    if (userData !== undefined) {
      await rm(userData, {
        recursive: true,
        force: true,
        maxRetries: process.platform === 'win32' ? 20 : 0,
        retryDelay: 100,
      });
    }
  }, 30_000);

  it('restores the same real session after clean and crashed desktop restarts', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-session-restart-e2e-'));
    const workspaceAPath = join(userData, 'workspace-a');
    const workspaceBPath = join(userData, 'workspace-b');
    await mkdir(workspaceAPath);
    await mkdir(workspaceBPath);

    const firstLaunch = await launchAndWait(userData);
    electronApp = firstLaunch.application;
    const firstOrigin = firstLaunch.origin;
    const workspaceA = await callHarnessApi(
      firstOrigin,
      'workspace.create',
      { path: workspaceAPath },
    );
    const sessionA = await callHarnessApi(firstOrigin, 'session.create', {
      workspaceId: readNestedString(workspaceA, 'workspace', 'workspaceId'),
    });
    const workspaceB = await callHarnessApi(
      firstOrigin,
      'workspace.create',
      { path: workspaceBPath },
    );
    const sessionB = await callHarnessApi(firstOrigin, 'session.create', {
      workspaceId: readNestedString(workspaceB, 'workspace', 'workspaceId'),
    });
    const expectedSessionId = readString(sessionA, 'sessionId');
    const createdSessionIds = [
      expectedSessionId,
      readString(sessionB, 'sessionId'),
    ].sort();
    const sessionsBeforeRestart = await readStableSessionIds(
      firstOrigin,
      createdSessionIds,
    );
    expect(sessionsBeforeRestart).toEqual(
      expect.arrayContaining(createdSessionIds),
    );
    await activateHarnessStorageSelection(
      electronApp,
      expectedSessionId,
    );
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    await electronApp.close();
    electronApp = undefined;

    const secondLaunch = await launchAndWait(userData);
    electronApp = secondLaunch.application;
    const secondOrigin = secondLaunch.origin;

    expect(secondOrigin).toBe(firstOrigin);
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    await expectOnlyBaselineSessions(
      secondOrigin,
      expectedSessionId,
      sessionsBeforeRestart,
    );

    const crashedProcess = electronApp.process();
    const crashed = once(crashedProcess, 'exit');
    crashDesktopProcessTree(crashedProcess);
    await crashed;
    electronApp = undefined;

    const thirdLaunch = await launchAndWait(userData, {
      retryTransientWindowsLaunch: true,
    });
    electronApp = thirdLaunch.application;
    expect(thirdLaunch.origin).toBe(firstOrigin);
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    await expectOnlyBaselineSessions(
      thirdLaunch.origin,
      expectedSessionId,
      sessionsBeforeRestart,
    );
  }, 90_000);
});

function crashDesktopProcessTree(desktopProcess: ChildProcess): void {
  if (desktopProcess.pid === undefined) {
    throw new Error('Desktop process has no pid');
  }
  if (process.platform !== 'win32') {
    desktopProcess.kill('SIGKILL');
    return;
  }
  const result = spawnSync(
    'taskkill.exe',
    ['/pid', String(desktopProcess.pid), '/t', '/f'],
    { encoding: 'utf8', shell: false },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `taskkill failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
}

async function launchAndWait(
  userData: string,
  options: { retryTransientWindowsLaunch?: boolean } = {},
): Promise<{ application: ElectronApplication; origin: string }> {
  const application = await launchElectron(userData, options);
  await application.firstWindow();
  let origin: string | undefined;
  await expect
    .poll(async () => {
      origin = await readHarnessOrigin(application);
      return origin;
    }, { timeout: 30_000 })
    .toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  if (origin === undefined) throw new Error('Harness origin is missing');
  return { application, origin };
}

async function launchElectron(
  userData: string,
  options: { retryTransientWindowsLaunch?: boolean },
): Promise<ElectronApplication> {
  const attempts =
    process.platform === 'win32' && options.retryTransientWindowsLaunch === true
      ? 10
      : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await electron.launch({
        executablePath: resolveE2eExecutablePath(),
        args: [`--user-data-dir=${userData}`],
        env: { ...process.env, DSH_DESKTOP_E2E: '1' },
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
}

async function readHarnessOrigin(
  application: ElectronApplication,
): Promise<string | undefined> {
  return application.evaluate(({ webContents }) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    return harness === undefined ? undefined : new URL(harness.getURL()).origin;
  });
}

async function readCurrentSessionId(
  application: ElectronApplication,
): Promise<string | undefined> {
  const stored = await application.evaluate(async ({ webContents }, key) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    return harness?.executeJavaScript(
      `window.localStorage.getItem(${JSON.stringify(key)})`,
    );
  }, currentSessionStorageKey);
  if (typeof stored !== 'string') return undefined;
  try {
    return readString(JSON.parse(stored) as unknown, 'sessionId');
  } catch {
    return undefined;
  }
}

async function activateHarnessStorageSelection(
  application: ElectronApplication,
  sessionId: string,
): Promise<void> {
  await application.evaluate(async ({ webContents }, payload) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness webContents is missing');
    await harness.executeJavaScript(
      `window.localStorage.setItem(${JSON.stringify(payload.key)}, ${JSON.stringify(JSON.stringify({ sessionId: payload.sessionId }))})`,
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Harness reload timed out after selecting the session'));
      }, 15_000);
      harness.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
      harness.reload();
    });
  }, { key: currentSessionStorageKey, sessionId });
}

async function readSessionIds(origin: string): Promise<string[]> {
  const items = await readSessions(origin);
  return items.map((item) => readString(item, 'sessionId')).sort();
}

async function readSessions(
  origin: string,
): Promise<Record<string, unknown>[]> {
  const value = await callHarnessApi(origin, 'session.list', {});
  const record = asRecord(value);
  const items = record.items;
  if (!Array.isArray(items)) throw new Error('session.list returned no items');
  return items.map(asRecord);
}

async function readStableSessionIds(
  origin: string,
  requiredSessionIds: readonly string[],
): Promise<string[]> {
  let latestSessionIds: string[] = [];
  let previousSignature = '';
  let consecutiveStableSnapshots = 0;
  await expect
    .poll(
      async () => {
        latestSessionIds = await readSessionIds(origin);
        const signature = latestSessionIds.join(',');
        const containsRequiredSessions = requiredSessionIds.every((sessionId) =>
          latestSessionIds.includes(sessionId),
        );
        consecutiveStableSnapshots =
          containsRequiredSessions && signature === previousSignature
            ? consecutiveStableSnapshots + 1
            : 0;
        previousSignature = signature;
        return consecutiveStableSnapshots >= 3;
      },
      {
        timeout: 15_000,
        interval: 250,
        message: 'Initial Harness session baseline did not settle',
      },
    )
    .toBe(true);
  return latestSessionIds;
}

async function expectOnlyBaselineSessions(
  origin: string,
  selectedSessionId: string,
  baselineSessionIds: readonly string[],
): Promise<void> {
  let consecutiveStableSnapshots = 0;
  await expect
    .poll(
      async () => {
        const visibleSessionIds = await readSessionIds(origin);
        const unexpectedSessionIds = visibleSessionIds.filter(
          (sessionId) => !baselineSessionIds.includes(sessionId),
        );
        const hasSelectedSession = visibleSessionIds.includes(selectedSessionId);
        const isStable =
          hasSelectedSession && unexpectedSessionIds.length === 0;
        consecutiveStableSnapshots = isStable
          ? consecutiveStableSnapshots + 1
          : 0;
        return {
          status:
            consecutiveStableSnapshots >= 3 ? 'stable' : 'settling',
          hasSelectedSession,
          unexpectedSessionIds,
        };
      },
      {
        timeout: 15_000,
        interval: 250,
        message:
          'Harness session list did not settle without a synthetic empty session',
      },
    )
    .toEqual({
      status: 'stable',
      hasSelectedSession: true,
      unexpectedSessionIds: [],
    });
}

async function callHarnessApi(
  origin: string,
  method: string,
  payload: unknown,
): Promise<unknown> {
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${origin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  });
  if (!response.ok) {
    throw new Error(`${method} transport failed with HTTP ${String(response.status)}`);
  }
  const envelope = asRecord(await response.json());
  if (envelope.rpcId !== rpcId) throw new Error(`${method} returned the wrong rpcId`);
  const result = asRecord(envelope.result);
  if (result.ok !== true) {
    throw new Error(`${method} failed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function readNestedString(
  value: unknown,
  outerKey: string,
  innerKey: string,
): string {
  return readString(asRecord(value)[outerKey], innerKey);
}

function readString(value: unknown, key: string): string {
  const candidate = asRecord(value)[key];
  if (typeof candidate !== 'string' || candidate === '') {
    throw new Error(`${key} is missing`);
  }
  return candidate;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}
