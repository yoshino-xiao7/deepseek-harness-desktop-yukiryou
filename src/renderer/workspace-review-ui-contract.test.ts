import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('workspace review UI contract', () => {
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
});
