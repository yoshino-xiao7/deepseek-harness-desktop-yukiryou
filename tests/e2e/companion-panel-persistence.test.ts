import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from './executable-path.js';

describe.skipIf(process.platform !== 'darwin')('Companion panel width persistence', () => {
  let application: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await application?.close();
    if (userData !== undefined) await rm(userData, { recursive: true, force: true });
  }, 30_000);

  it('restores the resized panel and matching Harness reservation after restart', async () => {
    userData = await mkdtemp(join(tmpdir(), 'dsh-companion-width-e2e-'));

    const first = await launchLegacy(userData);
    application = first.application;
    const resizer = first.shell.locator('[data-testid="companion-resizer"]');
    const bounds = await resizer.boundingBox();
    if (bounds === null) throw new Error('Companion resizer bounds are missing');
    await first.shell.mouse.move(bounds.x + (bounds.width / 2), bounds.y + 80);
    await first.shell.mouse.down();
    await first.shell.mouse.move(bounds.x - 36, bounds.y + 80);
    await first.shell.evaluate(() => window.dispatchEvent(new Event('blur')));
    await first.shell.mouse.up();
    const widthAfterBlur = await readPanelWidth(first.shell);
    await first.shell.mouse.move(bounds.x + 24, bounds.y + 80);
    await first.shell.waitForTimeout(100);
    expect(await readPanelWidth(first.shell)).toBe(widthAfterBlur);
    expect(await first.shell.evaluate(() => document.body.dataset.companionResizing))
      .toBeUndefined();

    await resizer.focus();
    await resizer.press('End');
    await expectPanelWidth(first.shell, 480);
    await expect.poll(() => reservedRightWidth(application!)).toBe(480);
    await application.close();
    application = undefined;

    const second = await launchLegacy(userData);
    application = second.application;
    await expectPanelWidth(second.shell, 480);
    await expect.poll(() => reservedRightWidth(application!)).toBe(480);
  }, 60_000);
});

async function launchLegacy(
  userData: string,
): Promise<{ application: ElectronApplication; shell: Page }> {
  const application = await electron.launch({
    executablePath: resolveE2eExecutablePath(),
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      DSH_DESKTOP_E2E: '1',
      DSH_DESKTOP_CARRIER_MODE: 'legacy',
    },
  });
  await application.firstWindow();
  await expect.poll(
    () => application.windows().some((page) => page.url().startsWith('file:')),
    { timeout: 10_000 },
  ).toBe(true);
  const shell = application.windows().find((page) => page.url().startsWith('file:'));
  if (shell === undefined) throw new Error('Legacy shell page is missing');
  await expect.poll(
    () => shell.locator('[data-testid="companion-toggle"]').isVisible(),
    { timeout: 30_000 },
  ).toBe(true);
  await expect.poll(
    () => shell.locator('[data-testid="companion-panel"]').isHidden(),
  ).toBe(true);
  await shell.locator('[data-testid="companion-toggle"]').click();
  await expect.poll(
    () => shell.locator('[data-testid="companion-resizer"]').isVisible(),
    { timeout: 30_000 },
  ).toBe(true);
  return { application, shell };
}

async function expectPanelWidth(shell: Page, expected: number): Promise<void> {
  await expect.poll(() => readPanelWidth(shell)).toBe(expected);
  await expect.poll(
    () => shell.locator('[data-testid="companion-resizer"]').getAttribute('aria-valuenow'),
  ).toBe(String(expected));
}

async function readPanelWidth(shell: Page): Promise<number> {
  return shell.evaluate(() => Number.parseFloat(
    document.documentElement.style.getPropertyValue('--companion-panel-width'),
  ));
}

async function reservedRightWidth(application: ElectronApplication): Promise<number | undefined> {
  return application.evaluate(({ BrowserWindow, WebContentsView }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const harness = window?.contentView.children.find((view) => (
      view instanceof WebContentsView
      && view.webContents.getURL().startsWith('http://127.0.0.1:')
    ));
    if (window === undefined || harness === undefined) return undefined;
    return window.contentView.getBounds().width - harness.getBounds().width;
  });
}
