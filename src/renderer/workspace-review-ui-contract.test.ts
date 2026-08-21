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
});
