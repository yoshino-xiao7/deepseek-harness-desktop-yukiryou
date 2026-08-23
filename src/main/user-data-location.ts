import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PRODUCT_DIRECTORY = 'DeepSeek YukiRyou';
const DEVELOPMENT_DIRECTORY = 'DeepSeek YukiRyou Development';
const LEGACY_DIRECTORY = 'DSH Desktop';
const MIGRATION_MARKER = '.migrated-from-dsh-desktop';

export async function prepareUserDataLocation(
  appDataDirectory: string,
): Promise<string> {
  const productDirectory = join(appDataDirectory, PRODUCT_DIRECTORY);
  const legacyDirectory = join(appDataDirectory, LEGACY_DIRECTORY);
  const migrationMarker = join(productDirectory, MIGRATION_MARKER);
  await mkdir(productDirectory, { recursive: true, mode: 0o700 });

  if (
    (await exists(legacyDirectory)) &&
    !(await exists(migrationMarker))
  ) {
    await cp(legacyDirectory, productDirectory, {
      recursive: true,
      errorOnExist: false,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    await writeFile(
      migrationMarker,
      'Copied from DSH Desktop; the legacy directory was preserved.\n',
      { mode: 0o600 },
    );
  }
  return productDirectory;
}

export async function prepareDevelopmentUserDataLocation(
  appDataDirectory: string,
): Promise<string> {
  const developmentDirectory = join(appDataDirectory, DEVELOPMENT_DIRECTORY);
  await mkdir(developmentDirectory, { recursive: true, mode: 0o700 });
  return developmentDirectory;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
