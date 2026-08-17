import { mkdir, mkdtemp, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureDesktopSettingsExtension } from './runtime-extension.js';

describe('desktop settings runtime extension', () => {
  it('links the app-owned profile package to the bundled plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-extension-'));
    const runtimeHome = join(root, 'home');
    const runtimeRoot = join(root, 'runtime');
    await mkdir(
      join(
        runtimeRoot,
        'dsh',
        'node_modules',
        '@dsh-desktop',
        'settings',
      ),
      { recursive: true },
    );

    await ensureDesktopSettingsExtension(runtimeHome, runtimeRoot);

    await expect(
      readlink(
        join(
          runtimeHome,
          'profiles',
          'node_modules',
          '@dsh-desktop',
          'settings',
        ),
      ),
    ).resolves.toBe(
      join(
        runtimeRoot,
        'dsh',
        'node_modules',
        '@dsh-desktop',
        'settings',
      ),
    );
  });

  it('refuses to replace a non-link package path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-extension-conflict-'));
    const runtimeHome = join(root, 'home');
    const packagePath = join(
      runtimeHome,
      'profiles',
      'node_modules',
      '@dsh-desktop',
      'settings',
    );
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'user-file'), 'preserve');

    await expect(
      ensureDesktopSettingsExtension(runtimeHome, join(root, 'runtime')),
    ).rejects.toThrow('is not a symbolic link');
  });
});
