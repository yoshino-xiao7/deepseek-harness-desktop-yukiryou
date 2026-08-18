import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export type StableFileRead =
  | { readonly kind: 'data'; readonly data: Buffer; readonly revision: string }
  | { readonly kind: 'too-large' | 'unsafe-type' | 'file-changed' | 'io-error' };

export type StableFileRevision =
  | { readonly kind: 'revision'; readonly revision: string }
  | { readonly kind: 'unsafe-type' | 'io-error' };

export async function stableRegularFileRevision(path: string): Promise<StableFileRevision> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const status = await handle.stat({ bigint: true });
    return status.isFile()
      ? { kind: 'revision', revision: revisionKey(status) }
      : { kind: 'unsafe-type' };
  } catch (error) {
    const code = errorCode(error);
    return { kind: code === 'ELOOP' || code === 'EISDIR' ? 'unsafe-type' : 'io-error' };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readStableRegularFile(path: string, maxBytes: number): Promise<StableFileRead> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) return { kind: 'unsafe-type' };
    if (before.size > BigInt(maxBytes)) return { kind: 'too-large' };
    const data = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameRevision(before, after) || data.byteLength > maxBytes) return { kind: 'file-changed' };
    return { kind: 'data', data, revision: revisionKey(after) };
  } catch (error) {
    const code = errorCode(error);
    return code === 'ELOOP' || code === 'EISDIR' ? { kind: 'unsafe-type' } : { kind: 'io-error' };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function revisionKey(status: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>): string {
  return [status.dev, status.ino, status.size, status.mtimeMs, status.ctimeMs].join(':');
}

function sameRevision(
  before: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
  after: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
