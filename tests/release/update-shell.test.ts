import { describe, expect, it, vi } from 'vitest';

import {
  waitForUpdateShell,
  type UpdateShellCandidate,
} from './update-shell.js';

describe('waitForUpdateShell', () => {
  it('selects the desktop shell instead of the first unrelated window', async () => {
    const unrelated = candidate('http://127.0.0.1:50981/', [false]);
    const shell = candidate('file:///desktop/index.html', [true]);

    await expect(waitForUpdateShell(
      { windows: () => [unrelated, shell] },
      { maxAttempts: 1, intervalMs: 0 },
    )).resolves.toBe(shell);
  });

  it('waits for the preload bridge and reports inspected window URLs', async () => {
    const shell = candidate('file:///desktop/index.html', [false, true]);
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(waitForUpdateShell(
      { windows: () => [shell] },
      { maxAttempts: 2, intervalMs: 0, delay },
    )).resolves.toBe(shell);
    expect(delay).toHaveBeenCalledOnce();

    await expect(waitForUpdateShell(
      { windows: () => [candidate('about:blank', [false])] },
      { maxAttempts: 1, intervalMs: 0 },
    )).rejects.toThrow('about:blank');
  });
});

function candidate(
  url: string,
  bridgeResults: boolean[],
): UpdateShellCandidate {
  let call = 0;
  return {
    url: () => url,
    evaluate: async () => bridgeResults[Math.min(call++, bridgeResults.length - 1)] ?? false,
  };
}
