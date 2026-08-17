import { access, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

export type PreferenceRecoveryResult =
  | { readonly status: 'healthy' | 'missing' }
  | {
      readonly status: 'recovered';
      readonly backupPath: string;
      readonly reason: string;
    };

export async function recoverInvalidPreferences(
  settingsPath: string,
  now: () => Date = () => new Date(),
): Promise<PreferenceRecoveryResult> {
  let contents: string;
  try {
    const file = await lstat(settingsPath);
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new Error('preferences path must be a regular file');
    }
    contents = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return { status: 'missing' };
    }
    throw error;
  }

  const reason = invalidPreferenceReason(contents);
  if (reason === undefined) {
    return { status: 'healthy' };
  }

  const backupPath = await nextBackupPath(settingsPath, now());
  await rename(settingsPath, backupPath);
  try {
    await writeFile(settingsPath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rename(backupPath, settingsPath).catch(() => undefined);
    throw error;
  }
  return { status: 'recovered', backupPath, reason };
}

export function invalidPreferenceReason(contents: string): string | undefined {
  const document = parseDocument(contents, { prettyErrors: true });
  if (document.errors.length > 0) {
    return document.errors
      .map((error) => {
        const location = error.linePos?.[0];
        return location === undefined
          ? error.code
          : `${error.code} at line ${String(location.line)}, column ${String(location.col)}`;
      })
      .join('; ');
  }
  const root: unknown = document.toJS() ?? {};
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return 'settings document root must be a map';
  }
  return undefined;
}

async function nextBackupPath(settingsPath: string, date: Date): Promise<string> {
  const stamp = date.toISOString().replaceAll(/[:.]/g, '-');
  const base = `${settingsPath}.corrupt-${stamp}`;
  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${String(suffix)}`;
    try {
      await access(candidate);
    } catch (error) {
      if (isMissingFile(error)) {
        return candidate;
      }
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
