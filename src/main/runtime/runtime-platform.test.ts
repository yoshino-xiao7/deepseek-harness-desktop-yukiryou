import { describe, expect, it } from 'vitest';

import { resolveBundledRuntimePlatform } from './runtime-platform.js';

describe('bundled Runtime platform layout', () => {
  it('describes the existing Darwin archive and executable layout', () => {
    expect(resolveBundledRuntimePlatform('darwin', 'arm64')).toEqual({
      target: 'darwin-arm64',
      platform: 'darwin',
      architecture: 'arm64',
      nodeExecutable: 'node/bin/node',
      npmCli: 'node/lib/node_modules/npm/bin/npm-cli.js',
      nodeBinDirectory: 'node/bin',
      nodePtyPrebuild: 'darwin-arm64',
      nodePtyNativeFiles: ['pty.node', 'spawn-helper'],
      ptyShell: { command: '/bin/zsh', args: ['-f'], input: "printf 'DSH_%s_OK\\n' PTY; exit\r" },
    });
  });

  it('describes the Windows x64 ZIP and ConPTY layout', () => {
    expect(resolveBundledRuntimePlatform('win32', 'x64')).toEqual({
      target: 'win32-x64',
      platform: 'win32',
      architecture: 'x64',
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
    });
  });

  it('fails closed for release targets that are not assembled', () => {
    expect(() => resolveBundledRuntimePlatform('win32', 'arm64')).toThrow(
      'Unsupported bundled Runtime target: win32-arm64',
    );
    expect(() => resolveBundledRuntimePlatform('linux', 'x64')).toThrow(
      'Unsupported bundled Runtime target: linux-x64',
    );
  });
});
