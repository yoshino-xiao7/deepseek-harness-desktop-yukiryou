import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('homepage update button contract', () => {
  it('keeps the existing sidebar control compact while exposing the action accessibly', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain('button.replaceChildren(createUpdateIcon())');
    expect(source).not.toContain('dsh-desktop-header-update-label');
    expect(source).toMatch(
      /case 'downloading': return english \? 'Downloading update' : '正在下载更新'/,
    );
    expect(source).toMatch(
      /case 'downloaded': return english \? 'Restart to update' : '重启更新'/,
    );
    expect(source).not.toMatch(
      /data-update-status="(?:downloading|downloaded)"[^}]+width:\s*max-content/s,
    );
  });
});
