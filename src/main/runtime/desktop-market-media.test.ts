import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

interface MediaProxy {
  register(url: unknown): { readonly icon: string } | undefined;
  read(token: string): Promise<{ readonly bytes: Buffer; readonly contentType: string }>;
}

async function createProxy(options: Record<string, unknown> = {}): Promise<MediaProxy> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/media.js', import.meta.url).href
  ) as { readonly createMediaProxy: (options?: Record<string, unknown>) => MediaProxy };
  return module.createMediaProxy(options);
}

describe('desktop market media proxy', () => {
  it('turns a remote HTTPS URL into an opaque same-origin reference', async () => {
    const proxy = await createProxy();
    const media = proxy.register('https://avatars.githubusercontent.com/u/42?v=4');

    expect(media?.icon).toMatch(/^\/plugins\/@dsh-desktop\/market\/media\?id=[0-9a-f]{64}$/u);
    expect(media?.icon).not.toContain('githubusercontent');
    expect(proxy.register('http://127.0.0.1/icon.png')).toBeUndefined();
    expect(proxy.register('https://user:secret@example.com/icon.png')).toBeUndefined();
  });

  it('coalesces reads and keeps only normalized WebP bytes in its bounded cache', async () => {
    const requestImage = vi.fn(async () => ({ bytes: Buffer.from('remote'), contentType: 'image/png' }));
    const transform = vi.fn(async () => ({ bytes: Buffer.from('normalized'), contentType: 'image/webp' }));
    const proxy = await createProxy({ requestImage, transform });
    const media = proxy.register('https://cdn.example.com/icon.png');
    const token = new URL(media?.icon ?? '', 'http://localhost').searchParams.get('id') ?? '';

    const [first, concurrent] = await Promise.all([proxy.read(token), proxy.read(token)]);
    const cached = await proxy.read(token);
    expect(first.bytes.toString()).toBe('normalized');
    expect(concurrent).toBe(first);
    expect(cached).toBe(first);
    expect(requestImage).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledOnce();
  });

  it('rejects unknown tokens and invalid transformer output', async () => {
    const proxy = await createProxy({
      requestImage: async () => ({ bytes: Buffer.from('remote'), contentType: 'image/png' }),
      transform: async () => ({ bytes: Buffer.from('not-webp'), contentType: 'image/png' }),
    });
    await expect(proxy.read('a'.repeat(64))).rejects.toMatchObject({ code: 'catalog:not-found' });
    const media = proxy.register('https://cdn.example.com/icon.png');
    const token = new URL(media?.icon ?? '', 'http://localhost').searchParams.get('id') ?? '';
    await expect(proxy.read(token)).rejects.toMatchObject({ code: 'catalog:invalid-media' });
  });
});
