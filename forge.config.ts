import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const signingIdentity = process.env.MACOS_SIGN_IDENTITY?.trim();

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
          osxSign: {
            identity: signingIdentity,
            strictVerify: true,
          },
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
          entry: 'src/preload-entry.ts',
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
