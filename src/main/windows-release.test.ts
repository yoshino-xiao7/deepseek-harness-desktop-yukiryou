import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  shouldConfigureWindowsApplicationIdentity,
  windowsAppUserModelId,
  windowsExecutableName,
} from './windows-release.js';

describe('Windows release identity', () => {
  it('uses a stable product identity and packaged executable', () => {
    expect(windowsExecutableName).toBe('DeepSeek YukiRyou');
    expect(windowsAppUserModelId).toBe('com.yukiryou.deepseek.yukiryou');
  });

  it('only applies the Windows identity on Windows', () => {
    expect(shouldConfigureWindowsApplicationIdentity('win32')).toBe(true);
    expect(shouldConfigureWindowsApplicationIdentity('darwin')).toBe(false);
    expect(shouldConfigureWindowsApplicationIdentity('linux')).toBe(false);
  });

  it('keeps macOS makers in Forge and delegates Windows setup to a guided NSIS installer', async () => {
    const { default: config } = await import('../../forge.config.js');
    const packager = config.packagerConfig as {
      readonly icon?: string;
      readonly overwrite?: boolean;
    };
    const makers = (config.makers ?? []).map((maker) => {
      const instance = maker as {
        readonly name?: string;
        readonly platforms?: readonly string[];
      };
      return { name: instance.name, platforms: instance.platforms };
    });

    expect(packager.icon).toBe('resources/icons/deepseek-yukiryou');
    expect(packager.overwrite).toBe(true);
    expect(makers).toContainEqual({
      name: 'dmg',
      platforms: ['darwin', 'mas'],
    });
    expect(makers).toContainEqual({
      name: 'zip',
      platforms: ['darwin', 'win32'],
    });
    expect(makers).not.toContainEqual({ name: 'squirrel', platforms: ['win32'] });

    const builder = await readFile('electron-builder.yml', 'utf8');
    expect(builder).toContain('target: nsis');
    expect(builder).toContain('oneClick: false');
    expect(builder).toContain('allowToChangeInstallationDirectory: true');
    expect(builder).toContain('perMachine: false');
    expect(builder).toContain('runAfterFinish: false');

    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['make:win']).toContain('--publish never');
  });
});
