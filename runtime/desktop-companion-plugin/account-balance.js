/* global AbortSignal, TextDecoder, fetch */

const AUTOMATIC_TTL_MS = 5 * 60 * 1000;
const MANUAL_TTL_MS = 30 * 1000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const API_URL = 'https://api.deepseek.com/user/balance';

const PRICE_PER_MILLION_CNY = new Map([
  ['deepseek-chat', { input: 3, cacheRead: 0.1, output: 9 }],
  ['deepseek-reasoner', { input: 3, cacheRead: 0.1, output: 9 }],
  ['deepseek-v4-flash', { input: 3, cacheRead: 0.1, output: 9 }],
  ['deepseek-v4-flash-vision-exp', { input: 3, cacheRead: 0.1, output: 9 }],
  ['deepseek-v4-pro', { input: 9, cacheRead: 0.3, output: 27 }],
]);
const DEEPSEEK_PROVIDER_IDS = new Set(['deepseek', 'deepseek-official']);
const SESSION_READ_CONCURRENCY = 4;
const BEIJING_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
});

export function createAccountBalance({ credentials, sessionQuery, fetchImpl = fetch, now = Date.now }) {
  let lastGood;
  let lastAttemptAt = 0;
  let inFlight;

  return {
    read({ force = false } = {}) {
      const age = now() - lastAttemptAt;
      const ttl = force ? MANUAL_TTL_MS : AUTOMATIC_TTL_MS;
      if (lastGood !== undefined && age < ttl) return Promise.resolve(lastGood);
      if (inFlight !== undefined) return inFlight;
      lastAttemptAt = now();
      inFlight = load().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };

  async function load() {
    const today = await estimateTodaySpend(sessionQuery, now());
    const credential = await credentials.resolve('DEEPSEEK_API_KEY');
    if (credential === undefined) return unavailable('credential-unconfigured', today);
    try {
      const response = await fetchImpl(API_URL, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json', authorization: `Bearer ${credential.value}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 401 || response.status === 403) return unavailable('credential-unauthorized', today);
      if (response.status === 429) return unavailable('rate-limited', today);
      if (!response.ok) return unavailable(response.status >= 500 ? 'network' : 'invalid-response', today);
      const payload = JSON.parse(await readBoundedBody(response));
      const ready = parseBalance(payload, new Date(now()).toISOString(), today);
      if (ready === undefined) return unavailable('invalid-response', today);
      lastGood = ready;
      return ready;
    } catch {
      return unavailable('network', today);
    }
  }

  function unavailable(reason, today) {
    return lastGood === undefined
      ? { status: 'unavailable', reason, today }
      : { status: 'unavailable', reason, today, lastGood: { ...lastGood, today, stale: true } };
  }
}

function parseBalance(value, fetchedAt, today) {
  if (!isRecord(value) || typeof value.is_available !== 'boolean' || !Array.isArray(value.balance_infos) || value.balance_infos.length > 2) return undefined;
  const balances = [];
  const currencies = new Set();
  for (const item of value.balance_infos) {
    if (!isRecord(item) || (item.currency !== 'CNY' && item.currency !== 'USD') || currencies.has(item.currency)) return undefined;
    const parts = [item.total_balance, item.granted_balance, item.topped_up_balance];
    if (!parts.every((part) => typeof part === 'string' && /^\d+(?:\.\d+)?$/.test(part) && part.length <= 64)) return undefined;
    currencies.add(item.currency);
    balances.push({ currency: item.currency, total: item.total_balance, granted: item.granted_balance, toppedUp: item.topped_up_balance });
  }
  return { status: 'ready', isAvailable: value.is_available, balances, today, fetchedAt, stale: false };
}

export async function estimateTodaySpend(sessionQuery, timestamp) {
  if (sessionQuery === undefined) return { status: 'unavailable' };
  const current = new Date(timestamp);
  const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
  try {
    const sessions = await sessionQuery.listSessions();
    let cost = 0;
    let requestCount = 0;
    let unpricedRequestCount = 0;
    await mapConcurrent(sessions, SESSION_READ_CONCURRENCY, async (record) => {
      const snapshot = await sessionQuery.readSession(record.header.id);
      for (const event of snapshot.events) {
        if (event.type !== 'assistant/message' || event.time < dayStart || event.time >= dayEnd) continue;
        const source = event.data?.message?.source;
        const usage = event.data?.usage;
        if (source?.kind !== 'model' || !DEEPSEEK_PROVIDER_IDS.has(source.provider) || !validUsage(usage)) continue;
        requestCount += 1;
        const peakPrice = PRICE_PER_MILLION_CNY.get(String(source.model).toLowerCase());
        if (peakPrice === undefined) {
          unpricedRequestCount += 1;
          continue;
        }
        const multiplier = isBeijingPeak(event.time) ? 1 : 0.5;
        cost += multiplier * (
          usage.inputTokens * peakPrice.input
          + (usage.cacheReadTokens ?? 0) * peakPrice.cacheRead
          + usage.outputTokens * peakPrice.output
        ) / 1_000_000;
      }
    });
    return {
      status: 'ready',
      currency: 'CNY',
      amount: decimalCost(cost),
      requestCount,
      unpricedRequestCount,
      partial: unpricedRequestCount > 0,
      since: new Date(dayStart).toISOString(),
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export function isBeijingPeak(timestamp) {
  const parts = Object.fromEntries(
    BEIJING_CLOCK.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return (minute >= 9 * 60 && minute < 12 * 60)
    || (minute >= 14 * 60 && minute < 18 * 60);
}

async function mapConcurrent(values, concurrency, task) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await task(values[index]);
    }
  }));
}

function validUsage(value) {
  return isRecord(value)
    && validTokens(value.inputTokens)
    && validTokens(value.outputTokens)
    && (value.cacheReadTokens === undefined || validTokens(value.cacheReadTokens));
}

function validTokens(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function decimalCost(value) {
  return value.toFixed(6).replace(/\.?0+$/, '') || '0';
}

async function readBoundedBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('response too large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('response too large');
  return new TextDecoder().decode(bytes);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
