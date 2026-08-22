import { describe, expect, it } from 'vitest';

import {
  shouldConfigureWindowsApplicationIdentity,
  windowsExecutableName,
  windowsSquirrelAppUserModelId,
  windowsSquirrelPackageId,
} from './windows-release.js';

describe('Windows release identity', () => {
  it('matches the Squirrel package id and packaged executable', () => {
    expect(windowsSquirrelPackageId).toBe('DeepSeekYukiRyou');
    expect(windowsExecutableName).toBe('DeepSeek YukiRyou');
    expect(windowsSquirrelAppUserModelId).toBe(
      'com.squirrel.DeepSeekYukiRyou.DeepSeek YukiRyou',
    );
  });

  it('only applies the Squirrel identity on Windows', () => {
    expect(shouldConfigureWindowsApplicationIdentity('win32')).toBe(true);
    expect(shouldConfigureWindowsApplicationIdentity('darwin')).toBe(false);
    expect(shouldConfigureWindowsApplicationIdentity('linux')).toBe(false);
  });

  it('keeps macOS and Windows makers separated in Forge', async () => {
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
    expect(makers).toContainEqual({ name: 'squirrel', platforms: ['win32'] });
  });
});
