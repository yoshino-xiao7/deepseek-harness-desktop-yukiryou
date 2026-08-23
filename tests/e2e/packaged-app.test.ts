import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from './executable-path.js';
import { runtimeStartupTimeoutMs } from '../../src/main/runtime/runtime-startup-policy.js';

const executablePath = resolveE2eExecutablePath();
const startupTimeoutMs = runtimeStartupTimeoutMs(process.platform) + 10_000;
const testTimeoutMs = process.platform === 'win32' ? 150_000 : 75_000;

async function captureApplicationWindow(
  electronApp: ElectronApplication,
  captureName: string,
): Promise<void> {
  const directory = join(process.cwd(), 'out', 'windows-ui-verification');
  await mkdir(directory, { recursive: true });
  const captures = await electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
    const applicationWindow = BrowserWindow.getAllWindows()[0];
    if (applicationWindow === undefined) throw new Error('application window is unavailable');
    const harness = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('http://127.0.0.1:'));
    if (harness === undefined) throw new Error('Harness view is unavailable');
    return {
      shell: (await applicationWindow.capturePage()).toPNG().toString('base64'),
      harness: (await harness.capturePage()).toPNG().toString('base64'),
    };
  });
  await Promise.all([
    writeFile(
      join(directory, `shell-${captureName}.png`),
      Buffer.from(captures.shell, 'base64'),
    ),
    writeFile(
      join(directory, `harness-${captureName}.png`),
      Buffer.from(captures.harness, 'base64'),
    ),
  ]);
}

