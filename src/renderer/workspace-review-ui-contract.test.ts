import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('workspace review UI contract', () => {
  it('provides a Windows-only localized menu inside the draggable 44px caption', async () => {
    const [html, styles, renderer] = await Promise.all([
      readFile(new URL('./index.html', import.meta.url), 'utf8'),
      readFile(new URL('./styles.css', import.meta.url), 'utf8'),
      readFile(new URL('./index.ts', import.meta.url), 'utf8'),
    ]);

    expect(html).toMatch(/data-testid="windows-menu"[^>]+hidden/);
    expect(html).toMatch(/data-window-menu="file">文件/);
    expect(styles).toMatch(/\.window-toolbar\s*\{[^}]*height:\s*44px/s);
    expect(styles).toMatch(/\.windows-menu\s*\{[^}]*-webkit-app-region:\s*no-drag/s);
    expect(styles).toMatch(
      /--toolbar-foreground:\s*var\(--harness-foreground\)/s,
    );
    expect(styles).toMatch(
      /\.windows-menu button\s*\{[^}]*var\(--toolbar-foreground\)/s,
    );
    expect(renderer).toContain("windowBridge?.openMenu");
  });

  it('uses a semantic SVG refresh icon instead of a CSS-drawn control', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

    expect(html).toMatch(
      /data-testid="review-refresh"[\s\S]*?<svg[^>]+class="review-refresh-glyph"/,
    );
  });

  it('wraps long diff lines without producing per-row max-content gaps', async () => {
    const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.diff-row\s*\{[^}]*min-width:\s*0/s);
    expect(styles).toMatch(/\.diff-code\s*\{[^}]*white-space:\s*pre-wrap/s);
    expect(styles).toMatch(/\.diff-code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(styles).not.toMatch(/\.diff-row\s*\{[^}]*min-width:\s*max-content/s);
  });

  it('exposes an accessible resizer and one panel-width layout token', async () => {
    const [html, styles] = await Promise.all([
      readFile(new URL('./index.html', import.meta.url), 'utf8'),
      readFile(new URL('./styles.css', import.meta.url), 'utf8'),
    ]);

    expect(html).toMatch(/data-testid="companion-resizer"[\s\S]*?role="separator"/);
    expect(styles).toMatch(/--companion-panel-width:\s*340px/);
    expect(styles).toMatch(/\.companion-panel\s*\{[^}]*var\(--companion-panel-width\)/s);
    expect(styles).toMatch(/\.preview-panel\s*\{[^}]*var\(--companion-panel-width\)/s);
  });

  it('provides one query surface for file search and change filtering', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

    expect(html).toMatch(/data-testid="review-search"/);
    expect(html).toMatch(/data-testid="change-filter"/);
    expect(html).toMatch(/<option value="staged">已暂存<\/option>/);
    expect(html).toMatch(/<option value="conflicted">冲突<\/option>/);
  });

  it('provides accessible back and forward preview navigation', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

    expect(html).toMatch(/data-testid="preview-back"[^>]+aria-label="后退"/);
    expect(html).toMatch(/data-testid="preview-forward"[^>]+aria-label="前进"/);
    expect(html).toMatch(/data-testid="review-search"[\s\S]*?aria-keyshortcuts="Meta\+P Control\+P"/);
    expect(html).toMatch(/data-testid="preview-close"[^>]+aria-keyshortcuts="Escape"/);
  });

  it('provides explicit sequential review controls and progress', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

    expect(html).toMatch(/data-testid="preview-review-bar"[^>]+aria-label="逐文件审阅"/);
    expect(html).toMatch(/data-testid="review-previous"[^>]+aria-label="上一个变更"/);
    expect(html).toMatch(/data-testid="review-toggle-viewed"/);
    expect(html).toMatch(/data-testid="review-next"[^>]+aria-label="下一个变更"/);
  });

  it('provides accessible in-preview find controls', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

    expect(html).toMatch(/data-testid="preview-find-toggle"[^>]+aria-keyshortcuts="Meta\+F Control\+F"/);
    expect(html).toMatch(/data-testid="preview-find-input"[^>]+aria-label="查找文本"/);
    expect(html).toMatch(/data-testid="preview-find-previous"[^>]+aria-label="上一个匹配项"/);
    expect(html).toMatch(/data-testid="preview-find-next"[^>]+aria-label="下一个匹配项"/);
    expect(html).toMatch(/data-testid="preview-find-progress"[^>]+aria-live="polite"/);
  });

  it('provides a line-aware preview copy menu', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

    expect(html).toMatch(/data-testid="preview-copy-menu"/);
    expect(html).toMatch(/data-copy-target="path">复制相对路径/);
    expect(html).toMatch(/data-copy-target="line" disabled>复制行号/);
    expect(html).toMatch(/data-copy-target="path-line" disabled>复制 路径:行号/);
    expect(html).toMatch(/data-testid="preview-copy-feedback"[^>]+aria-live="polite"/);
    expect(html).toMatch(/data-testid="preview-copy-menu"[\s\S]*?<span>复制<\/span>/);
  });

  it('gives body-level workspace overlays the synchronized Harness foreground', async () => {
    const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /--companion-overlay-foreground:\s*var\(--harness-foreground\)/s,
    );
    expect(styles).toMatch(
      /\.workspace-context-menu button\s*\{[^}]*color:\s*var\(--companion-overlay-foreground\)/s,
    );
  });

  it('consumes the live Harness semantic theme and keeps copy feedback prominent', async () => {
    const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/--companion-foreground:\s*var\(--harness-foreground\)/);
    expect(styles).toMatch(/--companion-accent:\s*var\(--harness-accent\)/);
    expect(styles).toMatch(/\.preview-copy-feedback\s*\{[^}]*color:\s*var\(--harness-accent-foreground\)/s);
    expect(styles).toMatch(/\.preview-copy-feedback\s*\{[^}]*background:\s*var\(--companion-accent\)/s);
    expect(styles).toMatch(/\.preview-copy-popover\s*\{[^}]*background:\s*var\(--harness-overlay-background\)/s);
  });
});
