import { join } from 'node:path';

export function createHarnessRuntimeCommand(runtimeRoot: string): {
  readonly command: string;
  readonly args: readonly string[];
} {
  return {
    command: join(runtimeRoot, 'node', 'bin', 'node'),
    args: [
      join(
        runtimeRoot,
        'dsh',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js',
      ),
      '--patch',
      join(runtimeRoot, 'desktop-extensions.patch.yml'),
      '--profile',
      'web',
      '--no-open',
    ],
  };
}
