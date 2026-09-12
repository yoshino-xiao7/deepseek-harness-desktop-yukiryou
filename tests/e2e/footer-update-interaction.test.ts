import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';

const executablePath = process.env.DSH_BROWSER_EXECUTABLE ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath());

describe.skipIf(!existsSync(executablePath))('footer update browser interaction', () => {
  it.each([
    { width: 240, account: false }, { width: 280, account: false }, { width: 360, account: false },
    { width: 240, account: true }, { width: 280, account: true }, { width: 360, account: true },
  ])('keeps Settings and updates aligned at $width px, account=$account', async ({ width, account }) => {
    const source = await readFile(resolve('runtime/desktop-settings-plugin/client.js'), 'utf8');
    const sidebar = await readFile(resolve('resources/runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'), 'utf8');
    const settings = await readFile(resolve('resources/runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js'), 'utf8');
    // Exact version-scoped compatibility contract: do not silently accept a renamed upstream surface.
    expect(sidebar).toContain('hHd-Xa_footArea');
    expect(settings).toContain('VOzbGW_trigger');
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({ reducedMotion: 'no-preference', viewport: { width: width + 16, height: 160 } });
      await page.setContent(`<style>:root { --dsw-alias-label-primary:#542237; --dsw-alias-label-secondary:#a86783; --dsw-alias-bg-layer-1:#fff; --dsw-alias-border-l2:#efd3e0; --dsw-alias-interactive-bg-hover:#f4d3e2; } body { background:#f8edf3; } .hHd-Xa_root { width:${width}px; }</style>
        <div class="hHd-Xa_root"><div class="hHd-Xa_footArea"><div class="hHd-Xa_footerActions"><div data-slot="sidebar.footer.action" style="display:contents" id="updates">${account ? '<button class="dsh-deepseek-account-card" id="account"><span>◈</span><span>¥67.91</span><span>↻</span></button>' : ''}</div></div><div class="hHd-Xa_settingsArea"><div class="VOzbGW_triggerRow"><button class="VOzbGW_trigger" id="settings">设置</button></div></div></div>`);
      for (const vendor of [sidebar, settings]) {
        const styles = [...vendor.matchAll(/const css(?:\$\d+)? = ("(?:[^"\\]|\\.)*");/g)];
        expect(styles.length).toBeGreaterThan(0);
        for (const css of styles) await page.addStyleTag({ content: JSON.parse(css[1]!) as string });
      }
      await page.evaluate(() => {
        const state = { status: 'idle', currentVersion: '1.0.9', releaseName: '1.0.10', downloadPercent: 27 };
        const calls = { settings: 0, check: 0, install: 0, download: 0 };
        const registrations = new Map<string, (props: unknown) => Node>();
        const makeElement = (type: string | ((props: unknown) => Node), props: Record<string, unknown> | null, ...children: unknown[]) => {
          if (typeof type === 'function') return type(props);
          const node = ['svg', 'path'].includes(type) ? document.createElementNS('http://www.w3.org/2000/svg', type) : document.createElement(type);
          for (const [key, value] of Object.entries(props ?? {})) {
            if (key === 'onClick') node.addEventListener('click', value as EventListener);
            else if (key === 'onAnimationEnd') node.addEventListener('animationend', value as EventListener);
            else if (value !== undefined && value !== null) node.setAttribute(key === 'className' ? 'class' : key, String(value));
          }
          for (const child of children.flat()) {
            if (child instanceof Node) node.appendChild(child);
            else if (child !== false && child != null) node.appendChild(document.createTextNode(String(child)));
          }
          return node;
        };
        Object.assign(window, {
          fixtureCalls: calls, fixtureState: state, fixtureRegistrations: registrations,
          fixtureRender: () => {
            const node = registrations.get('desktop-update')!({ wide: !document.querySelector('.hHd-Xa_collapsed'), t: (key: string) => key });
            document.querySelector('[data-dsh-desktop-update-button]')?.remove();
            if (node) document.querySelector('#updates')!.appendChild(node);
          },
          deepSeekYukiRyouUpdates: { getSnapshot: () => state, subscribe: () => () => undefined,
            check: () => calls.check++, install: () => calls.install++, download: () => calls.download++ },
          __ModuleLoader__: { load: ({ factory }: { factory(require: () => unknown): { apply(ctx: unknown): void } }) => {
            factory(() => ({ createElement: makeElement, useState: (initial: () => unknown) => [initial(), () => undefined], useEffect: (effect: () => void) => effect() })).apply({
              effect: () => undefined, locale: { bind: () => (key: string) => key }, remote: {},
              slots: { inject: (_: string, callback: () => void) => callback(), register: (meta: { id: string }, component: (props: unknown) => Node) => registrations.set(meta.id, component) },
            });
          } },
        });
        document.querySelector('#settings')!.addEventListener('click', () => calls.settings++);
      });
      await page.addScriptTag({ content: source });
      // Account plugin 0.1.8 footer geometry, loaded after the desktop styles.
      // Its slot-level column rule also affects other registered footer actions.
      await page.addStyleTag({ content: `
        .dsh-deepseek-account-card { display:grid; width:100%; min-height:48px; margin:3px 0; padding:4px 3px; border:0; border-radius:8px; grid-template-columns:22px minmax(0,1fr) 16px; align-items:center; gap:10px; color:inherit; background:transparent; cursor:pointer; font:inherit; text-align:left; }
        div[data-slot="sidebar.footer.action"]:has(>.dsh-deepseek-account-card),div[data-slot="sidebar.footer.action"]:has(>.dsh-deepseek-account-rail) { display:flex!important; width:100%; min-width:0; flex-direction:column; }
        .dsh-deepseek-account-rail { display:grid; width:36px; height:36px; margin:4px auto; border:0; place-items:center; }
      ` });
      const render = async (status: string) => page.evaluate((status) => {
        const w = window as unknown as { fixtureState: { status: string }; fixtureRender(): void };
        w.fixtureState.status = status;
        w.fixtureRender();
      }, status);
      const update = page.locator('[data-dsh-desktop-update-button]');
      await render('idle');
      const fullWidth = (await page.locator('#settings').boundingBox())!.width;
      expect(await update.count()).toBe(0);
      await render('checking');
      expect(await update.count()).toBe(0);
      expect((await page.locator('#settings').boundingBox())!.width).toBe(fullWidth);
      await render('downloading');
      expect(await update.getAttribute('data-update-reveal')).toBe('entering');
      // Freeze the real CSS timelines: Settings yields space before the icon emerges.
      await page.evaluate(() => document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 160; }));
      expect(Number(await update.evaluate(node => getComputedStyle(node).opacity))).toBe(0);
      expect((await page.locator('#settings').boundingBox())!.width).toBeLessThan(fullWidth);
      await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 420; animation.play(); }));
      await page.waitForTimeout(50);
      await render('downloading');
      expect(await update.getAttribute('data-update-reveal')).toBe('settled');
      const assertLayout = async () => {
        const settingsBox = (await page.locator('#settings').boundingBox())!;
        const updateBox = (await update.boundingBox())!;
        const footerBox = (await page.locator('.hHd-Xa_footArea').boundingBox())!;
        expect(Math.abs(settingsBox.y + settingsBox.height / 2 - updateBox.y - updateBox.height / 2)).toBeLessThan(1);
        expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(updateBox.x);
        expect(updateBox.x + updateBox.width).toBeLessThanOrEqual(footerBox.x + footerBox.width + 1);
        expect(settingsBox.width).toBeGreaterThan(100);
        if (account) {
          const accountBox = (await page.locator('#account').boundingBox())!;
          expect(accountBox.y + accountBox.height).toBeLessThanOrEqual(settingsBox.y);
          expect(accountBox.width).toBeCloseTo(footerBox.width, 0);
        }
      };
      await mkdir(resolve('.cache/verification/footer-update'), { recursive: true });
      await page.screenshot({ path: resolve(`.cache/verification/footer-update/${width}-${account}.png`) });
      await assertLayout();
      await render('downloaded');
      expect(await update.getAttribute('data-update-reveal')).toBe('settled');
      await render('idle');
      expect((await page.locator('#settings').boundingBox())!.width).toBe(fullWidth);
      await render('downloading');
      expect(await update.getAttribute('data-update-reveal')).toBe('settled');
      const before = await update.evaluate(node => getComputedStyle(node).backgroundColor);
      await page.waitForTimeout(450);
      await update.hover();
      await page.waitForTimeout(180);
      expect(await update.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(before);
      await update.click({ force: true });
      await update.focus();
      await page.keyboard.press('Enter');
      expect(await update.getAttribute('title')).toContain('27%');
      const settingsButton = page.locator('#settings');
      await settingsButton.hover();
      await page.waitForTimeout(180);
      expect(await settingsButton.evaluate(node => getComputedStyle(node).transform)).not.toBe('none');
      const a = await settingsButton.boundingBox();
      const b = await update.boundingBox();
      expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
      await settingsButton.click();
      expect(await page.evaluate(() => (window as unknown as { fixtureCalls: unknown }).fixtureCalls)).toEqual({ settings: 1, check: 0, install: 0, download: 0 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await settingsButton.hover();
      expect(await settingsButton.evaluate(node => getComputedStyle(node).transform)).toBe('none');
      await assertLayout();
      for (const status of ['downloaded', 'manual', 'error', 'downloading']) {
        await page.evaluate(() => {
          const w = window as unknown as { fixtureState: { downloadPercent?: number } };
          delete w.fixtureState.downloadPercent;
        });
        await render(status);
        await assertLayout();
      }
      await page.evaluate(() => {
        (window as unknown as { fixtureState: { downloadPercent: number } }).fixtureState.downloadPercent = 100;
        document.querySelector('#settings')!.textContent = 'Settings';
      });
      await render('downloading');
      await assertLayout();
      await page.screenshot({ path: resolve(`.cache/verification/footer-update/${width}-${account}-100.png`) });
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.hHd-Xa_root')!;
        root.classList.add('hHd-Xa_collapsed');
        root.style.width = '64px';
        document.querySelector('.VOzbGW_triggerRow')!.classList.add('VOzbGW_railRow');
        document.querySelector('#settings')!.classList.add('VOzbGW_rail');
        document.querySelector('#settings')!.textContent = '⚙';
        const account = document.querySelector('#account');
        if (account) { account.className = 'dsh-deepseek-account-rail'; account.textContent = '◈'; }
      });
      await render('downloading');
      const railSettings = (await settingsButton.boundingBox())!;
      const railUpdate = (await update.boundingBox())!;
      const rail = (await page.locator('.hHd-Xa_root').boundingBox())!;
      expect(await update.getAttribute('data-wide')).toBe('false');
      expect(railSettings.y + railSettings.height).toBeLessThanOrEqual(railUpdate.y);
      expect(Math.abs(railSettings.x + railSettings.width / 2 - railUpdate.x - railUpdate.width / 2)).toBeLessThan(1);
      expect(railUpdate.x).toBeGreaterThanOrEqual(rail.x);
      expect(railUpdate.x + railUpdate.width).toBeLessThanOrEqual(rail.x + rail.width);
      await page.screenshot({ path: resolve(`.cache/verification/footer-update/${width}-${account}-collapsed.png`) });
    } finally { await browser.close(); }
  }, 90000);
});
