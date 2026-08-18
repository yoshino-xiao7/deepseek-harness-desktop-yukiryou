/* global AbortSignal, TextDecoder, fetch */

const AUTOMATIC_TTL_MS = 5 * 60 * 1000;
const MANUAL_TTL_MS = 30 * 1000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const API_URL = 'https://api.deepseek.com/user/balance';

export function createAccountBalance({ credentials, fetchImpl = fetch, now = Date.now }) {
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
    const credential = await credentials.resolve('DEEPSEEK_API_KEY');
    if (credential === undefined) return unavailable('credential-unconfigured');
    try {
      const response = await fetchImpl(API_URL, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json', authorization: `Bearer ${credential.value}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 401 || response.status === 403) return unavailable('credential-unauthorized');
      if (response.status === 429) return unavailable('rate-limited');
      if (!response.ok) return unavailable(response.status >= 500 ? 'network' : 'invalid-response');
      const payload = JSON.parse(await readBoundedBody(response));
      const ready = parseBalance(payload, new Date(now()).toISOString());
      if (ready === undefined) return unavailable('invalid-response');
      lastGood = ready;
      return ready;
    } catch {
      return unavailable('network');
    }
  }

  function unavailable(reason) {
    return lastGood === undefined
      ? { status: 'unavailable', reason }
      : { status: 'unavailable', reason, lastGood: { ...lastGood, stale: true } };
  }
}

function parseBalance(value, fetchedAt) {
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
  return { status: 'ready', isAvailable: value.is_available, balances, fetchedAt, stale: false };
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
