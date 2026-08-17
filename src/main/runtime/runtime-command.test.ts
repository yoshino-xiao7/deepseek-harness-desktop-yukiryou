import { describe, expect, it } from 'vitest';

import { createHarnessRuntimeCommand } from './runtime-command.js';

describe('Harness runtime command', () => {
  it('loads the bundled desktop settings overlay before the web profile', () => {
    expect(createHarnessRuntimeCommand('/runtime')).toEqual({
      command: '/runtime/node/bin/node',
      args: [
        '/runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
        '--profile',
        'web',
        '--patch',
        '/runtime/desktop-settings.patch.yml',
      ],
    });
  });
});
