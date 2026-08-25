import { describe, expect, it, vi } from 'vitest';

interface UpdateChecker {
  check(identity: { readonly packageName: string; readonly installedVersion: string }): Promise<{
    readonly packageName: string;
    readonly installedVersion: string;
    readonly latestVersion: string;
    readonly updateAvailable: boolean;
  }>;
}

type UpdateCheckerFactory = (options: {
  readonly requestPackument: (packageName: string) => Promise<unknown>;
}) => UpdateChecker;

async function loadUpdateCheckerFactory(): Promise<UpdateCheckerFactory> {
  const module = await import(
    new URL('../../../runtime/desktop-market-plugin/update-checker.js', import.meta.url).href
  ) as { readonly createUpdateChecker: UpdateCheckerFactory };
  return module.createUpdateChecker;
}

describe('desktop plugin update checker', () => {
  it('checks npm latest directly without loading a community catalog', async () => {
    const createUpdateChecker = await loadUpdateCheckerFactory();
    const requestPackument = vi.fn(async () => ({ 'dist-tags': { latest: '0.4.11' } }));
    const checker = createUpdateChecker({ requestPackument });

    await expect(checker.check({
      packageName: 'dsh-dream-skin',
      installedVersion: '0.4.10',
    })).resolves.toEqual({
      packageName: 'dsh-dream-skin',
      installedVersion: '0.4.10',
      latestVersion: '0.4.11',
      updateAvailable: true,
    });
    expect(requestPackument).toHaveBeenCalledWith('dsh-dream-skin');
  });

  it('deduplicates concurrent checks and rejects non-stable metadata', async () => {
    const createUpdateChecker = await loadUpdateCheckerFactory();
    let resolvePackument: ((value: unknown) => void) | undefined;
    const requestPackument = vi.fn(() => new Promise<unknown>((resolve) => {
      resolvePackument = resolve;
    }));
    const checker = createUpdateChecker({ requestPackument });
    const first = checker.check({ packageName: 'dsh-context', installedVersion: '1.0.0' });
    const second = checker.check({ packageName: 'dsh-context', installedVersion: '1.0.0' });
    resolvePackument?.({ 'dist-tags': { latest: '2.0.0-beta.1' } });

    await expect(first).rejects.toMatchObject({ code: 'update-check:invalid-metadata' });
    await expect(second).rejects.toMatchObject({ code: 'update-check:invalid-metadata' });
    expect(requestPackument).toHaveBeenCalledOnce();
  });
});
