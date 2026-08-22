export type BundledRuntimeArchitecture = 'arm64' | 'x64';
export type BundledRuntimePlatform = 'darwin' | 'win32';
export type BundledRuntimeTarget =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'win32-x64';

export interface BundledRuntimePlatformLayout {
  readonly target: BundledRuntimeTarget;
  readonly platform: BundledRuntimePlatform;
  readonly architecture: BundledRuntimeArchitecture;
  readonly nodeExecutable: string;
  readonly npmCli: string;
  readonly nodeBinDirectory: string;
  readonly nodePtyPrebuild: string;
  readonly nodePtyNativeFiles: readonly string[];
  readonly ptyShell: {
    readonly command: string;
    readonly args: readonly string[];
    readonly input: string;
  };
}

export function resolveBundledRuntimePlatform(
  platform: NodeJS.Platform,
  architecture: string,
): BundledRuntimePlatformLayout {
  const target = `${platform}-${architecture}`;
  if (
    platform === 'darwin' &&
    (architecture === 'arm64' || architecture === 'x64')
  ) {
    return {
      target: `darwin-${architecture}`,
      platform,
      architecture,
      nodeExecutable: 'node/bin/node',
      npmCli: 'node/lib/node_modules/npm/bin/npm-cli.js',
      nodeBinDirectory: 'node/bin',
      nodePtyPrebuild: `darwin-${architecture}`,
      nodePtyNativeFiles: ['pty.node', 'spawn-helper'],
      ptyShell: {
        command: '/bin/zsh',
        args: ['-f'],
        input: "printf 'DSH_%s_OK\\n' PTY; exit\r",
      },
    };
  }
  if (platform === 'win32' && architecture === 'x64') {
    return {
      target: 'win32-x64',
      platform,
      architecture,
      nodeExecutable: 'node/node.exe',
      npmCli: 'node/node_modules/npm/bin/npm-cli.js',
      nodeBinDirectory: 'node',
      nodePtyPrebuild: 'win32-x64',
      nodePtyNativeFiles: [
        'conpty.node',
        'conpty_console_list.node',
        'conpty/conpty.dll',
        'conpty/OpenConsole.exe',
      ],
      ptyShell: {
        command: 'cmd.exe',
        args: ['/d', '/q', '/c', 'echo DSH_PTY_OK'],
        input: '',
      },
    };
  }
  throw new Error(`Unsupported bundled Runtime target: ${target}`);
}
