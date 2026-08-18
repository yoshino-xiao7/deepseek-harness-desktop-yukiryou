import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

describe('Runtime account balance module', () => {
  it('maps the official response and coalesces concurrent reads', async () => {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'runtime', 'desktop-companion-plugin', 'account-balance.js')).href;
    const { createAccountBalance } = await import(moduleUrl) as {
      createAccountBalance(options: Record<string, unknown>): { read(): Promise<unknown> };
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '12.30', granted_balance: '2.30', topped_up_balance: '10.00' }],
    }), { headers: { 'content-type': 'application/json' } }));
    const balance = createAccountBalance({
      credentials: { resolve: vi.fn(async () => ({ value: 'secret', source: 'test' })) },
      fetchImpl,
      now: () => 1_700_000_000_000,
    });

    const [left, right] = await Promise.all([balance.read(), balance.read()]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({ status: 'ready', balances: [{ total: '12.30' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not contact the API when the credential is absent', async () => {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'runtime', 'desktop-companion-plugin', 'account-balance.js')).href;
    const { createAccountBalance } = await import(moduleUrl) as {
      createAccountBalance(options: Record<string, unknown>): { read(): Promise<unknown> };
    };
    const fetchImpl = vi.fn();
    const balance = createAccountBalance({ credentials: { resolve: async () => undefined }, fetchImpl });
    await expect(balance.read()).resolves.toEqual({ status: 'unavailable', reason: 'credential-unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
