import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync } from 'node:fs';
import path from 'node:path';


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

function runExecutable(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

export class LongPathWindowsMakerZIP extends MakerZIP {
  override async make(
    options: Parameters<MakerZIP['make']>[0],
  ): Promise<string[]> {
    if (options.targetPlatform !== 'win32') {
      return super.make(options);
    }

    const zipName = `${path.basename(options.dir)}-${options.packageJSON.version}.zip`;
    const zipPath = path.resolve(
      options.makeDir,
      'zip',
      options.targetPlatform,
      options.targetArch,
      zipName,
    );
    await this.ensureFile(zipPath);

    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    await runExecutable(
      path.join(systemRoot, 'System32', 'tar.exe'),
      ['-a', '-cf', zipPath, '-C', options.dir, '.'],
    );
    return [zipPath];
  }
}

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
    overwrite: true,
    extraResource: ['resources/runtime'],
    executableName: 'DeepSeek YukiRyou',
    // Electron Packager appends .icns or .ico for the target platform.
    icon: 'resources/icons/deepseek-yukiryou',
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
    new LongPathWindowsMakerZIP({}, ['darwin', 'win32']),
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
