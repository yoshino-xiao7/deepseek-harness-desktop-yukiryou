import { describe, expect, it, vi } from 'vitest';

interface RuntimeSnapshotReader {
  read(): Promise<{ readonly hash: string; readonly packages: readonly { readonly name: string; readonly version: string }[] }>;
}

async function createReader(readLock: () => unknown): Promise<RuntimeSnapshotReader> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/runtime-snapshot.js', import.meta.url).href
  ) as { readonly createRuntimeSnapshot: (options: Record<string, unknown>) => RuntimeSnapshotReader };
  return module.createRuntimeSnapshot({ readLock });
}

async function createDefaultReader(): Promise<RuntimeSnapshotReader> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/runtime-snapshot.js', import.meta.url).href
  ) as { readonly createRuntimeSnapshot: () => RuntimeSnapshotReader };
  return module.createRuntimeSnapshot();
}

describe('desktop market Runtime compatibility snapshot', () => {
  it('reads the lockfile shipped beside the desktop market plugin', async () => {
    const result = await (await createDefaultReader()).read();

    expect(result.packages).toContainEqual(expect.objectContaining({ name: '@deepseek-ai/dsh-agent' }));
    expect(result.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('publishes only top-level package names and exact versions with a deterministic hash', async () => {
    const reader = await createReader(() => ({
      lockfileVersion: 3,
      packages: {
        '': { name: 'runtime' },
        'node_modules/react': { version: '18.3.1', resolved: 'https://registry.example/react.tgz' },
        'node_modules/@deepseek-ai/dsh-agent': { version: '0.1.0-rc.8', integrity: 'secret' },
        'node_modules/parent/node_modules/nested': { version: '1.0.0' },
      },
    }));
    const result = await reader.read();

    expect(result.packages).toEqual([
      { name: '@deepseek-ai/dsh-agent', version: '0.1.0-rc.8' },
      { name: 'react', version: '18.3.1' },
    ]);
    expect(result.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('registry.example');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('coalesces reads and retries after a failed read', async () => {
    const readLock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ lockfileVersion: 3, packages: { 'node_modules/react': { version: '18.3.1' } } });
    const reader = await createReader(readLock);
    await expect(reader.read()).rejects.toThrow('temporary');
    const [first, second] = await Promise.all([reader.read(), reader.read()]);
    expect(first).toBe(second);
    expect(readLock).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported locks and invalid package versions', async () => {
    const unsupported = await createReader(() => ({ lockfileVersion: 2, packages: {} }));
    await expect(unsupported.read()).rejects.toMatchObject({ code: 'catalog:runtime-snapshot-invalid' });
    const invalid = await createReader(() => ({
      lockfileVersion: 3, packages: { 'node_modules/react': { version: 'latest' } },
    }));
    await expect(invalid.read()).rejects.toMatchObject({ code: 'catalog:runtime-snapshot-invalid' });
  });
});
