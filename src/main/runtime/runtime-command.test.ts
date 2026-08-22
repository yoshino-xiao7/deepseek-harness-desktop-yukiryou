import { describe, expect, it } from 'vitest';

import { createHarnessRuntimeCommand } from './runtime-command.js';

describe('Harness runtime command', () => {
  it('keeps the web profile inside the desktop shell and loads its settings overlay', () => {
    expect(createHarnessRuntimeCommand('/runtime')).toEqual({
      command: '/runtime/node/bin/node',
      args: [
        '/runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
        '--patch',
        '/runtime/desktop-extensions.patch.yml',
        '--profile',
        'web',
        '--no-open',
      ],
    });
  });

  it('selects the isolated Frame overlay only for the Integrated carrier', () => {
    expect(createHarnessRuntimeCommand('/runtime', 'integrated').args).toContain(
      '/runtime/desktop-integrated.patch.yml',
    );
    expect(createHarnessRuntimeCommand('/runtime', 'legacy').args).not.toContain(
      '/runtime/desktop-integrated.patch.yml',
    );
  });

  it('places Bootstrap-authorized managed bundles after the desktop overlay', () => {
    const args = createHarnessRuntimeCommand('/runtime', 'legacy', [
      `/runtime-home/user-plugins/generations/gen-${'a'.repeat(64)}/node_modules/@example/tool/cordis.patch.yml`,
      `/runtime-home/user-plugins/generations/gen-${'b'.repeat(64)}/node_modules/example-two/patch.yml`,
    ]).args;

    expect(args).toEqual([
      '/runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
      '--patch',
      '/runtime/desktop-extensions.patch.yml',
      '--patch',
      `/runtime-home/user-plugins/generations/gen-${'a'.repeat(64)}/node_modules/@example/tool/cordis.patch.yml`,
      '--patch',
      `/runtime-home/user-plugins/generations/gen-${'b'.repeat(64)}/node_modules/example-two/patch.yml`,
      '--profile',
      'web',
      '--no-open',
    ]);
  });

  it('uses the target-specific Windows Node executable', () => {
    expect(
      createHarnessRuntimeCommand('/runtime', 'legacy', [], 'win32', 'x64'),
    ).toMatchObject({
      command: '/runtime/node/node.exe',
    });
  });
});
