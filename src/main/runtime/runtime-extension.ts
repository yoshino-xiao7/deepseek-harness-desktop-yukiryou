import { lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DESKTOP_EXTENSIONS = [
  'settings',
  'companion',
  'frame-prototype',
  'market',
] as const;

export async function ensureBundledRuntimeExtensions(
  runtimeHome: string,
  runtimeRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const scopeDirectory = join(
    runtimeHome,
    'profiles',
    'node_modules',
    '@dsh-desktop',
  );
  await mkdir(scopeDirectory, { recursive: true, mode: 0o700 });

  for (const extension of DESKTOP_EXTENSIONS) {
    await ensureExtensionLink(scopeDirectory, runtimeRoot, extension, platform);
  }
}

async function ensureExtensionLink(
  scopeDirectory: string,
  runtimeRoot: string,
  extension: (typeof DESKTOP_EXTENSIONS)[number],
  platform: NodeJS.Platform,
): Promise<void> {
  const linkPath = join(scopeDirectory, extension);
  const targetPath = join(runtimeRoot, 'dsh', 'node_modules', '@dsh-desktop', extension);

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

  await symlink(
    targetPath,
    linkPath,
    platform === 'win32' ? 'junction' : 'dir',
  );
}

/** @deprecated Use the complete app-owned extension assembly. */
export const ensureDesktopSettingsExtension = ensureBundledRuntimeExtensions;
