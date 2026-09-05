import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('homepage update button contract', () => {
  it('uses the official footer slot instead of an overlapping fixed overlay', async () => {
    const preload = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const client = await readFile(new URL('../../runtime/desktop-settings-plugin/client.js', import.meta.url), 'utf8');
    expect(preload).not.toContain('positionHarnessUpdateButton');
    expect(client).toContain("name: 'sidebar.footer.action', id: 'desktop-update'");
    expect(client).toContain('prefers-reduced-motion');
    expect(client).toContain('M10 3.5v9.2m0 0 3.6-3.6M10 12.7 6.4 9.1M4 16.5h12');
  });
});
