import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

type CompanionModule = {
  createRuntimeHealthProof(secret: unknown, nonce: unknown): string | undefined;
  monitorDesktopOwner(
    ownerPid: unknown,
    options?: {
      readParentPid?: () => number;
      terminate?: () => void;
      intervalMs?: number;
    },
  ): () => void;
};

describe('Runtime ownership proof', () => {
  it('binds a fixed-length nonce to the per-start secret', async () => {
    const { createRuntimeHealthProof } = await loadModule();
    const secret = 'runtime-health-secret-that-is-at-least-32-bytes';
    const nonce = Buffer.alloc(32, 7).toString('base64url');

    expect(createRuntimeHealthProof(secret, nonce)).toBe(
      createHmac('sha256', secret).update(nonce).digest('base64url'),
    );
    expect(createRuntimeHealthProof('too-short', nonce)).toBeUndefined();
    expect(createRuntimeHealthProof(secret, '../invalid')).toBeUndefined();
  });

  it('terminates an orphaned Runtime after its desktop parent changes', async () => {
    const { monitorDesktopOwner } = await loadModule();
    const terminate = vi.fn();
    const dispose = monitorDesktopOwner('4321', {
      readParentPid: () => 1,
      terminate,
      intervalMs: 5,
    });

    await delay(20);

    expect(terminate).toHaveBeenCalled();
    dispose();
  });
});

async function loadModule(): Promise<CompanionModule> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), 'runtime', 'desktop-companion-plugin', 'index.js'),
  ).href;
  return import(`${moduleUrl}?test=${String(Date.now())}`) as Promise<CompanionModule>;
}
