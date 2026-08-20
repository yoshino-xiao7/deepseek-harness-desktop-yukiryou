import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { closeSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stagePackageResourceTree } from './src/main/package-resource-staging.js';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const packagedRuntimeDirectory = join(projectRoot, '.cache', 'package-resources', 'runtime');

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
    extraResource: [packagedRuntimeDirectory, join(projectRoot, 'resources', 'pets')],
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
  hooks: {
    prePackage: async () => {
      const result = await stagePackageResourceTree(
        join(projectRoot, 'resources', 'runtime'),
        packagedRuntimeDirectory,
      );
      process.stdout.write(
        `Prepared runtime package input: ${String(result.copiedFiles)} files, ${String(result.copiedSymlinks)} symlinks, ${String(result.excludedConflictCopies)} conflict copies excluded\n`,
      );
    },
  },
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
        {
          entry: 'src/pet-player-preload-entry.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/pet-media-worker-preload-entry.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
        {
          name: 'pet_player',
          config: 'vite.pet-player.config.ts',
        },
        {
          name: 'pet_media_worker',
          config: 'vite.pet-media-worker.config.ts',
        },
      ],
    }),
  ],
};

export default config;
