import { join } from 'node:path';
import type { DesktopCarrierMode } from '../window/desktop-carrier-mode.js';

export function createHarnessRuntimeCommand(
  runtimeRoot: string,
  carrierMode: DesktopCarrierMode = 'legacy',
): {
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
      join(
        runtimeRoot,
        carrierMode === 'integrated'
          ? 'desktop-integrated.patch.yml'
          : 'desktop-extensions.patch.yml',
      ),
      '--profile',
      'web',
      '--no-open',
    ],
  };
}
