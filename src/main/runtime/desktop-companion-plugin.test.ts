import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type ElementNode = {
  children: unknown[];
  props: Record<string, unknown>;
  type: unknown;
};

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(textContent).join('');
  const node = value as Partial<ElementNode>;
  return textContent(node.children ?? []);
}

function elements(value: unknown): ElementNode[] {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  if (typeof value !== 'object') return [];
  const node = value as ElementNode;
  return [node, ...elements(node.children)];
}

describe('desktop companion turn card', () => {
  it('renders a working review control in the real turn-tail component', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-companion-plugin/client.js', import.meta.url),
      'utf8',
    );
    const registrations = new Map<string, (props: Record<string, unknown>) => unknown>();
    const effects: Array<() => unknown> = [];
    let plugin: { apply(context: unknown): void } | undefined;
    const React = {
      Fragment: Symbol('fragment'),
      createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ElementNode {
        if (typeof type === 'function') return type({ ...(props ?? {}), children }) as ElementNode;
        return { type, props: props ?? {}, children: children.flat() };
      },
      useEffect: (effect: () => unknown) => effects.push(effect),
      useRef: <T>(initial: T): { current: T } => ({ current: initial }),
      useState: <T>(initial: T | (() => T)): [T, ReturnType<typeof vi.fn>] => [
        typeof initial === 'function' ? (initial as () => T)() : initial,
        vi.fn(),
      ],
    };
    const Button = ({ children, ...props }: Record<string, unknown>): ElementNode => React.createElement(
      'button',
      props,
      children,
    );
    const document = {
      documentElement: { lang: 'zh-CN' },
      head: { append: vi.fn() },
      querySelector: () => ({}),
    };
    const openChangedFile = vi.fn();
    let receiveWorkspaceReference: ((value: { sessionId: string; text: string }) => void) | undefined;
    const window = {
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
          plugin = factory((id) => {
            if (id === 'react') return React;
            if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button };
            return { isAppendSurfaceEvent: () => true };
          }) as typeof plugin;
        },
      },
      deepSeekYukiRyouReview: { openChangedFile },
      deepSeekYukiRyouComposer: {
        subscribe: (_sessionId: string, listener: (value: { sessionId: string; text: string }) => void) => {
          receiveWorkspaceReference = listener;
          return vi.fn();
        },
      },
    };
    vm.runInNewContext(source, { document, Map, Set, window });
    plugin?.apply({
      conversationEvents: { register: vi.fn() },
      effect: vi.fn(),
      slots: {
        inject: (_name: string, register: () => void) => register(),
        register: (descriptor: { name: string }, component: (props: Record<string, unknown>) => unknown) => {
          registrations.set(descriptor.name, component);
          return vi.fn();
        },
      },
    });
    expect(registrations.has('sidebar.footer.action')).toBe(false);

    const Component = registrations.get('conversation.chat.turnTail');
    expect(Component).toBeDefined();
    const tree = Component?.({
      matched: [{
        path: 'src/example.ts', additions: 1, deletions: 1,
        fragments: [{ oldText: 'const value = 1;\n', newText: 'const value = 2;\n' }],
      }],
      openFile: vi.fn(),
      sessionId: 'session-1',
      useSessions: (select: (snapshot: unknown) => unknown) => select({
        byId: { 'session-1': { cwd: '/workspace' } },
      }),
    });

    expect(textContent(tree)).toContain('审核');
    const buttons = elements(tree).filter((node) => node.type === 'button');
    const review = buttons.find((button) => textContent(button) === '审核');
    expect(review?.props.variant).toBe('outline');
    expect(review?.props.size).toBe('sm');
    expect(review?.props.onClick).toBeTypeOf('function');
    (review?.props.onClick as () => void)();
    expect(openChangedFile).toHaveBeenCalledWith({
      path: 'src/example.ts',
      historicalDiff: expect.objectContaining({
        additions: 1,
        deletions: 1,
        text: expect.stringContaining('-const value = 1;'),
      }),
    });
    expect(openChangedFile.mock.calls[0]?.[0].historicalDiff.text).toContain('+const value = 2;');

    const Receiver = registrations.get('conversation.input.dock');
    const setDraft = vi.fn();
    Receiver?.({
      sessionId: 'session-1',
      input: { draft: '请检查' },
      inputActions: { setDraft },
    });
    effects.at(-1)?.();
    receiveWorkspaceReference?.({ sessionId: 'other-session', text: '@ignored.ts' });
    expect(setDraft).not.toHaveBeenCalled();
    receiveWorkspaceReference?.({ sessionId: 'session-1', text: '@src/example.ts' });
    expect(setDraft).toHaveBeenCalledWith('请检查\n\n@src/example.ts');
  });
});
