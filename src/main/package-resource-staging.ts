import {
  link,
  lstat,
  mkdir,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export interface PackageResourceStagingResult {
  readonly copiedFiles: number;
  readonly copiedSymlinks: number;
  readonly excludedConflictCopies: number;
}

export function canonicalConflictSiblingName(name: string): string | undefined {
  const match = /^(.*) ([2-9])(\..+)?$/.exec(name);
  if (match === null) return undefined;
  const stem = match[1];
  if (stem === undefined || stem === '') return undefined;
  return `${stem}${match[3] ?? ''}`;
}

export async function stagePackageResourceTree(
  sourceDirectory: string,
  targetDirectory: string,
): Promise<PackageResourceStagingResult> {
  const source = resolve(sourceDirectory);
  const target = resolve(targetDirectory);
  if (source === target || isWithin(source, target) || isWithin(target, source)) {
    throw new Error('Package resource source and target must be separate trees');
  }
  const staging = join(
    dirname(target),
    `.${basename(target)}-staging-${String(process.pid)}-${Date.now().toString(36)}`,
  );
  const counters = { copiedFiles: 0, copiedSymlinks: 0, excludedConflictCopies: 0 };
  await mkdir(dirname(target), { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    await mirrorDirectory(source, staging, counters);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return counters;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function mirrorDirectory(
  source: string,
  target: string,
  counters: { copiedFiles: number; copiedSymlinks: number; excludedConflictCopies: number },
): Promise<void> {
  const sourceStat = await lstat(source);
  await mkdir(target, { recursive: true, mode: sourceStat.mode });
  const entries = (await readdir(source, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of entries) {
    const canonical = canonicalConflictSiblingName(entry.name);
    if (canonical !== undefined && names.has(canonical)) {
      counters.excludedConflictCopies += 1;
      continue;
    }
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await mirrorDirectory(sourcePath, targetPath, counters);
    } else if (entry.isSymbolicLink()) {
      await symlink(await readlink(sourcePath), targetPath);
      counters.copiedSymlinks += 1;
    } else if (entry.isFile()) {
      await link(sourcePath, targetPath);
      counters.copiedFiles += 1;
    } else {
      throw new Error(`Unsupported package resource entry: ${sourcePath}`);
    }
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`);
}
