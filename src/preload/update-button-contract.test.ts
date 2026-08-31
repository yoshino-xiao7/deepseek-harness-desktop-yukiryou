import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('homepage update button contract', () => {
  it('uses a download arrow and exposes native download progress accessibly', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain('button.replaceChildren(createUpdateIcon(), ...progressLabel)');
    expect(source).toContain('M10 3.5v9.2m0 0 3.6-3.6M10 12.7 6.4 9.1M4 16.5h12');
    expect(source).toContain('createUpdateProgressLabel(downloadPercent)');
    expect(source).toContain('正在下载更新 ${String(downloadPercent)}%');
    expect(source).not.toContain('dsh-desktop-header-update-label');
    expect(source).toMatch(
      /case 'downloaded': return english \? 'Restart to update' : '重启更新'/,
    );
  });
});
