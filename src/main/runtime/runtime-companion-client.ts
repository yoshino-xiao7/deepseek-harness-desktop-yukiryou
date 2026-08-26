import {
  type AccountBalanceSnapshot,
  validatedAccountBalanceSnapshot,
} from '../../shared/account-balance.js';
import { isAbsolute } from 'node:path';

const ROUTE = '/plugins/@dsh-desktop/companion/rpc';
const MAX_RESPONSE_BYTES = 32 * 1024;
const ACCOUNT_BALANCE_TIMEOUT_MS = 7_500;
const WORKSPACE_AUTHORIZATION_TIMEOUT_MS = 2_000;

export interface RuntimeCompanionClient {
  readAccountBalance(origin: string, force: boolean): Promise<AccountBalanceSnapshot>;
  authorizeWorkspace(
    origin: string,
    input: { readonly sessionId: string; readonly workspaceId?: string },
  ): Promise<WorkspaceAuthority | undefined>;
}

export interface WorkspaceAuthority {
  readonly workspaceId: string;
  readonly title: string;
  readonly root: string;
}

export function createRuntimeCompanionClient(token: string): RuntimeCompanionClient {
  return {
    async readAccountBalance(origin, force) {
      try {
        const response = await fetch(new URL(ROUTE, origin), {
          method: 'POST',
          redirect: 'error',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-dsh-desktop-companion-token': token,
          },
          body: JSON.stringify({ kind: 'account.balance', force }),
          signal: AbortSignal.timeout(ACCOUNT_BALANCE_TIMEOUT_MS),
        });
        if (!response.ok) return unavailableBalance();
        const body = await readBoundedBody(response, MAX_RESPONSE_BYTES);
        return validatedAccountBalanceSnapshot(JSON.parse(body)) ?? {
          status: 'unavailable', reason: 'invalid-response', today: { status: 'unavailable' },
        };
      } catch {
        return unavailableBalance();
      }
    },
    async authorizeWorkspace(origin, input) {
      try {
        const payload = await execute(origin, token, {
          kind: 'workspace.authorize',
          sessionId: input.sessionId,
          ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
        }, WORKSPACE_AUTHORIZATION_TIMEOUT_MS);
        if (!isRecord(payload) || payload.status !== 'authorized') return undefined;
        if (
          typeof payload.workspaceId !== 'string' || payload.workspaceId.length > 128 ||
          typeof payload.title !== 'string' || payload.title.length === 0 || payload.title.length > 200 ||
          typeof payload.root !== 'string' || payload.root.length > 4_096 || !isAbsolute(payload.root)
        ) return undefined;
        return { workspaceId: payload.workspaceId, title: payload.title, root: payload.root };
      } catch {
        return undefined;
      }
    },
  };
}

function unavailableBalance(): AccountBalanceSnapshot {
  return { status: 'unavailable', reason: 'network', today: { status: 'unavailable' } };
}

async function execute(
  origin: string,
  token: string,
  request: unknown,
  timeoutMs = 5_000,
): Promise<unknown> {
  const response = await fetch(new URL(ROUTE, origin), {
    method: 'POST', redirect: 'error',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-dsh-desktop-companion-token': token },
    body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('companion request failed');
  return JSON.parse(await readBoundedBody(response, MAX_RESPONSE_BYTES));
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('response too large');
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
