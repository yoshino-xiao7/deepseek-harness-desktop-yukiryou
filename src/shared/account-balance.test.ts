import { describe, expect, it } from 'vitest';

import { validatedAccountBalanceSnapshot } from './account-balance.js';

describe('account balance snapshot boundary', () => {
  it('accepts bounded currency amounts without converting decimals', () => {
    expect(validatedAccountBalanceSnapshot({
      status: 'ready', isAvailable: true, fetchedAt: '2026-08-18T00:00:00.000Z', stale: false,
      balances: [{ currency: 'CNY', total: '0.10', granted: '0.00', toppedUp: '0.10' }],
    })).toMatchObject({ balances: [{ total: '0.10' }] });
  });

  it('rejects duplicate currencies and non-decimal payloads', () => {
    const amount = { currency: 'USD', total: '1e9', granted: '0', toppedUp: '1' };
    expect(validatedAccountBalanceSnapshot({
      status: 'ready', isAvailable: true, fetchedAt: '2026-08-18T00:00:00.000Z', stale: false,
      balances: [amount, amount],
    })).toBeUndefined();
  });
});
