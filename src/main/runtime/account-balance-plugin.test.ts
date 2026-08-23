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
      sessionQuery: { listSessions: async () => [], readSession: async () => ({ events: [] }) },
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
    await expect(balance.read()).resolves.toEqual({
      status: 'unavailable', reason: 'credential-unconfigured', today: { status: 'unavailable' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aggregates local DeepSeek usage for the current local day and marks unpriced models', async () => {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'runtime', 'desktop-companion-plugin', 'account-balance.js')).href;
    const { estimateTodaySpend, isBeijingPeak } = await import(moduleUrl) as {
      estimateTodaySpend(query: unknown, now: number): Promise<unknown>;
      isBeijingPeak(now: number): boolean;
    };
    const now = new Date(2026, 7, 23, 12, 0, 0).getTime();
    const today = new Date(2026, 7, 23, 9, 0, 0).getTime();
    const yesterday = new Date(2026, 7, 22, 23, 0, 0).getTime();
    const message = (model: string, time: number) => ({
      type: 'assistant/message', time,
      data: {
        message: { source: { kind: 'model', provider: 'deepseek', model } },
        usage: { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 },
      },
    });
    const result = await estimateTodaySpend({
      listSessions: async () => [{ header: { id: 'one' } }],
      readSession: async () => ({ events: [
        message('deepseek-chat', today),
        message('DeepSeek-V4-Flash-Vision-Exp', today),
        message('unpriced-future-model', today),
        message('deepseek-v4-pro', yesterday),
      ] }),
    }, now);
    expect(result).toMatchObject({
      status: 'ready', amount: '12.1', requestCount: 3,
      unpricedRequestCount: 1, partial: true,
    });
    expect(isBeijingPeak(Date.parse('2026-08-24T01:00:00.000Z'))).toBe(true);
    expect(isBeijingPeak(Date.parse('2026-08-24T04:00:00.000Z'))).toBe(false);
    expect(isBeijingPeak(Date.parse('2026-08-24T06:00:00.000Z'))).toBe(true);
    expect(isBeijingPeak(Date.parse('2026-08-24T10:00:00.000Z'))).toBe(false);
    expect(isBeijingPeak(Date.parse('2026-08-23T02:00:00.000Z'))).toBe(false);
  });
});
