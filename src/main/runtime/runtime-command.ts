import { posix, win32 } from 'node:path';
import type { DesktopCarrierMode } from '../window/desktop-carrier-mode.js';
import { resolveBundledRuntimePlatform } from './runtime-platform.js';

export function createHarnessRuntimeCommand(
  runtimeRoot: string,
  carrierMode: DesktopCarrierMode = 'legacy',
  managedPluginPatches: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): {
  readonly command: string;
  readonly args: readonly string[];
} {
  const layout = resolveBundledRuntimePlatform(platform, architecture);
  const join = platform === 'win32' ? win32.join : posix.join;
  return {
    command: join(runtimeRoot, layout.nodeExecutable),
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
      ...managedPluginPatches.flatMap((patchPath) => ['--patch', patchPath]),
      '--profile',
      'web',
      '--no-open',
    ],
  };
}
