import { once } from 'node:events';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from './executable-path.js';

const currentSessionStorageKey = 'dsh.sessions.current';

describe('Harness session selection across desktop restarts', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true });
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
    const sessionsBeforeRestart = await readSessionIds(firstOrigin);
    expect(sessionsBeforeRestart).toEqual(
      expect.arrayContaining(createdSessionIds),
    );
    await writeHarnessStorage(
      electronApp,
      currentSessionStorageKey,
      JSON.stringify({ sessionId: expectedSessionId }),
    );
    await electronApp.close();
    electronApp = undefined;

    const secondLaunch = await launchAndWait(userData);
    electronApp = secondLaunch.application;
    const secondOrigin = secondLaunch.origin;

    expect(secondOrigin).toBe(firstOrigin);
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    await expect(readSessionIds(secondOrigin)).resolves.toEqual(
      [expectedSessionId],
    );

    const crashedProcess = electronApp.process();
    const crashed = once(crashedProcess, 'exit');
    crashDesktopProcessTree(crashedProcess);
    await crashed;
    electronApp = undefined;

    const thirdLaunch = await launchAndWait(userData);
    electronApp = thirdLaunch.application;
    expect(thirdLaunch.origin).toBe(firstOrigin);
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    await expect(readSessionIds(thirdLaunch.origin)).resolves.toEqual(
      [expectedSessionId],
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
): Promise<{ application: ElectronApplication; origin: string }> {
  const application = await electron.launch({
    executablePath: resolveE2eExecutablePath(),
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, DSH_DESKTOP_E2E: '1' },
  });
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

async function writeHarnessStorage(
  application: ElectronApplication,
  key: string,
  value: string,
): Promise<void> {
  await application.evaluate(async ({ webContents }, payload) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness webContents is missing');
    await harness.executeJavaScript(
      `window.localStorage.setItem(${JSON.stringify(payload.key)}, ${JSON.stringify(payload.value)})`,
    );
  }, { key, value });
}

async function readSessionIds(origin: string): Promise<string[]> {
  const value = await callHarnessApi(origin, 'session.list', {});
  const record = asRecord(value);
  const items = record.items;
  if (!Array.isArray(items)) throw new Error('session.list returned no items');
  return items.map((item) => readString(item, 'sessionId')).sort();
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
