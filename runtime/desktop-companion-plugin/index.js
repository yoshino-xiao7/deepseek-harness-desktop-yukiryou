/* global Buffer, process */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { clearInterval, setInterval } from 'node:timers';

const ROUTE = '/plugins/@dsh-desktop/companion/rpc';
const TOKEN_HEADER = 'x-dsh-desktop-companion-token';
const MAX_REQUEST_BYTES = 4 * 1024;

export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx) {
  const expectedToken = process.env.DSH_DESKTOP_COMPANION_TOKEN ?? '';
  ctx.effect(
    () => monitorDesktopOwner(process.env.DSH_DESKTOP_OWNER_PID),
    'deepseek-yukiryou: desktop owner watchdog',
  );
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (request, response) => {
        response.setHeader('cache-control', 'no-store');
        if (request.method !== 'POST') return end(response, 405);
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return end(response, 415);
        try {
          const payload = JSON.parse(await readRequest(request));
          if (!isRecord(payload)) return end(response, 400);
          if (payload.kind === 'runtime.health') {
            const proof = createRuntimeHealthProof(expectedToken, payload.nonce);
            return proof === undefined
              ? end(response, 403)
              : endJson(response, 200, { status: 'ready', proof });
          }
          if (!authorized(expectedToken, request.headers[TOKEN_HEADER])) return end(response, 403);
          const snapshot = payload.kind === 'workspace.authorize'
              ? await authorizeWorkspace(ctx.workspaceRegistry, payload)
              : undefined;
          if (snapshot === undefined) return end(response, 400);
          return endJson(response, 200, snapshot);
        } catch {
          return end(response, 400);
        }
      },
    }),
    'deepseek-yukiryou: authenticated companion rpc',
  );
}

export function monitorDesktopOwner(ownerPidValue, options = {}) {
  const ownerPid = Number(ownerPidValue);
  if (!Number.isInteger(ownerPid) || ownerPid <= 1) return () => undefined;
  const readParentPid = options.readParentPid ?? (() => process.ppid);
  const terminate = options.terminate ?? (() => process.exit(0));
  const intervalMs = options.intervalMs ?? 250;
  const timer = setInterval(() => {
    if (readParentPid() !== ownerPid) terminate();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function createRuntimeHealthProof(secret, nonce) {
  if (
    typeof secret !== 'string' ||
    secret.length < 32 ||
    typeof nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce)
  ) return undefined;
  return createHmac('sha256', secret).update(nonce).digest('base64url');
}

export async function authorizeWorkspace(registry, payload) {
  if (!validId(payload.sessionId) || (payload.workspaceId !== undefined && !validId(payload.workspaceId))) return undefined;
  const workspace = payload.workspaceId === undefined
    ? registry.list().find((candidate) => candidate.sessionIds.includes(payload.sessionId))
    : registry.get(payload.workspaceId);
  if (workspace === undefined || !workspace.sessionIds.includes(payload.sessionId)) return { status: 'unavailable' };
  if (await workspace.status() !== 'ok') return { status: 'unavailable' };
  return { status: 'authorized', workspaceId: workspace.id, title: workspace.title, root: workspace.path };
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function authorized(expected, actual) {
  if (expected.length < 32 || Array.isArray(actual) || typeof actual !== 'string') return false;
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(actual).digest();
  return timingSafeEqual(left, right);
}

async function readRequest(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('request too large');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_REQUEST_BYTES) throw new Error('request too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function end(response, status) {
  response.writeHead(status);
  response.end();
}

function endJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
