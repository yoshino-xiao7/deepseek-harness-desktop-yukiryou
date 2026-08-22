import { mkdir, mkdtemp, readlink, writeFile } from 'node:fs/promises';
import type * as FileSystemPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ensureDesktopSettingsExtension } from './runtime-extension.js';

describe('desktop settings runtime extension', () => {
  it('uses directory junctions on Windows without requiring Developer Mode', async () => {
    const actualFileSystem = await vi.importActual<typeof FileSystemPromises>(
      'node:fs/promises',
    );
    const symlink = vi.fn(actualFileSystem.symlink);
    vi.resetModules();
    vi.doMock('node:fs/promises', () => ({ ...actualFileSystem, symlink }));
    try {
      const root = await mkdtemp(join(tmpdir(), 'dsh-extension-windows-'));
      const runtimeHome = join(root, 'home');
      const runtimeRoot = join(root, 'runtime');
      for (const extension of [
        'settings',
        'companion',
        'frame-prototype',
        'market',
      ]) {
        await mkdir(
          join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', extension),
          { recursive: true },
        );
      }

      const isolatedModule = await import('./runtime-extension.js');
      await isolatedModule.ensureBundledRuntimeExtensions(
        runtimeHome,
        runtimeRoot,
        'win32',
      );

      expect(symlink).toHaveBeenCalledTimes(4);
      expect(symlink.mock.calls.every((call) => call[2] === 'junction')).toBe(true);
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

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
    await mkdir(
      join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', 'companion'),
      { recursive: true },
    );
    await mkdir(
      join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', 'frame-prototype'),
      { recursive: true },
    );
    await mkdir(
      join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', 'market'),
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
    await expect(
      readlink(join(runtimeHome, 'profiles', 'node_modules', '@dsh-desktop', 'companion')),
    ).resolves.toBe(
      join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', 'companion'),
    );
    await expect(
      readlink(join(runtimeHome, 'profiles', 'node_modules', '@dsh-desktop', 'frame-prototype')),
    ).resolves.toBe(
      join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', 'frame-prototype'),
    );
    await expect(
      readlink(join(runtimeHome, 'profiles', 'node_modules', '@dsh-desktop', 'market')),
    ).resolves.toBe(
      join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', 'market'),
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
