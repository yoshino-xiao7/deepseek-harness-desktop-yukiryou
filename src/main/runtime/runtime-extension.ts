import { lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function ensureDesktopSettingsExtension(
  runtimeHome: string,
  runtimeRoot: string,
): Promise<void> {
  const scopeDirectory = join(
    runtimeHome,
    'profiles',
    'node_modules',
    '@dsh-desktop',
  );
  const linkPath = join(scopeDirectory, 'settings');
  const targetPath = join(
    runtimeRoot,
    'dsh',
    'node_modules',
    '@dsh-desktop',
    'settings',
  );
  await mkdir(scopeDirectory, { recursive: true, mode: 0o700 });

  try {
    const status = await lstat(linkPath);
    if (!status.isSymbolicLink()) {
      throw new Error(
        `Desktop settings extension path is not a symbolic link: ${linkPath}`,
      );
    }
    const currentTarget = resolve(scopeDirectory, await readlink(linkPath));
    if (currentTarget === resolve(targetPath)) {
      return;
    }
    await unlink(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await symlink(targetPath, linkPath, 'dir');
}
