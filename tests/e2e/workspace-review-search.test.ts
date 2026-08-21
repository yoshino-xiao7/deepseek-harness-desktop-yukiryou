import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from './executable-path.js';

const execFileAsync = promisify(execFile);

describe.skipIf(process.platform !== 'darwin')('Workspace Review search', () => {
  let application: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await application?.close();
    if (userData !== undefined) await rm(userData, { recursive: true, force: true });
  }, 30_000);

  it('searches nested files and combines change path with status filtering', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-review-search-e2e-'));
    const workspace = join(userData, 'workspace');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'main.ts'), 'export const before = true;\n');
    await execFileAsync('git', ['init', '--quiet', workspace]);
    await execFileAsync('git', ['-C', workspace, 'add', 'src/main.ts']);
    await execFileAsync('git', [
      '-C', workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      'commit', '--quiet', '-m', 'initial',
    ]);
    await writeFile(join(workspace, 'src', 'main.ts'), 'export const after = true;\n');
    await writeFile(join(workspace, 'src', 'NeedlePanel.ts'), 'export const needle = true;\n');

    application = await electron.launch({
      executablePath: resolveE2eExecutablePath(),
      args: [`--user-data-dir=${userData}`],
      env: { ...process.env, DSH_DESKTOP_E2E: '1', DSH_DESKTOP_CARRIER_MODE: 'legacy' },
    });
    await application.firstWindow();
    const origin = await waitForHarnessOrigin(application);
    const workspaceResult = asRecord(await callHarnessApi(origin, 'workspace.create', { path: workspace }));
    const workspaceId = readString(asRecord(workspaceResult.workspace), 'workspaceId');
    const sessionResult = asRecord(await callHarnessApi(origin, 'session.create', { workspaceId }));
    await selectSession(application, readString(sessionResult, 'sessionId'));

    const shell = application.windows().find((page) => page.url().startsWith('file:'));
    if (shell === undefined) throw new Error('Legacy shell page is missing');
    const search = shell.locator('[data-testid="review-search"]');
    await expect.poll(() => search.isVisible(), { timeout: 20_000 }).toBe(true);

    await sendHarnessFileSearchShortcut(application);
    await expect.poll(() => shell.locator('[data-review-tab="files"]').getAttribute('aria-selected'))
      .toBe('true');
    await shell.keyboard.type('n');
    await expect.poll(() => search.inputValue()).toBe('n');
    await search.fill('needle panel');
    await expect.poll(
      () => shell.locator('.search-result-copy small').allTextContents(),
      { timeout: 10_000 },
    ).toEqual(['src/NeedlePanel.ts']);
    await shell.locator('.search-result').click();
    await expect.poll(
      () => shell.locator('[data-testid="preview-path"]').textContent(),
    ).toContain('src/NeedlePanel.ts');

    await shell.locator('[data-review-tab="changes"]').click();
    await search.fill('src');
    await shell.locator('[data-testid="change-filter"]').selectOption('modified');
    await expect.poll(() => shell.locator('.change-row').count()).toBe(1);
    await expect.poll(() => shell.locator('.change-path').getAttribute('title')).toBe('src/main.ts');
    await expect.poll(() => shell.locator('[data-testid="change-count"]').textContent()).toBe('1/2');
    await shell.locator('.change-row').click();
    await expect.poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/main.ts');
    await shell.locator('[data-testid="preview-back"]').click();
    await expect.poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/NeedlePanel.ts');
    await shell.locator('[data-testid="preview-forward"]').click();
    await expect.poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/main.ts');
  }, 60_000);
});

async function waitForHarnessOrigin(application: ElectronApplication): Promise<string> {
  let origin: string | undefined;
  await expect.poll(async () => {
    origin = await application.evaluate(({ webContents }) => {
      const harness = webContents.getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
      return harness === undefined ? undefined : new URL(harness.getURL()).origin;
    });
    return origin;
  }, { timeout: 30_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  if (origin === undefined) throw new Error('Harness origin is missing');
  return origin;
}

async function callHarnessApi(origin: string, method: string, payload: unknown): Promise<unknown> {
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${origin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  });
  const envelope = asRecord(await response.json());
  const result = asRecord(envelope.result);
  if (!response.ok || envelope.rpcId !== rpcId || result.ok !== true) {
    throw new Error(`${method} failed: ${JSON.stringify(envelope)}`);
  }
  return result.value;
}

async function selectSession(application: ElectronApplication, sessionId: string): Promise<void> {
  await application.evaluate(async ({ webContents }, selectedSessionId) => {
    const harness = webContents.getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness webContents is missing');
    await harness.executeJavaScript(
      `localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId: selectedSessionId }))})`,
    );
    harness.reload();
  }, sessionId);
}

async function sendHarnessFileSearchShortcut(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ webContents }) => {
    const harness = webContents.getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness webContents is missing');
    harness.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['meta'] });
  });
}

function readString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate === '') throw new Error(`${key} is missing`);
  return candidate;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}
