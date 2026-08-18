import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { closeSync, openSync, readSync } from 'node:fs';

const signingIdentity = process.env.MACOS_SIGN_IDENTITY?.trim();
const machOMagicNumbers = new Set([
  0xfeedface,
  0xcefaedfe,
  0xfeedfacf,
  0xcffaedfe,
  0xcafebabe,
  0xbebafeca,
  0xcafebabf,
  0xbfbafeca,
]);
const codeBundleSuffixes = ['.app', '.framework', '.xpc', '.appex'];

export function shouldIgnoreCodeSigningPath(path: string): boolean {
  if (codeBundleSuffixes.some((suffix) => path.endsWith(suffix))) return false;

  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const header = Buffer.alloc(4);
    if (readSync(descriptor, header, 0, header.length, 0) < header.length) {
      return true;
    }
    return !machOMagicNumbers.has(header.readUInt32BE(0));
  } catch {
    // Let codesign report inaccessible or unexpected code paths instead of
    // silently excluding them from the signature.
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createMacOsSignOptions(identity: string) {
  return {
    identity,
    strictVerify: true,
    continueOnError: false,
    ignore: shouldIgnoreCodeSigningPath,
  } as const;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['resources/runtime'],
    executableName: 'DeepSeek YukiRyou',
    icon: 'resources/icons/deepseek-yukiryou.icns',
    appBundleId:
      process.env.DEEPSEEK_YUKIRYOU_BUNDLE_ID ??
      'com.yukiryou.deepseek.yukiryou',
    extendInfo: {
      LSMinimumSystemVersion: '14.0',
    },
    ...(signingIdentity === undefined || signingIdentity === ''
      ? {}
      : {
          osxSign: createMacOsSignOptions(signingIdentity),
        }),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({ format: 'ULFO' }),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main-entry.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/shell-preload-entry.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/harness-preload-entry.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
