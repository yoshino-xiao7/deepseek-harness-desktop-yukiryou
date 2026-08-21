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
});
