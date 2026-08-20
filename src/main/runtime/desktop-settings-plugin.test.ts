import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type ElementNode = { readonly type: unknown; readonly props: Record<string, unknown>; readonly children: unknown[] };

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(textContent).join('');
  return textContent((value as Partial<ElementNode>).children ?? []);
}

function elements(value: unknown): ElementNode[] {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== 'object') return [];
  const node = value as ElementNode;
  return [node, ...elements(node.children)];
}

describe('desktop settings pet section', () => {
  it('registers a Harness-native pet asset page whose import command contains no path', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-settings-plugin/client.js', import.meta.url),
      'utf8',
    );
    let plugin: { apply(context: unknown): void } | undefined;
    const registrations = new Map<string, { component: (props: Record<string, unknown>) => unknown; descriptor: Record<string, unknown> }>();
    const request = vi.fn(async () => ({ status: 'cancelled' }));
    const petStore = {
      getSnapshot: () => ({
        enabled: true,
        canImport: true,
        activePetId: 'builtin.default',
        assets: [{
          id: 'builtin.default', name: 'Default Pet', author: 'YukiRyou', origin: 'built-in', status: 'ready',
          thumbnailUrl: 'dsh-pet://thumbnail/builtin.default/draft', thumbnailRevision: 'draft', license: 'Bundled', source: 'bundled',
        }],
        inbox: [],
        revision: 0,
      }),
      subscribe: () => () => {},
      request,
    };
    const React = {
      createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ElementNode {
        return { type, props: props ?? {}, children: children.flat() };
      },
      useEffect: vi.fn(),
      useState: <T>(initial: T | (() => T)): [T, ReturnType<typeof vi.fn>] => [
        typeof initial === 'function' ? (initial as () => T)() : initial,
        vi.fn(),
      ],
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    };
    const dictionaries: Record<string, Record<string, string>> = {};
    const window = {
      deepSeekYukiRyouPets: petStore,
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
          plugin = factory(() => React) as typeof plugin;
        },
      },
    };
    const document = {
      querySelector: () => ({}),
      documentElement: { lang: 'zh-CN' },
      head: { appendChild: vi.fn() },
    };
    vm.runInNewContext(source, { document, window });
    plugin?.apply({
      effect: (callback: () => void) => callback(),
      locale: {
        register: (_namespace: string, values: Record<string, Record<string, string>>) => {
          Object.assign(dictionaries, values);
          return vi.fn();
        },
        bind: () => (key: string) => dictionaries.zh?.[key] ?? key,
      },
      theme: { getTheme: () => ({ preference: 'light' }), setTheme: vi.fn() },
      on: () => vi.fn(),
      slots: {
        inject: (_name: string, callback: () => void) => callback(),
        register: (descriptor: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) => {
          registrations.set(String(descriptor.id), { component, descriptor });
          return vi.fn();
        },
      },
    });

    const registration = registrations.get('desktop-pets');
    expect(registration).toBeDefined();
    expect((registration?.descriptor.label as () => string)()).toBe('宠物');
    const tree = registration?.component({
      t: (key: string) => dictionaries.zh?.[key] ?? key,
      petStore,
    });
    expect(textContent(tree)).toContain('宠物资产');
    const importButton = elements(tree).find((node) => node.type === 'button' && textContent(node) === '导入宠物包');
    const thumbnail = elements(tree).find((node) => node.type === 'img');
    expect(thumbnail?.props.src).toBe('dsh-pet://thumbnail/builtin.default/draft');
    expect(thumbnail?.props.alt).toBe('');
    expect(importButton?.props.onClick).toBeTypeOf('function');
    (importButton?.props.onClick as () => void)();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith({ kind: 'import', expectedRevision: 0 });
  });
});
