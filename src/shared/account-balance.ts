export const ACCOUNT_BALANCE_REQUEST_CHANNEL =
  'deepseek-yukiryou:account-balance:request';
export const ACCOUNT_BALANCE_STATE_CHANNEL =
  'deepseek-yukiryou:account-balance:state';

export interface AccountBalanceAmount {
  readonly currency: 'CNY' | 'USD';
  readonly total: string;
  readonly granted: string;
  readonly toppedUp: string;
}

export type TodaySpendSnapshot =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready';
      readonly currency: 'CNY';
      readonly amount: string;
      readonly requestCount: number;
      readonly unpricedRequestCount: number;
      readonly partial: boolean;
      readonly since: string;
    };

export type ReadyAccountBalanceSnapshot = {
  readonly status: 'ready';
  readonly isAvailable: boolean;
  readonly balances: readonly AccountBalanceAmount[];
  readonly today: TodaySpendSnapshot;
  readonly fetchedAt: string;
  readonly stale: boolean;
};

export type AccountBalanceSnapshot =
  | { readonly status: 'loading' }
  | ReadyAccountBalanceSnapshot
  | {
      readonly status: 'unavailable';
      readonly reason:
        | 'credential-unconfigured'
        | 'credential-unauthorized'
        | 'rate-limited'
        | 'network'
        | 'invalid-response';
      readonly today: TodaySpendSnapshot;
      readonly lastGood?: ReadyAccountBalanceSnapshot;
    };

const DECIMAL = /^\d+(?:\.\d+)?$/;

export function validatedAccountBalanceSnapshot(
  value: unknown,
): AccountBalanceSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === 'loading') return { status: 'loading' };
  if (value.status === 'ready') return validatedReady(value);
  if (value.status !== 'unavailable' || !isReason(value.reason)) return undefined;
  const lastGood = value.lastGood === undefined ? undefined : validatedReady(value.lastGood);
  if (value.lastGood !== undefined && lastGood === undefined) return undefined;
  const today = validatedToday(value.today);
  if (today === undefined) return undefined;
  return lastGood === undefined
    ? { status: 'unavailable', reason: value.reason, today }
    : { status: 'unavailable', reason: value.reason, today, lastGood };
}

function validatedReady(value: unknown): ReadyAccountBalanceSnapshot | undefined {
  if (!isRecord(value) || value.status !== 'ready') return undefined;
  if (
    typeof value.isAvailable !== 'boolean' ||
    typeof value.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    typeof value.stale !== 'boolean' ||
    validatedToday(value.today) === undefined ||
    !Array.isArray(value.balances) ||
    value.balances.length > 2
  ) return undefined;
  const balances: AccountBalanceAmount[] = [];
  const currencies = new Set<string>();
  for (const amount of value.balances) {
    if (!isRecord(amount) || (amount.currency !== 'CNY' && amount.currency !== 'USD')) return undefined;
    if (currencies.has(amount.currency)) return undefined;
    const total = validatedDecimal(amount.total);
    const granted = validatedDecimal(amount.granted);
    const toppedUp = validatedDecimal(amount.toppedUp);
    if (total === undefined || granted === undefined || toppedUp === undefined) return undefined;
    currencies.add(amount.currency);
    balances.push({ currency: amount.currency, total, granted, toppedUp });
  }
  return {
    status: 'ready',
    isAvailable: value.isAvailable,
    balances,
    today: validatedToday(value.today) as TodaySpendSnapshot,
    fetchedAt: value.fetchedAt,
    stale: value.stale,
  };
}

function validatedToday(value: unknown): TodaySpendSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === 'unavailable') return { status: 'unavailable' };
  if (
    value.status !== 'ready' || value.currency !== 'CNY' ||
    validatedDecimal(value.amount) === undefined ||
    !Number.isSafeInteger(value.requestCount) || Number(value.requestCount) < 0 ||
    !Number.isSafeInteger(value.unpricedRequestCount) || Number(value.unpricedRequestCount) < 0 ||
    typeof value.partial !== 'boolean' ||
    typeof value.since !== 'string' || !Number.isFinite(Date.parse(value.since))
  ) return undefined;
  const requestCount = Number(value.requestCount);
  const unpricedRequestCount = Number(value.unpricedRequestCount);
  if (unpricedRequestCount > requestCount || value.partial !== (unpricedRequestCount > 0)) return undefined;
  return {
    status: 'ready', currency: 'CNY', amount: value.amount as string,
    requestCount, unpricedRequestCount, partial: value.partial, since: value.since,
  };
}

function isReason(value: unknown): value is Extract<AccountBalanceSnapshot, {status:'unavailable'}>['reason'] {
  return value === 'credential-unconfigured' || value === 'credential-unauthorized' || value === 'rate-limited' || value === 'network' || value === 'invalid-response';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedDecimal(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 64 && DECIMAL.test(value)
    ? value
    : undefined;
}