describe('packaged desktop application', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) await rm(userData, { recursive: true, force: true });
  }, 30_000);

  it(
    'opens the bundled Harness UI without exposing Electron privileges',
    async () => {
      userData = await mkdtemp(join(tmpdir(), 'dsh-desktop-e2e-'));
      electronApp = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userData}`],
        env: { ...process.env, DSH_DESKTOP_E2E: '1' },
      });
      await electronApp.firstWindow();
      await expect
        .poll(
          () =>
            electronApp
              ?.windows()
              .some((candidate) => candidate.url().startsWith('file:')),
          { timeout: 10_000 },
        )
        .toBe(true);
      const shellPage = electronApp
        .windows()
        .find((candidate) => candidate.url().startsWith('file:'));
      expect(shellPage).toBeDefined();
      const dragRegion = await shellPage!
        .locator('[data-testid="window-drag-region"]')
        .evaluate((element) =>
          window
            .getComputedStyle(element)
            .getPropertyValue('-webkit-app-region'),
        );
      expect(dragRegion).toBe('drag');
      const startupVisual = await shellPage!.evaluate(() => {
        const image = document.querySelector('.brand-image');
        const stage = document.querySelector('.brand-stage');
        return {
          imageLoaded:
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
          heading: document.querySelector('h1')?.textContent?.trim(),
          progressDots: document.querySelectorAll('.progress-track span').length,
          stageAnimation:
            stage === null ? '' : window.getComputedStyle(stage).animationName,
        };
      });
      expect(startupVisual).toMatchObject({
        imageLoaded: true,
        heading: '正在唤醒 Harness',
        progressDots: 3,
        stageAnimation: 'stage-arrive',
      });

      await expect
        .poll(
          () =>
            electronApp?.evaluate(({ webContents }) =>
              webContents
                .getAllWebContents()
                .map((contents) => contents.getURL())
                .find((url) => url.startsWith('http://127.0.0.1:')),
            ),
          { timeout: startupTimeoutMs },
        )
        .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?/);

      const readToolbarSidebarWidth = () =>
        shellPage!
          .locator('[data-testid="window-drag-region"]')
          .evaluate((element) => {
            const background = window.getComputedStyle(element).backgroundImage;
            const match = background.match(/\s(\d+(?:\.\d+)?)px/);
            return match ? Number(match[1]) : undefined;
          });

      const expandedHarnessWidth = await electronApp.evaluate(
        async ({ webContents }) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          return harness?.executeJavaScript(`
            new Promise(async (resolve) => {
              const readWidth = () => {
                const frame = [...document.querySelectorAll(
                  '[style*="grid-template-columns"]',
                )].find((candidate) => {
                  const bounds = candidate.getBoundingClientRect();
                  return bounds.width >= innerWidth * 0.9
                    && bounds.height >= innerHeight * 0.9;
                });
                return frame instanceof HTMLElement
                  ? Number.parseFloat(
                      getComputedStyle(frame).gridTemplateColumns,
                    )
                  : undefined;
              };
              for (let attempt = 0; attempt < 50 && readWidth() === undefined; attempt += 1) {
                await new Promise((next) => setTimeout(next, 100));
              }
              if ((readWidth() ?? 0) < 200) {
                const buttons = [...document.querySelectorAll('button')];
                const button = buttons.find(
                  (candidate) => /打开侧边栏|open sidebar/i.test(
                    [
                      candidate.getAttribute('aria-label'),
                      candidate.getAttribute('title'),
                      candidate.textContent,
                    ].filter(Boolean).join(' '),
                  ),
                );
                const alreadyExpanding = buttons.some((candidate) =>
                  /收起侧边栏|collapse sidebar/i.test(
                    [
                      candidate.getAttribute('aria-label'),
                      candidate.getAttribute('title'),
                      candidate.textContent,
                    ].filter(Boolean).join(' '),
                  ),
                );
                if (!(button instanceof HTMLButtonElement) && !alreadyExpanding) {
                  resolve(undefined);
                  return;
                }
                button?.click();
              }
              for (let attempt = 0; attempt < 50; attempt += 1) {
                const width = readWidth();
                if (width !== undefined && Math.abs(width - 280) < 0.01) {
                  resolve(width);
                  return;
                }
                await new Promise((next) => setTimeout(next, 100));
              }
              resolve(readWidth());
            })
          `);
        },
      );
      expect(expandedHarnessWidth).toBeCloseTo(280, 1);
      await expect
        .poll(
          () => electronApp!.evaluate(async ({ webContents }) => {
            const harness = webContents.getAllWebContents().find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
            if (harness === undefined) return undefined;
            return harness.executeJavaScript(`(() => {
              const bridge = window.deepSeekYukiRyouBalance;
              const card = document.querySelector('[data-testid="desktop-account-balance"]');
              const value = card?.querySelector('.dsh-balance-value');
              const balanceIcon = card?.querySelector('.dsh-balance-icon');
              const settings = [...document.querySelectorAll('button')].find(
                (button) => /^(设置|Settings)$/.test(button.textContent?.trim() ?? ''),
              );
              const settingsIcon = settings?.querySelector('svg');
              const balanceIconBounds = balanceIcon?.getBoundingClientRect();
              const settingsIconBounds = settingsIcon?.getBoundingClientRect();
              const labelBounds = card?.querySelector('.dsh-balance-label')?.getBoundingClientRect();
              const valueBounds = value?.getBoundingClientRect();
              return {
                text: card?.textContent,
                hasCard: card !== null,
                hasStyle: document.querySelector('style[data-dsh-balance-style]') !== null,
                valueClipped: value instanceof HTMLElement
                  ? value.scrollWidth > value.clientWidth
                  : undefined,
                valueBelowLabel: labelBounds && valueBounds
                  ? valueBounds.top >= labelBounds.bottom
                  : undefined,
                leadingOffset: balanceIconBounds && settingsIconBounds
                  ? Math.round(
                      balanceIconBounds.left + balanceIconBounds.width / 2
                      - settingsIconBounds.left - settingsIconBounds.width / 2,
                    )
                  : undefined,
                bridgeShape: {
                  getSnapshot: typeof bridge?.getSnapshot,
                  subscribe: typeof bridge?.subscribe,
                  refresh: typeof bridge?.refresh,
                },
              };
            })()`);
          }),
          { timeout: 10_000 },
        )
        .toMatchObject({
          hasCard: true,
          hasStyle: true,
          text: expect.stringMatching(/账户余额|Account balance/),
          valueClipped: false,
          valueBelowLabel: true,
          leadingOffset: 0,
          bridgeShape: {
            getSnapshot: 'function',
            subscribe: 'function',
            refresh: 'function',
          },
        });
      expect(
        await shellPage!.evaluate(
          () => typeof (window as unknown as { deepSeekYukiRyouBalance?: unknown }).deepSeekYukiRyouBalance,
        ),
      ).toBe('undefined');
      await expect.poll(() => shellPage!.locator('[data-testid="companion-panel"]').isVisible()).toBe(true);
      await expect.poll(() => shellPage!.locator('[data-testid="companion-empty"]').textContent()).toContain('选择一个工作区会话');
      const rejectedPath = await shellPage!.evaluate(async () => {
        const bridge = (window as unknown as { deepSeekYukiRyouCompanion: { request(value: unknown): Promise<unknown> } }).deepSeekYukiRyouCompanion;
        return bridge.request({ kind: 'file.preview', nodeId: '/Users/example/secret' });
      });
      expect(rejectedPath).toEqual({ kind: 'unavailable', reason: 'invalid-node' });
      const rejectedRelativeTarget = await shellPage!.evaluate(async () => {
        const bridge = (window as unknown as { deepSeekYukiRyouCompanion: { request(value: unknown): Promise<unknown> } }).deepSeekYukiRyouCompanion;
        return bridge.request({
          kind: 'file.preview-relative',
          nodeId: 'Abcdefghijklmnop_1',
          target: 'file:///Users/example/secret',
        });
      });
      expect(rejectedRelativeTarget).toEqual({ kind: 'unavailable', reason: 'invalid-node' });
      expect(await electronApp!.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows()[0]?.getMinimumSize()
      ))).toEqual([820, 600]);
      const readHarnessViewWidth = () => electronApp!.evaluate(async ({ BrowserWindow, WebContentsView }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const harness = window?.contentView.children.find((view) => (
          view instanceof WebContentsView
          && view.webContents.getURL().startsWith('http://127.0.0.1:')
        ));
        return harness?.getBounds().width;
      });
      const openHarnessWidth = await readHarnessViewWidth();
      await shellPage!.locator('[data-testid="companion-toggle"]').click();
      await shellPage!.waitForTimeout(60);
      const animatingHarnessWidth = await readHarnessViewWidth();
      await expect.poll(() => shellPage!.locator('[data-testid="companion-panel"]').isHidden()).toBe(true);
      const closedHarnessWidth = await readHarnessViewWidth();
      expect(openHarnessWidth).toBeTypeOf('number');
      expect(animatingHarnessWidth).toBeGreaterThan(openHarnessWidth!);
      expect(animatingHarnessWidth).toBeLessThan(closedHarnessWidth!);
      expect(closedHarnessWidth! - openHarnessWidth!).toBeCloseTo(340, -1);
      await shellPage!.locator('[data-testid="companion-toggle"]').click();
      await expect.poll(() => shellPage!.locator('[data-testid="companion-panel"]').isVisible()).toBe(true);
      await expect
        .poll(readToolbarSidebarWidth, { timeout: 5_000 })
        .toBeCloseTo(280, 1);
      await shellPage!.evaluate(() => {
        const sampleWindow = window as unknown as {
          toolbarWidthSamples: number[];
        };
        sampleWindow.toolbarWidthSamples = [];
        new MutationObserver(() => {
          const value = Number.parseFloat(
            document.documentElement.style.getPropertyValue(
              '--harness-sidebar-width',
            ),
          );
          if (Number.isFinite(value)) {
            sampleWindow.toolbarWidthSamples.push(value);
          }
        }).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['style'],
        });
      });

      const collapsedHarnessWidth = await electronApp.evaluate(
        async ({ webContents }) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          return harness?.executeJavaScript(`
            new Promise(async (resolve) => {
              const readWidth = () => {
                const frame = [...document.querySelectorAll(
                  '[style*="grid-template-columns"]',
                )].find((candidate) => {
                  const bounds = candidate.getBoundingClientRect();
                  return bounds.width >= innerWidth * 0.9
                    && bounds.height >= innerHeight * 0.9;
                });
                return frame instanceof HTMLElement
                  ? Number.parseFloat(
                      getComputedStyle(frame).gridTemplateColumns,
                    )
                  : undefined;
              };
              if ((readWidth() ?? 0) > 100) {
                const buttons = [...document.querySelectorAll('button')];
                const button = buttons.find(
                  (candidate) => /收起侧边栏|collapse sidebar/i.test(
                    [
                      candidate.getAttribute('aria-label'),
                      candidate.getAttribute('title'),
                      candidate.textContent,
                    ].filter(Boolean).join(' '),
                  ),
                );
                const alreadyCollapsing = buttons.some((candidate) =>
                  /打开侧边栏|open sidebar/i.test(
                    [
                      candidate.getAttribute('aria-label'),
                      candidate.getAttribute('title'),
                      candidate.textContent,
                    ].filter(Boolean).join(' '),
                  ),
                );
                if (!(button instanceof HTMLButtonElement) && !alreadyCollapsing) {
                  resolve(undefined);
                  return;
                }
                button?.click();
              }
              for (let attempt = 0; attempt < 50; attempt += 1) {
                const width = readWidth();
                if (width !== undefined && Math.abs(width - 56) < 0.01) {
                  resolve(width);
                  return;
                }
                await new Promise((next) => setTimeout(next, 100));
              }
              resolve(readWidth());
            })
          `);
        },
      );
      expect(collapsedHarnessWidth).toBeCloseTo(56, 1);
      await expect
        .poll(readToolbarSidebarWidth, { timeout: 5_000 })
        .toBeCloseTo(56, 1);
      const animationSamples = await shellPage!.evaluate(
        () =>
          (
            window as unknown as {
              toolbarWidthSamples: number[];
            }
          ).toolbarWidthSamples,
      );
      expect(new Set(animationSamples).size).toBeGreaterThan(2);
      expect(
        animationSamples.some((width) => width > 56 && width < 280),
      ).toBe(true);

      const settingsResult = await electronApp.evaluate(
        async ({ webContents }) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          return harness?.executeJavaScript(`
            new Promise(async (resolve) => {
              const waitFor = async (read) => {
                for (let attempt = 0; attempt < 40; attempt += 1) {
                  const value = read();
                  if (value) return value;
                  await new Promise((next) => setTimeout(next, 100));
                }
                return undefined;
              };
              for (let step = 0; step < 2; step += 1) {
                const onboarding = await waitFor(() =>
                  document.querySelector('[role="dialog"]'),
                );
                if (!(onboarding instanceof HTMLElement)) break;
                const action = [...onboarding.querySelectorAll('button')].find(
                  (button) => /^(继续|Continue|稍后配置|Configure later)$/i.test(
                    button.textContent?.trim() ?? '',
                  ),
                );
                if (!(action instanceof HTMLButtonElement)) break;
                const previousText = onboarding.textContent;
                action.click();
                await waitFor(() => {
                  const current = document.querySelector('[role="dialog"]');
                  return current?.textContent !== previousText;
                });
              }
              const settingsTrigger = [...document.querySelectorAll('button')]
                .find((candidate) => candidate.getAttribute('aria-haspopup') === 'dialog');
              settingsTrigger?.click();
              const dialog = await waitFor(() =>
                [...document.querySelectorAll('[role="dialog"]')].find(
                  (candidate) => candidate.querySelector('nav'),
                ),
              );
              if (!(dialog instanceof HTMLElement)) {
                resolve({ error: 'settings dialog did not open' });
                return;
              }
              const buttons = [...dialog.querySelectorAll('button')];
              const appearance = buttons.find((button) =>
                /^(外观|Appearance)$/.test(button.textContent?.trim() ?? ''),
              );
              appearance?.click();
              const appearancePage = await waitFor(() =>
                dialog.querySelector('.dsh-desktop-theme-grid'),
              );
              if (!(appearancePage instanceof HTMLElement)) {
                resolve({
                  error: 'appearance page did not render',
                  appearanceFound: Boolean(appearance),
                  navLabels: [...dialog.querySelectorAll('nav button')]
                    .map((button) => button.textContent?.trim()),
                  dialogText: dialog.textContent,
                  pluginStyleLoaded: Boolean(document.querySelector(
                    'style[data-plugin-css="dsh-desktop-settings"]',
                  )),
                });
                return;
              }
              const themeButtons = [...appearancePage.querySelectorAll('button')];
              const dark = themeButtons.find((button) =>
                /^(深色|Dark)$/.test(button.textContent?.trim() ?? ''),
              );
              dark?.click();
              await waitFor(() => document.body.hasAttribute('data-ds-dark-theme'));
              const about = [...dialog.querySelectorAll('button')].find((button) =>
                /^(关于|About)$/.test(button.textContent?.trim() ?? ''),
              );
              about?.click();
              const aboutPage = await waitFor(() =>
                dialog.querySelector('.dsh-desktop-about-card'),
              );
              const aboutLogo = await waitFor(() => {
                const image = dialog.querySelector('.dsh-desktop-about-logo');
                return image instanceof HTMLImageElement
                  && image.complete
                  && image.naturalWidth > 0
                  ? image
                  : undefined;
              });
              resolve({
                navLabels: [...dialog.querySelectorAll('nav button')]
                  .map((button) => button.textContent?.trim()),
                themeLabels: themeButtons.map((button) => button.textContent?.trim()),
                darkApplied: document.body.hasAttribute('data-ds-dark-theme'),
                aboutLogoLoaded: aboutLogo instanceof HTMLImageElement,
                aboutLogoDiagnostics: (() => {
                  const image = dialog.querySelector('.dsh-desktop-about-logo');
                  return image instanceof HTMLImageElement
                    ? {
                        src: image.src,
                        complete: image.complete,
                        naturalWidth: image.naturalWidth,
                      }
                    : undefined;
                })(),
                developerHref: dialog.querySelector(
                  '.dsh-desktop-about-developer',
                )?.getAttribute('href'),
                updateButtonText: dialog.querySelector(
                  '.dsh-desktop-update-button',
                )?.textContent?.trim(),
                updateStatusText: dialog.querySelector(
                  '.dsh-desktop-update-status',
                )?.textContent?.trim(),
                updateBridgeShape: {
                  check: typeof window.deepSeekYukiRyouUpdates?.check,
                  install: typeof window.deepSeekYukiRyouUpdates?.install,
                  download: typeof window.deepSeekYukiRyouUpdates?.download,
                  subscribe: typeof window.deepSeekYukiRyouUpdates?.subscribe,
                  getSnapshot: typeof window.deepSeekYukiRyouUpdates?.getSnapshot,
                },
                aboutText: aboutPage?.parentElement?.textContent ?? '',
              });
            })
          `);
        },
      );
      if (settingsResult?.error) {
        throw new Error(JSON.stringify(settingsResult));
      }
      expect(settingsResult?.navLabels).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^(外观|Appearance)$/),
          expect.stringMatching(/^(关于|About)$/),
        ]),
      );
      expect(settingsResult?.themeLabels).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^(浅色|Light)$/),
          expect.stringMatching(/^(深色|Dark)$/),
          expect.stringMatching(/^(跟随系统|System)$/),
        ]),
      );
      expect(settingsResult?.darkApplied).toBe(true);
      if (!settingsResult?.aboutLogoLoaded) {
        throw new Error(
          `about logo failed: ${JSON.stringify(settingsResult?.aboutLogoDiagnostics)}`,
        );
      }
      expect(settingsResult?.developerHref).toBe(
        'https://github.com/yoshino-xiao7',
      );
      expect(settingsResult?.updateButtonText).toMatch(
        /^(检查更新|检查中…|下载中…|下载 DMG|下载 EXE|重新检查|重启并更新|Check for updates|Checking…|Downloading…|Download DMG|Download EXE|Check again|Restart and update)$/,
      );
      expect(settingsResult?.updateStatusText).toBeTruthy();
      expect(settingsResult?.updateBridgeShape).toEqual({
        check: 'function',
        install: 'function',
        download: 'function',
        subscribe: 'function',
        getSnapshot: 'function',
      });
      expect(settingsResult?.aboutText).toContain('DeepSeek YukiRyou');
      expect(settingsResult?.aboutText).toContain('0.1.0-rc.8');
      expect(settingsResult?.aboutText).toMatch(
        process.platform === 'win32'
          ? /Windows.*x64/
          : /Apple Silicon.*arm64/,
      );

      const selectHarnessLocale = async (locale: 'en-US' | 'zh-CN') => {
        await electronApp!.evaluate(async ({ webContents }, nextLocale) => {
          const harness = webContents
            .getAllWebContents()
            .find((contents) =>
              contents.getURL().startsWith('http://127.0.0.1:'),
            );
          await harness?.executeJavaScript(
            `document.documentElement.lang = ${JSON.stringify(nextLocale)}`,
          );
        }, locale);
      };
      const readDesktopLocale = async () => ({
        toolbar: await shellPage!
          .locator('[data-window-menu]')
          .allTextContents(),
        menu: await electronApp!.evaluate(({ Menu }) => {
          const menu = Menu.getApplicationMenu();
          return ['edit', 'view', 'window', 'help'].map(
            (id) => menu?.getMenuItemById(id)?.label,
          );
        }),
      });
      await selectHarnessLocale('en-US');
      await expect.poll(readDesktopLocale).toEqual({
        toolbar: ['File', 'Edit', 'View', 'Help'],
        menu: ['Edit', 'View', 'Window', 'Help'],
      });
      await selectHarnessLocale('zh-CN');
      await expect.poll(readDesktopLocale).toEqual({
        toolbar: ['文件', '编辑', '视图', '帮助'],
        menu: ['编辑', '视图', '窗口', '帮助'],
      });
      if (process.platform === 'win32') {
        await captureApplicationWindow(electronApp, 'settings-dark');
      }

      await electronApp.evaluate(({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        void harness?.executeJavaScript(`
          document.querySelector('button[aria-label="打开侧边栏"], button[aria-label="Open sidebar"]')?.click()
        `);
      });

      await electronApp.evaluate(({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        harness?.send('dsh-desktop:update-state', {
          status: 'downloading',
          currentVersion: '0.1.0',
          checkedAt: new Date().toISOString(),
        });
      });
      await expect
        .poll(() =>
          electronApp!.evaluate(async ({ webContents }) => {
            const harness = webContents
              .getAllWebContents()
              .find((contents) =>
                contents.getURL().startsWith('http://127.0.0.1:'),
              );
            return harness?.executeJavaScript(`(() => {
              const update = document.querySelector('[data-dsh-desktop-update-button]');
              const frame = [...document.querySelectorAll(
                '[style*="grid-template-columns"]',
              )].find((candidate) => {
                const bounds = candidate.getBoundingClientRect();
                return bounds.width >= innerWidth * 0.9
                  && bounds.height >= innerHeight * 0.9;
              });
              const sidebar = frame?.firstElementChild;
              const updateBounds = update?.getBoundingClientRect();
              const sidebarBounds = sidebar?.getBoundingClientRect();
              return {
                header: update?.textContent?.trim(),
                parentIsSidebar: update?.parentElement === sidebar,
                rightGap: updateBounds && sidebarBounds
                  ? Math.round(sidebarBounds.right - updateBounds.right)
                  : undefined,
                bottomGap: updateBounds && sidebarBounds
                  ? Math.round(sidebarBounds.bottom - updateBounds.bottom)
                  : undefined,
                card: document.querySelector('.dsh-desktop-update-button')?.textContent?.trim(),
                progress: document.querySelector('.dsh-desktop-update-progress')?.getAttribute('role'),
              };
            })()`);
          }),
        )
        .toMatchObject({
          header: '',
          parentIsSidebar: true,
          rightGap: 12,
          bottomGap: 12,
          card: expect.stringMatching(/^(下载中…|Downloading…)$/),
          progress: 'progressbar',
        });

      await electronApp.evaluate(({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        harness?.send('dsh-desktop:update-state', {
          status: 'manual',
          currentVersion: '0.1.0',
          message: 'Code signature did not pass validation',
        });
      });
      await expect
        .poll(() =>
          electronApp!.evaluate(async ({ webContents }) => {
            const harness = webContents
              .getAllWebContents()
              .find((contents) =>
                contents.getURL().startsWith('http://127.0.0.1:'),
              );
            return harness?.executeJavaScript(`({
              header: document.querySelector('[data-dsh-desktop-update-button]')?.textContent?.trim(),
              headerLabel: document.querySelector('[data-dsh-desktop-update-button]')?.getAttribute('aria-label'),
              card: document.querySelector('.dsh-desktop-update-button')?.textContent?.trim(),
              status: document.querySelector('.dsh-desktop-update-status')?.textContent?.trim(),
            })`);
          }),
        )
        .toMatchObject({
          header: '',
          headerLabel: expect.stringMatching(/^(手动下载更新|Download update manually)$/),
          card: expect.stringMatching(
            process.platform === 'win32'
              ? /^(下载 EXE|Download EXE)$/
              : /^(下载 DMG|Download DMG)$/,
          ),
          status: expect.stringMatching(
            process.platform === 'win32' ? /(Windows|EXE|ZIP)/ : /(macOS|DMG)/,
          ),
        });

      await electronApp.evaluate(({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        harness?.send('dsh-desktop:update-state', {
          status: 'downloaded',
          currentVersion: '0.1.0',
          releaseName: '0.2.0',
          releaseNotes: 'Ready for E2E verification',
        });
      });
      await expect
        .poll(() =>
          electronApp!.evaluate(async ({ webContents }) => {
            const harness = webContents
              .getAllWebContents()
              .find((contents) =>
                contents.getURL().startsWith('http://127.0.0.1:'),
              );
            return harness?.executeJavaScript(`
              document.querySelector('[data-dsh-desktop-update-button]')
                ?.getAttribute('aria-label')
            `);
          }),
        )
        .toMatch(/^(重启更新|Restart to update)$/);
      await electronApp.evaluate(({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        harness?.send('dsh-desktop:update-state', {
          status: 'latest',
          currentVersion: '0.1.0',
        });
      });
      await expect
        .poll(() =>
          electronApp!.evaluate(async ({ webContents }) => {
            const harness = webContents
              .getAllWebContents()
              .find((contents) =>
                contents.getURL().startsWith('http://127.0.0.1:'),
              );
            return harness?.executeJavaScript(`
              document.querySelector('[data-dsh-desktop-update-button]') === null
            `);
          }),
        )
        .toBe(true);

      await expect
        .poll(
          () =>
            shellPage!
              .locator('[data-testid="window-drag-region"]')
              .evaluate(() => ({
                scheme: document.documentElement.dataset.appearanceScheme,
                menuColor: window.getComputedStyle(
                  document.querySelector('[data-window-menu]')!,
                ).color,
                sidebar: document.documentElement.style.getPropertyValue(
                  '--toolbar-sidebar-background',
                ),
                content: document.documentElement.style.getPropertyValue(
                  '--toolbar-content-background',
                ),
              })),
          { timeout: 5_000 },
        )
        .toMatchObject({
          scheme: 'dark',
          menuColor: 'rgb(242, 244, 250)',
          sidebar: expect.stringMatching(/^rgb/),
          content: expect.stringMatching(/^rgb/),
        });

      const preferences = await electronApp.evaluate(({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        return (
          harness as unknown as {
            getLastWebPreferences(): Record<string, unknown>;
          }
        ).getLastWebPreferences();
      });
      expect(preferences).toMatchObject({
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      });

      // A Harness draft guard must never strand Cmd-Q / test teardown in a
      // native beforeunload prompt after the owned Runtime has stopped.
      await electronApp.evaluate(async ({ webContents }) => {
        const harness = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('http://127.0.0.1:'),
          );
        await harness?.executeJavaScript(`
          window.addEventListener('beforeunload', (event) => {
            event.preventDefault();
            event.returnValue = '';
          });
        `);
      });
      const applicationProcess = electronApp.process();
      const closeStartedAt = Date.now();
      await electronApp.close();
      expect(applicationProcess.exitCode).toBe(0);
      expect(Date.now() - closeStartedAt).toBeLessThan(20_000);
      electronApp = undefined;
    },
    testTimeoutMs,
  );
});
