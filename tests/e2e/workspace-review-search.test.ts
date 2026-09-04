import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, type ElectronApplication, type Locator } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from './executable-path.js';
import { closeElectronTestApplication } from './electron-cleanup.js';

const execFileAsync = promisify(execFile);
const runtimeCookieHeaders = new Map<string, string>();

function poll<T>(
  callback: () => T | Promise<T>,
  options: { readonly timeout?: number; readonly interval?: number } = {},
) {
  return expect.poll(callback, { timeout: 10_000, ...options });
}

describe.skipIf(process.platform !== 'darwin')('Workspace Review search', () => {
  let application: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await closeElectronTestApplication(application);
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
    const launchedApplication = application;
    await application.firstWindow();
    const origin = await waitForHarnessOrigin(application);
    const workspaceResult = asRecord(await callHarnessApi(origin, 'workspace.create', { path: workspace }));
    const workspaceId = readString(asRecord(workspaceResult.workspace), 'workspaceId');
    const sessionResult = asRecord(await callHarnessApi(origin, 'session.create', { workspaceId }));
    await selectSession(application, readString(sessionResult, 'sessionId'));

    const shell = application.windows().find((page) => page.url().startsWith('file:'));
    if (shell === undefined) throw new Error('Legacy shell page is missing');
    const companionToggle = shell.locator('[data-testid="companion-toggle"]');
    await poll(() => companionToggle.isVisible(), { timeout: 20_000 }).toBe(true);
    await companionToggle.click();
    await poll(() => companionToggle.getAttribute('aria-expanded')).toBe('true');
    const search = shell.locator('[data-testid="review-search"]');
    await poll(() => search.isVisible(), { timeout: 20_000 }).toBe(true);

    await sendHarnessFileSearchShortcut(application);
    await poll(() => shell.locator('[data-review-tab="files"]').getAttribute('aria-selected'))
      .toBe('true');
    const harness = application.windows().find((page) => page.url().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness page is missing');
    const composer = harness
      .locator('textarea,[contenteditable="true"][role="textbox"]')
      .last();
    const readComposerText = () => composer.evaluate((element) => (
      element instanceof HTMLTextAreaElement
        ? element.value
        : (element as HTMLElement).innerText
    ).replace(/\n{2,}/gu, '\n\n'));
    await shell.evaluate(() => {
      document.documentElement.dataset.appearanceScheme = 'dark';
      document.documentElement.style.setProperty('--harness-foreground', 'rgb(244 246 251)');
      document.documentElement.style.setProperty('--harness-surface-background', 'rgb(24 27 33)');
      document.documentElement.style.setProperty('--harness-overlay-background', 'rgb(24 27 33)');
    });
    const sourceDirectory = shell.getByRole('button', { name: 'src', exact: true });
    await sourceDirectory.click({ button: 'right' });
    await shell.getByRole('menuitem', { name: '添加文件夹到对话' }).click();
    await poll(
      readComposerText,
      { timeout: 10_000 },
    ).toBe('@src/');
    await sourceDirectory.click({ button: 'right' });
    await shell.getByRole('menuitem', { name: '复制相对路径' }).click();
    await poll(() => readClipboard(launchedApplication)).toBe('src');
    await search.focus();
    await shell.keyboard.type('n');
    await poll(() => search.inputValue()).toBe('n');
    await search.fill('needle panel');
    await poll(
      () => shell.locator('.search-result-copy small').allTextContents(),
      { timeout: 10_000 },
    ).toEqual(['src/NeedlePanel.ts']);
    await shell.evaluate(() => {
      document.documentElement.dataset.appearanceScheme = 'dark';
      document.documentElement.style.setProperty('--harness-foreground', 'rgb(244 246 251)');
      document.documentElement.style.setProperty('--harness-surface-background', 'rgb(24 27 33)');
      document.documentElement.style.setProperty('--harness-overlay-background', 'rgb(24 27 33)');
    });
    await shell.locator('.search-result').click({ button: 'right' });
    await poll(
      () => shell.getByRole('menuitem', { name: '添加到对话' }).evaluate(
        (element) => window.getComputedStyle(element).color,
      ),
    ).toBe('rgb(244, 246, 251)');
    await shell.getByRole('menuitem', { name: '添加到对话' }).click();
    await poll(
      readComposerText,
      { timeout: 10_000 },
    ).toBe('@src/\n\n@src/NeedlePanel.ts');

    await shell.locator('.search-result').click();
    await poll(
      () => shell.locator('[data-testid="preview-path"]').textContent(),
    ).toContain('src/NeedlePanel.ts');
    const previewCode = shell.locator('.text-line-code').first();
    await selectText(previewCode);
    await previewCode.click({ button: 'right' });
    await shell.getByRole('menuitem', { name: '复制选中文本' }).click();
    await poll(() => readClipboard(launchedApplication)).toBe('export const needle = true;');
    await selectText(previewCode);
    await previewCode.click({ button: 'right' });
    await shell.getByRole('menuitem', { name: '添加选中内容到对话' }).click();
    await poll(
      readComposerText,
      { timeout: 10_000 },
    )
      .toBe('@src/\n\n@src/NeedlePanel.ts\n\n@src/NeedlePanel.ts 第 1 行\n\nexport const needle = true;');
    await shell.locator('.search-result').click();
    await poll(
      () => shell.locator('[data-testid="preview-path"]').textContent(),
    ).toContain('src/NeedlePanel.ts');
    const copyMenu = shell.locator('[data-testid="preview-copy-menu"]');
    await copyMenu.locator('summary').click();
    await copyMenu.locator('[data-copy-target="path"]').click();
    await poll(() => readClipboard(launchedApplication)).toBe('src/NeedlePanel.ts');
    await shell.locator('.text-line-number').first().click();
    await copyMenu.locator('summary').click();
    await poll(() => copyMenu.locator('[data-copy-target="line"]').isEnabled()).toBe(true);
    await copyMenu.locator('[data-copy-target="line"]').click();
    await poll(() => readClipboard(launchedApplication)).toBe('1');
    await copyMenu.locator('summary').click();
    await copyMenu.locator('[data-copy-target="path-line"]').click();
    await poll(() => readClipboard(launchedApplication)).toBe('src/NeedlePanel.ts:1');
    await sendHarnessPreviewFindShortcut(application);
    const previewFind = shell.locator('[data-testid="preview-find-input"]');
    await poll(() => previewFind.isVisible()).toBe(true);
    await previewFind.fill('needle');
    await poll(() => shell.locator('[data-testid="preview-find-progress"]').textContent())
      .toBe('1 / 1');
    await poll(() => shell.locator('.preview-find-match[data-current="true"]').textContent())
      .toBe('needle');

    await shell.locator('[data-review-tab="changes"]').click();
    await search.fill('src');
    await shell.locator('[data-testid="change-filter"]').selectOption('modified');
    await poll(() => shell.locator('.change-row').count()).toBe(1);
    await poll(() => shell.locator('.change-path').getAttribute('title')).toBe('src/main.ts');
    await poll(() => shell.locator('[data-testid="change-count"]').textContent()).toBe('1/2');
    await shell.locator('.change-row').click();
    await poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/main.ts');
    await previewFind.fill('export');
    await poll(() => shell.locator('[data-testid="preview-find-progress"]').textContent())
      .toBe('1 / 2');
    await shell.locator('[data-testid="preview-find-next"]').click();
    await poll(() => shell.locator('[data-testid="preview-find-progress"]').textContent())
      .toBe('2 / 2');
    await previewFind.press('Shift+Enter');
    await poll(() => shell.locator('[data-testid="preview-find-progress"]').textContent())
      .toBe('1 / 2');
    await previewFind.press('Escape');
    await poll(() => shell.locator('[data-testid="preview-find-bar"]').isVisible()).toBe(false);
    await shell.locator('.diff-new-number:not(:disabled)').first().click();
    await copyMenu.locator('summary').click();
    await copyMenu.locator('[data-copy-target="path-line"]').click();
    await poll(() => readClipboard(launchedApplication)).toBe('src/main.ts:1');
    await shell.locator('[data-testid="preview-back"]').click();
    await poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/NeedlePanel.ts');
    await shell.locator('[data-testid="preview-forward"]').click();
    await poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/main.ts');
    await shell.locator('[data-testid="change-filter"]').selectOption('all');
    await poll(() => shell.locator('.change-row').count()).toBe(2);
    await poll(() => shell.locator('[data-testid="review-progress"]').textContent())
      .toBe('1 / 2 · 已查看 0');
    await shell.locator('[data-testid="review-toggle-viewed"]').click();
    await poll(() => shell.locator('[data-testid="review-progress"]').textContent())
      .toBe('1 / 2 · 已查看 1');
    await shell.locator('[data-testid="review-next"]').click();
    await poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/NeedlePanel.ts');
    await poll(() => shell.locator('[data-testid="review-progress"]').textContent())
      .toBe('2 / 2 · 已查看 1');
    await shell.locator('[data-testid="review-previous"]').click();
    await poll(() => shell.locator('[data-testid="preview-path"]').textContent())
      .toContain('src/main.ts');
    await poll(() => shell.locator('[data-testid="review-toggle-viewed"]').textContent())
      .toBe('已查看');
  }, 60_000);
});

