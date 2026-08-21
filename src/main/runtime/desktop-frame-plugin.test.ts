import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type ElementNode = {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
};

describe('integrated desktop frame prototype', () => {
  it('exposes both the Cordis host entry and the client entry', async () => {
    const packageJson = JSON.parse(await readFile(
      new URL('../../../runtime/desktop-frame-plugin/package.json', import.meta.url),
      'utf8',
    )) as { main?: string; exports?: Record<string, string> };

    expect(packageJson.main).toBe('./index.js');
    expect(packageJson.exports?.['.']).toBe('./index.js');
    expect(packageJson.exports?.['./client']).toBe('./client.js');
  });

  it('keeps the official root and mounts through the supported shell overlay', async () => {
    const source = await readFile(
      new URL('../../../runtime/desktop-frame-plugin/client.js', import.meta.url),
      'utf8',
    );
    let plugin: { apply(context: unknown): void } | undefined;
    const effects: Array<() => () => void> = [];
    const roots = ['client-ui-layout AppFrame'];
    const injectedSlots: string[] = [];
    let prototypeComponent: ((props: Record<string, unknown>) => unknown) | undefined;
    let prototypeDescriptor: Record<string, unknown> | undefined;
    const React = {
      Fragment: 'fragment',
      useState<T>(initial: T | (() => T)): [T, ReturnType<typeof vi.fn>] {
        return [typeof initial === 'function' ? (initial as () => T)() : initial, vi.fn()];
      },
      useEffect(effect: () => void): void {
        effect();
      },
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
    };
    const reportHealth = vi.fn();
    const window = {
      __ModuleLoader__: {
        load: ({ factory }: { factory(require: (id: string) => unknown): unknown }) => {
          plugin = factory(() => React) as typeof plugin;
        },
      },
      deepSeekYukiRyouFrame: { reportHealth },
    };

    vm.runInNewContext(source, { window });
    plugin?.apply({
      effect: (factory: () => () => void) => effects.push(factory),
      slots: {
        register: (
          descriptor: Record<string, unknown>,
          component: (props: Record<string, unknown>) => unknown,
        ) => {
          prototypeDescriptor = descriptor;
          prototypeComponent = component;
          return () => {
            prototypeDescriptor = undefined;
          };
        },
        inject: (name: string, callback: () => () => void) => {
          injectedSlots.push(name);
          return callback();
        },
      },
    });

    const dispose = effects[0]?.();
    expect(roots).toEqual(['client-ui-layout AppFrame']);
    expect(injectedSlots).toEqual(['shell.overlay']);
    expect(prototypeDescriptor).toEqual({
      name: 'shell.overlay',
      id: 'desktop-frame-health',
      order: -100,
    });

    prototypeComponent?.({});
    expect(reportHealth).toHaveBeenCalledWith({
      protocolVersion: 1,
      status: 'ready',
      capabilities: {
        integratedChrome: false,
        resizablePanels: false,
        shellOverlay: true,
      },
    });

    dispose?.();
    expect(roots).toEqual(['client-ui-layout AppFrame']);
    expect(prototypeDescriptor).toBeUndefined();
  });

  it('is not part of the default Runtime profile patch', async () => {
    const patch = await readFile(
      new URL('../../../runtime/desktop-extensions.patch.yml', import.meta.url),
      'utf8',
    );
    expect(patch).not.toContain('@dsh-desktop/frame-prototype');
  });

  it('is enabled only by the explicit Integrated Runtime patch', async () => {
    const patch = await readFile(
      new URL('../../../runtime/desktop-integrated.patch.yml', import.meta.url),
      'utf8',
    );
    expect(patch).toContain("name: '@dsh-desktop/frame-prototype'");
  });
});
