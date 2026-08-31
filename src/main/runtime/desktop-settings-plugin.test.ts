import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type ElementNode = {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
};

function elements(value: unknown): ElementNode[] {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== 'object') return [];
  const node = value as ElementNode;
  return [node, ...elements(node.children)];
}

describe('desktop plugin management tab', () => {
  it('registers Windows-specific About and manual update copy', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    );
    let plugin: { apply(context: unknown): void } | undefined;
    const register = vi.fn();
    const window = {
      deepSeekYukiRyouPlatform: { platform: 'win32', architecture: 'x64' },
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
          plugin = factory(() => ({ createElement: vi.fn() })) as typeof plugin;
        },
      },
    };

    vm.runInNewContext(source, {
      document: { querySelector: vi.fn().mockReturnValue({}) },
      window,
    });
    plugin?.apply({
      effect: (effect: () => unknown) => effect(),
      locale: { bind: vi.fn(), register },
      on: vi.fn(),
      slots: { inject: vi.fn(), register: vi.fn() },
      theme: { getTheme: vi.fn(), setTheme: vi.fn() },
    });

    expect(register).toHaveBeenCalledOnce();
    const dictionaries = register.mock.calls[0]?.[1] as {
      zh: Record<string, string>;
      en: Record<string, string>;
    };
    expect(dictionaries.zh['about.badge']).toContain('Windows');
    expect(dictionaries.zh['about.architectureValue']).toBe('Windows x64');
    expect(dictionaries.zh['about.updateManual']).toMatch(/EXE|ZIP/);
    expect(dictionaries.zh['about.manualDownload']).toContain('EXE');
    expect(dictionaries.en['about.badge']).toContain('Windows');
    expect(dictionaries.en['about.architectureValue']).toBe('Windows x64');
    expect(dictionaries.en['about.updateManual']).toMatch(/EXE|ZIP/);
    expect(dictionaries.en['about.manualDownload']).toContain('EXE');
  });

  it('keeps long plugin names inside a shrinkable two-column card header', async () => {
    const source = (await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    )).replaceAll('\r\n', '\n');

    expect(source).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(source).toContain("className: 'dsh-desktop-plugin-name',\n                              title: entry.displayName");
  });

  it('uses the Harness general-row typography for desktop feature controls', async () => {
    const source = (await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    )).replaceAll('\r\n', '\n');

    expect(source).toContain('.dsh-desktop-feature-title {');
    expect(source).toContain('font-weight: 400;\n        line-height: 22px;');
    expect(source).toContain('.dsh-desktop-feature-description {');
    expect(source).toContain('color: var(--dsw-alias-label-tertiary);');
    expect(source).not.toContain("React.createElement('strong', null, t(title))");
    expect(source).not.toContain("React.createElement('small', null, t(description))");
  });

  it('renders native download percentage as a determinate About progress bar', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    );

    expect(source).toContain("'aria-valuenow': update.downloadPercent");
    expect(source).toContain("className: 'dsh-desktop-update-progress-fill'");
    expect(source).toContain("style: { width: `${String(update.downloadPercent)}%` }");
    expect(source).toContain("`${t('about.downloading')}${progressSuffix}`");
    expect(source).toContain('.dsh-desktop-update-progress[data-indeterminate="true"]::after');
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
      useRef: <T>(value: T): { current: T } => ({ current: value }),
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
    const setFeaturePreference = vi.fn();
    const window = {
      deepSeekYukiRyouFeatures: {
        getSnapshot: () => ({ workspaceReview: true }),
        subscribe: vi.fn().mockReturnValue(vi.fn()),
        set: setFeaturePreference,
      },
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
    expect(registrations.has('settings.section:desktop-appearance')).toBe(false);
    const features = registrations.get('settings.general.item:desktop-features');
    expect(features?.descriptor).toMatchObject({
      name: 'settings.general.item',
      id: 'desktop-features',
      order: 80,
    });
    const featureTree = features?.component({ t: (key: string) => key });
    const switches = elements(featureTree).filter((node) => node.props.role === 'switch');
    expect(switches).toHaveLength(1);
    expect(switches.map((node) => node.props['aria-checked'])).toEqual([true]);
    (switches[0]?.props.onClick as (() => void) | undefined)?.();
    (switches[0]?.props.onClick as (() => void) | undefined)?.();
    expect(setFeaturePreference.mock.calls).toEqual([
      [{ key: 'workspaceReview', enabled: false }],
      [{ key: 'workspaceReview', enabled: true }],
    ]);
  });
});