async function waitForHarnessOrigin(application: ElectronApplication): Promise<string> {
  let origin: string | undefined;
  await poll(async () => {
    origin = await application.evaluate(({ webContents }) => {
      const harness = webContents.getAllWebContents()
        .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
      return harness === undefined ? undefined : new URL(harness.getURL()).origin;
    });
    return origin;
  }, { timeout: 30_000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  if (origin === undefined) throw new Error('Harness origin is missing');
  const cookies = await application.evaluate(
    ({ session }, url) => session.defaultSession.cookies.get({ url }),
    origin,
  );
  runtimeCookieHeaders.set(
    origin,
    cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
  );
  return origin;
}

async function callHarnessApi(origin: string, method: string, payload: unknown): Promise<unknown> {
  const rpcId = crypto.randomUUID();
  const endpoint = method.replace('.', '/');
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: runtimeCookieHeaders.get(origin) ?? '',
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: endpoint,
      payload: { args: { request: payload } },
    }),
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
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Harness reload timed out after selecting the session')),
        15_000,
      );
      harness.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
      harness.reload();
    });
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

async function sendHarnessPreviewFindShortcut(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ webContents }) => {
    const harness = webContents.getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness webContents is missing');
    harness.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['meta'] });
  });
}

async function readClipboard(application: ElectronApplication): Promise<string> {
  return application.evaluate(({ clipboard }) => clipboard.readText());
}

async function selectText(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
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
