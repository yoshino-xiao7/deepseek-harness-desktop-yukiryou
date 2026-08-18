/* global Buffer, process */

import { createHash, timingSafeEqual } from 'node:crypto';

import { createAccountBalance } from './account-balance.js';

const ROUTE = '/plugins/@dsh-desktop/companion/rpc';
const TOKEN_HEADER = 'x-dsh-desktop-companion-token';
const MAX_REQUEST_BYTES = 4 * 1024;

export const inject = ['webServer', 'credentials', 'workspaceRegistry'];

export function apply(ctx) {
  const expectedToken = process.env.DSH_DESKTOP_COMPANION_TOKEN ?? '';
  const accountBalance = createAccountBalance({ credentials: ctx.credentials });
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (request, response) => {
        response.setHeader('cache-control', 'no-store');
        if (request.method !== 'POST') return end(response, 405);
        if (!authorized(expectedToken, request.headers[TOKEN_HEADER])) return end(response, 403);
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return end(response, 415);
        try {
          const payload = JSON.parse(await readRequest(request));
          if (!isRecord(payload)) return end(response, 400);
          const snapshot = payload.kind === 'account.balance'
            ? await readBalance(accountBalance, payload)
            : payload.kind === 'workspace.authorize'
              ? await authorizeWorkspace(ctx.workspaceRegistry, payload)
              : undefined;
          if (snapshot === undefined) return end(response, 400);
          const body = JSON.stringify(snapshot);
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
          response.end(body);
        } catch {
          end(response, 400);
        }
      },
    }),
    'deepseek-yukiryou: authenticated companion rpc',
  );
}

async function readBalance(accountBalance, payload) {
  if (payload.force !== undefined && typeof payload.force !== 'boolean') return undefined;
  return accountBalance.read({ force: payload.force === true });
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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
