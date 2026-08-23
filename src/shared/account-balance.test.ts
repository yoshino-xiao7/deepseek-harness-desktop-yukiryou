import { describe, expect, it } from 'vitest';

import { validatedAccountBalanceSnapshot } from './account-balance.js';

describe('account balance snapshot boundary', () => {
  it('accepts bounded currency amounts without converting decimals', () => {
    expect(validatedAccountBalanceSnapshot({
      status: 'ready', isAvailable: true, fetchedAt: '2026-08-18T00:00:00.000Z', stale: false,
      today: { status: 'ready', currency: 'CNY', amount: '0.12', requestCount: 2, unpricedRequestCount: 0, partial: false, since: '2026-08-18T00:00:00.000Z' },
      balances: [{ currency: 'CNY', total: '0.10', granted: '0.00', toppedUp: '0.10' }],
    })).toMatchObject({ balances: [{ total: '0.10' }] });
  });

  it('rejects duplicate currencies and non-decimal payloads', () => {
    const amount = { currency: 'USD', total: '1e9', granted: '0', toppedUp: '1' };
    expect(validatedAccountBalanceSnapshot({
      status: 'ready', isAvailable: true, fetchedAt: '2026-08-18T00:00:00.000Z', stale: false,
      today: { status: 'unavailable' },
      balances: [amount, amount],
    })).toBeUndefined();
  });

  it('rejects inconsistent partial-cost metadata', () => {
    expect(validatedAccountBalanceSnapshot({
      status: 'unavailable', reason: 'network',
      today: { status: 'ready', currency: 'CNY', amount: '1', requestCount: 1, unpricedRequestCount: 1, partial: false, since: '2026-08-18T00:00:00.000Z' },
    })).toBeUndefined();
  });
});
