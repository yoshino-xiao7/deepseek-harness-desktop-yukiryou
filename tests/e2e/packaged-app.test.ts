import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

const targetArchitecture = process.env.DSH_E2E_ARCH ?? process.arch;
const executablePath = join(
  process.cwd(),
  'out',
  `DeepSeek YukiRyou-darwin-${targetArchitecture}`,
  'DeepSeek YukiRyou.app',
  'Contents',
  'MacOS',
  'DeepSeek YukiRyou',
);

describe('packaged desktop application', () => {
  let electronApp: ElectronApplication | undefined;

  afterEach(async () => {
    await electronApp?.close();
  });

  it(
    'opens the bundled Harness UI without exposing Electron privileges',
    async () => {
      const userData = await mkdtemp(join(tmpdir(), 'dsh-desktop-e2e-'));
      electronApp = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userData}`],
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

      await expect
        .poll(
          () =>
            electronApp?.evaluate(({ webContents }) =>
              webContents
                .getAllWebContents()
                .map((contents) => contents.getURL())
                .find((url) => url.startsWith('http://127.0.0.1:')),
            ),
          { timeout: 20_000 },
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
                developerHref: dialog.querySelector(
                  '.dsh-desktop-about-developer',
                )?.getAttribute('href'),
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
      expect(settingsResult?.aboutLogoLoaded).toBe(true);
      expect(settingsResult?.developerHref).toBe(
        'https://github.com/yoshino-xiao7',
      );
      expect(settingsResult?.aboutText).toContain('DeepSeek YukiRyou');
      expect(settingsResult?.aboutText).toContain('0.1.0-rc.6');
      expect(settingsResult?.aboutText).toMatch(/Apple Silicon.*arm64/);

      await expect
        .poll(
          () =>
            shellPage!
              .locator('[data-testid="window-drag-region"]')
              .evaluate(() => ({
                scheme: document.documentElement.dataset.appearanceScheme,
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
    },
    45_000,
  );
});
