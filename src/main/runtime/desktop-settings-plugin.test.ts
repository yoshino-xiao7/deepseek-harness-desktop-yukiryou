import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type ElementNode = {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
};

describe('desktop plugin management tab', () => {
  it('keeps long plugin names inside a shrinkable two-column card header', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    );

    expect(source).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(source).toContain("className: 'dsh-desktop-plugin-name',\n                              title: entry.displayName");
  });

  it('mounts a read-only explanation through the official plugins tab', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    );
    let plugin: { apply(context: unknown): void } | undefined;
    const registrations = new Map<string, {
      component: (props: Record<string, unknown>) => unknown;
      descriptor: Record<string, unknown>;
    }>();
    const list = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        entries: [{
          entryId: 'loader',
          moduleName: '@deepseek-ai/cordis-plugin-loader',
          enabled: true,
          fiberPhase: 'active',
        }],
      },
    });
    const React = {
      Fragment: Symbol('fragment'),
      createElement(
        type: unknown,
        props: Record<string, unknown> | null,
        ...children: unknown[]
      ): ElementNode | unknown {
        if (typeof type === 'function') {
          return type({ ...(props ?? {}), children });
        }
        return { type, props: props ?? {}, children: children.flat() };
      },
      useCallback: <T>(callback: T): T => callback,
      useEffect: (effect: () => unknown): void => { effect(); },
      useState: <T>(initial: T | (() => T)): [T, ReturnType<typeof vi.fn>] => [
        typeof initial === 'function' ? (initial as () => T)() : initial,
        vi.fn(),
      ],
      useSyncExternalStore: vi.fn(),
    };
    const document = {
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: vi.fn() },
      querySelector: vi.fn().mockReturnValue(null),
    };
    const window = {
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
          plugin = factory(() => React) as typeof plugin;
        },
      },
    };
    vm.runInNewContext(source, { document, window });
    plugin?.apply({
      effect: vi.fn(),
      locale: {
        bind: () => (key: string) => key,
        register: vi.fn(),
      },
      on: vi.fn(),
      remote: { pluginInventory: { list } },
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (
          descriptor: Record<string, unknown>,
          component: (props: Record<string, unknown>) => unknown,
        ) => {
          registrations.set(`${descriptor.name}:${descriptor.id}`, {
            component,
            descriptor,
          });
          return vi.fn();
        },
      },
      theme: { getTheme: vi.fn(), setTheme: vi.fn() },
    });

    const management = registrations.get(
      'settings.plugins.tab:desktop-management',
    );
    expect(management?.descriptor).toMatchObject({
      name: 'settings.plugins.tab',
      id: 'desktop-management',
      order: 20,
    });
    const injected = (management?.descriptor.inject as () => {
      list: () => Promise<unknown>;
    })();
    management?.component({ t: (key: string) => key, ...injected });
    expect(list).toHaveBeenCalledOnce();
  });
});
