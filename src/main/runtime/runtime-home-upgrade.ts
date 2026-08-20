import {
  cp,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const RC8_UPGRADE_ID = 'dsh-0.1.0-rc.8-storage-v1';

export type RuntimeHomeUpgradeBackupResult =
  | { readonly status: 'already-prepared' | 'empty' }
  | { readonly status: 'created'; readonly backupPath: string };

/**
 * Preserve the pre-rc.8 Runtime Home before Harness opens its incompatible
 * storage format. The marker lives outside Runtime Home so it is not included
 * in, or modified by, the Harness migration.
 */
export async function ensureRc8RuntimeHomeBackup(
  runtimeHome: string,
): Promise<RuntimeHomeUpgradeBackupResult> {
  const userData = dirname(runtimeHome);
  const markerPath = join(userData, `.${RC8_UPGRADE_ID}.json`);
  const backupBasePath = join(
    userData,
    `${basename(runtimeHome)}.pre-dsh-0.1.0-rc.8`,
  );

  const intent = await readMarkerIntent(
    markerPath,
    userData,
    basename(backupBasePath),
  );
  if (intent !== undefined) {
    if (
      intent.backupPath === undefined ||
      await pathExists(intent.backupPath)
    ) {
      return { status: 'already-prepared' };
    }
    await createBackup(runtimeHome, intent.backupPath);
    return { status: 'created', backupPath: intent.backupPath };
  }

  if ((await readdir(runtimeHome)).length === 0) {
    const publication = await writeMarker(markerPath, undefined);
    if (publication === 'already-exists') {
      return resolveConcurrentMarker(markerPath, userData, basename(backupBasePath));
    }
    return { status: 'empty' };
  }

  const backupPath = await nextAvailableBackupPath(backupBasePath);
  // Persist the chosen target before copying. If copy/rename or marker commit
  // is interrupted, the next start resumes this target instead of consuming
  // disk with .1/.2 duplicates.
  const publication = await writeMarker(markerPath, backupPath);
  if (publication === 'already-exists') {
    return resolveConcurrentMarker(markerPath, userData, basename(backupBasePath));
  }
  await createBackup(runtimeHome, backupPath);
  return { status: 'created', backupPath };
}

async function resolveConcurrentMarker(
  markerPath: string,
  userData: string,
  backupBaseName: string,
): Promise<RuntimeHomeUpgradeBackupResult> {
  const intent = await readMarkerIntent(markerPath, userData, backupBaseName);
  if (intent === undefined) {
    throw new Error('Rc.8 Runtime Home upgrade marker disappeared during publication');
  }
  if (
    intent.backupPath === undefined ||
    await pathExists(intent.backupPath)
  ) {
    return { status: 'already-prepared' };
  }
  // The winning process published its intent but has not atomically committed
  // the backup directory yet. Do not race its staging directory or let Harness
  // open Runtime Home before that copy completes.
  throw new Error('Rc.8 Runtime Home upgrade preparation is already in progress');
}

async function createBackup(
  runtimeHome: string,
  backupPath: string,
): Promise<void> {
  const stagingPath = `${backupPath}.incomplete`;
  await rm(stagingPath, { recursive: true, force: true });
  try {
    await cp(runtimeHome, stagingPath, {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    await rename(stagingPath, backupPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

async function nextAvailableBackupPath(basePath: string): Promise<string> {
  if (!(await pathExists(basePath))) return basePath;
  for (let index = 1; index <= 1_000; index += 1) {
    const candidate = `${basePath}.${String(index)}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error('Too many rc.8 Runtime Home rollback copies');
}

async function writeMarker(
  markerPath: string,
  backupPath: string | undefined,
): Promise<'published' | 'already-exists'> {
  await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${markerPath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    const temporaryFile = await open(temporaryPath, 'wx', 0o600);
    try {
      await temporaryFile.writeFile(
        `${JSON.stringify({
          upgrade: RC8_UPGRADE_ID,
          backupName: backupPath === undefined ? null : basename(backupPath),
        }, null, 2)}\n`,
        { encoding: 'utf8' },
      );
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    try {
      // A same-directory hard link publishes the already-synced inode in one
      // step and, unlike rename on POSIX, cannot replace a concurrent marker.
      await link(temporaryPath, markerPath);
      return 'published';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return 'already-exists';
      }
      throw error;
    }
  } finally {
    // A crash can strand a uniquely named temp file, but it can never expose
    // partial JSON as the official marker. A later attempt safely ignores it.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readMarkerIntent(
  markerPath: string,
  userData: string,
  backupBaseName: string,
): Promise<{ backupPath: string | undefined } | undefined> {
  let marker: string;
  try {
    marker = await readFile(markerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(marker) as unknown;
  } catch (error) {
    throw new Error('Invalid or incomplete rc.8 Runtime Home upgrade marker', {
      cause: error,
    });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid rc.8 Runtime Home upgrade marker');
  }
  const record = value as Record<string, unknown>;
  if (record.upgrade !== RC8_UPGRADE_ID) {
    throw new Error('Unexpected rc.8 Runtime Home upgrade marker version');
  }
  const hasBackupName = Object.hasOwn(record, 'backupName');
  const hasBackupPath = Object.hasOwn(record, 'backupPath');
  if (hasBackupName === hasBackupPath) {
    throw new Error('Invalid rc.8 Runtime Home backup target');
  }
  const storedBackup = hasBackupName ? record.backupName : record.backupPath;
  if (storedBackup === null) {
    return { backupPath: undefined };
  }
  const backupName = typeof storedBackup === 'string'
    ? basename(storedBackup)
    : undefined;
  if (
    backupName === undefined ||
    (backupName !== backupBaseName &&
      !new RegExp(`^${escapeRegExp(backupBaseName)}\\.[1-9][0-9]*$`).test(backupName))
  ) {
    throw new Error('Invalid rc.8 Runtime Home backup target');
  }
  return { backupPath: join(userData, backupName) };
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
