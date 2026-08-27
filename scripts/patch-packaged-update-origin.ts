import { createPackage, extractAll } from '@electron/asar';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface PatchOptions {
  readonly archive: string;
  readonly from: string;
  readonly to: string;
}

const textExtensions = new Set(['.cjs', '.js', '.json', '.mjs']);

export async function patchPackagedUpdateOrigin(options: PatchOptions): Promise<void> {
  const archive = resolve(options.archive);
  if (options.from === '' || options.to === '' || options.from === options.to) {
    throw new Error('Update origin replacement must contain two distinct non-empty values');
  }
  if (Buffer.byteLength(options.from) !== Buffer.byteLength(options.to)) {
    throw new Error('Packaged update origin replacement must preserve byte length');
  }

  const workspace = await mkdtemp(join(tmpdir(), 'dsh-packaged-update-origin-'));
  const extracted = join(workspace, 'app');
  const replacement = join(dirname(archive), `${archive.split(/[\\/]/u).at(-1)}.next`);
  const backup = join(dirname(archive), `${archive.split(/[\\/]/u).at(-1)}.before-origin-patch`);
  try {
    extractAll(archive, extracted);
    let replacements = 0;
    for (const file of await textFiles(extracted)) {
      const source = await readFile(file, 'utf8');
      const matches = source.split(options.from).length - 1;
      if (matches === 0) continue;
      replacements += matches;
      await writeFile(file, source.replaceAll(options.from, options.to));
    }
    if (replacements !== 1) {
      throw new Error(`Expected one packaged update origin, found ${replacements}`);
    }

    await createPackage(extracted, replacement);
    await rename(archive, backup);
    try {
      await rename(replacement, archive);
    } catch (error) {
      await rename(backup, archive);
      throw error;
    }
    await rm(backup, { force: true });
  } finally {
    await rm(replacement, { force: true });
    await rm(workspace, { recursive: true, force: true });
  }
}

async function textFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await textFiles(path));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function required(name: string): string {
  const prefix = `${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await patchPackagedUpdateOrigin({
    archive: required('--archive'),
    from: required('--from'),
    to: required('--to'),
  });
}
