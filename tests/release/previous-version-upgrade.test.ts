import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from '../e2e/executable-path.js';

const previousExecutable = process.env.DSH_PREVIOUS_EXECUTABLE_PATH?.trim();
const expectedPreviousVersion =
  process.env.DSH_PREVIOUS_EXPECTED_VERSION?.trim() || '0.2.1-beta.2';
const rc2BackupDirectoryName = 'runtime.pre-dsh-0.1.1-rc.2';
const rc2UpgradeMarkerName = '.dsh-0.1.1-rc.2-storage-v1.json';
const currentSessionStorageKey = 'dsh.sessions.current';

describe('previous-version upgrade', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) {
      if (process.env.DSH_KEEP_UPGRADE_E2E_DATA === '1') {
        process.stderr.write(`Preserved upgrade E2E data at ${userData}\n`);
      } else {
        await rm(userData, { recursive: true, force: true });
      }
    }
  });

  it('preserves the active real session and prepares the rc.2 migration exactly once', async () => {
    if (previousExecutable === undefined || previousExecutable === '') {
      throw new Error(
        `Set DSH_PREVIOUS_EXECUTABLE_PATH to an extracted ${expectedPreviousVersion} executable`,
      );
    }
    if (!existsSync(previousExecutable)) {
      throw new Error(
        `Previous-version application is required at ${previousExecutable}`,
      );
    }
    const previousInfoPlist = join(
      dirname(dirname(previousExecutable)),
      'Info.plist',
    );
    expect(
      execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleShortVersionString', previousInfoPlist],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe(expectedPreviousVersion);

    userData = await mkdtemp(join(tmpdir(), 'dsh-upgrade-e2e-'));
    const workspacePath = join(userData, 'upgrade-workspace');
    await mkdir(workspacePath);
    electronApp = await launchAndWait(previousExecutable, userData);
    const previousOrigin = await readHarnessOrigin(electronApp);
    if (previousOrigin === undefined) {
      throw new Error('Previous release Harness origin is missing');
    }
    const missingApiKeyEnv = `DSH_UPGRADE_E2E_MISSING_${crypto.randomUUID().replaceAll('-', '')}`;
    await expect(
      callHarnessApi(previousOrigin, 'settings.update', {
        ns: 'llm-deepseek',
        patch: { apiKeyEnv: missingApiKeyEnv },
      }),
    ).resolves.toMatchObject({ ns: 'llm-deepseek' });
    const workspace = await callHarnessApi(previousOrigin, 'workspace.create', {
      path: workspacePath,
    });
    const session = await callHarnessApi(previousOrigin, 'session.create', {
      workspaceId: readNestedString(workspace, 'workspace', 'workspaceId'),
    });
    const expectedSessionId = readString(session, 'sessionId');
    await expect(
      callHarnessApi(previousOrigin, 'session.prompt', {
        sessionId: expectedSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'upgrade-e2e durable marker' }],
        clientTimeZone: 'UTC',
      }),
    ).resolves.toMatchObject({ accepted: true });
    await expect
      .poll(
        () => readDurableSessionState(previousOrigin, expectedSessionId),
        { timeout: 15_000 },
      )
      .toEqual({
        blank: false,
        running: false,
        turnStarted: true,
        turnEnded: true,
      });
    const sessionsBeforeUpgrade = await readSessionIds(previousOrigin);
    expect(sessionsBeforeUpgrade).toContain(expectedSessionId);
    await activateHarnessUiSelection(electronApp, expectedSessionId);
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    await electronApp.close();
    electronApp = undefined;

    const runtimeHome = join(userData, 'runtime');
    const upgradeMarkerPath = join(userData, rc2UpgradeMarkerName);
    const markerBeforeCandidate = await readOptionalFile(upgradeMarkerPath);
    if (markerBeforeCandidate !== undefined) {
      expect(JSON.parse(markerBeforeCandidate)).toEqual({
        upgrade: 'dsh-0.1.1-rc.2-storage-v1',
        backupName: null,
      });
    }
    const preservedDirectory = join(runtimeHome, 'upgrade-preserved');
    const sentinelPath = join(preservedDirectory, 'sentinel.txt');
    const settingsPath = join(runtimeHome, 'settings.yaml');
    const sentinel = Buffer.from(`created-by-${expectedPreviousVersion}\n`);
    const settings = Buffer.from('appearance:\n  theme: dark\n');
    await mkdir(preservedDirectory, { recursive: true });
    await writeFile(sentinelPath, sentinel);
    await writeFile(settingsPath, settings);

    electronApp = await launchAndWait(resolveE2eExecutablePath(), userData);
    const candidateOrigin = await readHarnessOrigin(electronApp);
    expect(candidateOrigin).toBe(previousOrigin);
    await expect
      .poll(() => readCurrentSessionId(electronApp!), { timeout: 15_000 })
      .toBe(expectedSessionId);
    if (candidateOrigin === undefined) {
      throw new Error('Candidate Harness origin is missing');
    }
    // The Harness UI can briefly materialize its reusable blank-session
    // placeholder while applying the restored selection. Keep the invariant
    // strict, but allow the normal reuse/cleanup cycle to settle before
    // deciding that the upgrade persisted an extra Session.
    await expect
      .poll(() => readSessionIds(candidateOrigin), { timeout: 15_000 })
      .toEqual(sessionsBeforeUpgrade);

    await electronApp.close();
    electronApp = undefined;

    await expect(readFile(sentinelPath)).resolves.toEqual(sentinel);

    const desktopLog = await readFile(join(userData, 'logs', 'desktop.log'), 'utf8');
    const upgradeRecords = desktopLog
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event?: unknown; details?: unknown })
      .filter((record) => record.event === 'runtime.upgrade-backup-created');
    const backupHome = join(userData, rc2BackupDirectoryName);
    if (markerBeforeCandidate === undefined) {
      await expect(
        readFile(join(backupHome, 'upgrade-preserved', 'sentinel.txt')),
      ).resolves.toEqual(sentinel);
      await expect(readFile(join(backupHome, 'settings.yaml'))).resolves.toEqual(
        settings,
      );
      expect(upgradeRecords).toEqual([
        {
          timestamp: expect.any(String),
          event: 'runtime.upgrade-backup-created',
          details: `backup=${rc2BackupDirectoryName}`,
        },
      ]);
    } else {
      await expect(readFile(upgradeMarkerPath, 'utf8')).resolves.toBe(
        markerBeforeCandidate,
      );
      await expect(lstat(backupHome)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(upgradeRecords).toEqual([]);
    }
  }, 180_000);
});

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function launchAndWait(
  executablePath: string,
  userData: string,
): Promise<ElectronApplication> {
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    // A real turn makes the Session nonblank, but the empty credential makes
    // the rc.7 DeepSeek adapter fail before fetch so this gate never calls a
    // model or the public network.
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: '',
      DSH_DESKTOP_E2E: '1',
    },
  });
  await application.firstWindow();
  await expect
    .poll(
      () =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((contents) => contents.getURL().startsWith('http://127.0.0.1:')),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  return application;
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

async function activateHarnessUiSelection(
  application: ElectronApplication,
  sessionId: string,
): Promise<void> {
  await application.evaluate(async ({ webContents }, payload) => {
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness webContents is missing');
    const result = await harness.executeJavaScript(`(async () => {
      const rows = [...document.querySelectorAll('[role="treeitem"][aria-selected]')];
      for (const row of rows) {
        if (!(row instanceof HTMLElement)) continue;
        row.click();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        try {
          const current = JSON.parse(window.localStorage.getItem(${JSON.stringify(payload.key)}) ?? 'null');
          if (current?.sessionId === ${JSON.stringify(payload.sessionId)}) {
            return { selected: true, rowCount: rows.length };
          }
        } catch {}
      }
      return { selected: false, rowCount: rows.length };
    })()`);
    if (result?.selected !== true) {
      throw new Error(
        `Harness sidebar could not select the real session from ${String(result?.rowCount ?? 0)} rows`,
      );
    }
  }, { key: currentSessionStorageKey, sessionId });
}

async function readSessionIds(origin: string): Promise<string[]> {
  const items = await readSessionItems(origin);
  return items.map((item) => readString(item, 'sessionId')).sort();
}

async function readDurableSessionState(
  origin: string,
  sessionId: string,
): Promise<{
  blank: boolean;
  running: boolean;
  turnStarted: boolean;
  turnEnded: boolean;
}> {
  const [items, history] = await Promise.all([
    readSessionItems(origin),
    callHarnessApi(origin, 'session.history', { sessionId, maxMessages: 50 }),
  ]);
  const summary = items.find((item) => readString(item, 'sessionId') === sessionId);
  if (summary === undefined) throw new Error(`Session ${sessionId} is not listed`);
  const summaryRecord = asRecord(summary);
  if (typeof summaryRecord.blank !== 'boolean' || typeof summaryRecord.running !== 'boolean') {
    throw new Error('session.list returned invalid durability metadata');
  }
  const events = asRecord(history).events;
  if (!Array.isArray(events)) throw new Error('session.history returned no events');
  const eventTypes = events.map((entry) =>
    readString(asRecord(entry).event, 'type'));
  return {
    blank: summaryRecord.blank,
    running: summaryRecord.running,
    turnStarted: eventTypes.includes('turn/start'),
    turnEnded: eventTypes.includes('turn/end'),
  };
}

async function readSessionItems(origin: string): Promise<unknown[]> {
  const value = await callHarnessApi(origin, 'session.list', {});
  const items = asRecord(value).items;
  if (!Array.isArray(items)) throw new Error('session.list returned no items');
  return items;
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
  if (result.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(result)}`);
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
