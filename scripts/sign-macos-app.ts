import { close, open, read, readdir, stat } from 'node:fs';
import { promisify } from 'node:util';
import { spawnSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';

const closeAsync = promisify(close);
const openAsync = promisify(open);
const readAsync = promisify(read);
const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);

const options = new Map(
  process.argv
    .slice(2)
    .filter((value) => value.startsWith('--') && value.includes('='))
    .map((value) => {
      const separator = value.indexOf('=');
      return [value.slice(2, separator), value.slice(separator + 1)];
    }),
);

const appPath = options.get('app');
const identity = options.get('identity');
const entitlements = options.get('entitlements');
if (appPath === undefined || identity === undefined || entitlements === undefined) {
  throw new Error(
    'Usage: sign:mac -- --app=<path> --identity=<Developer ID> --entitlements=<path>',
  );
}

const absoluteAppPath = resolve(appPath);
const absoluteEntitlements = resolve(entitlements);
const binaries: string[] = [];
const bundles: string[] = [];

await walk(join(absoluteAppPath, 'Contents'));
binaries.sort(deepestFirst);
bundles.sort(deepestFirst);

for (const binary of binaries) {
  codesign(binary, false);
}
for (const bundle of bundles) {
  codesign(bundle, true);
}
// Electron Forge leaves an outer signature on the main executable. Replacing
// it with `--force` alone can leave a CMS blob that only verifies through the
// local code-signing cache; a copied app then fails with "invalid signature".
// Removing the outer signature first makes the new Developer ID signature
// portable across ZIP extraction and normal /Applications copies.
removeSignature(absoluteAppPath);
codesign(absoluteAppPath, true);

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', absoluteAppPath]);
process.stdout.write(
  `Signed ${binaries.length} Mach-O files and ${bundles.length + 1} bundles\n`,
);

async function walk(directory: string): Promise<void> {
  for (const entry of await readdirAsync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(path);
      if (extname(path) === '.app' || extname(path) === '.framework') {
        bundles.push(path);
      }
      continue;
    }
    if (entry.isFile() && (await isMachO(path))) binaries.push(path);
  }
}

async function isMachO(path: string): Promise<boolean> {
  if ((await statAsync(path)).size < 4) return false;
  const descriptor = await openAsync(path, 'r');
  try {
    const bytes = Buffer.allocUnsafe(4);
    const result = await readAsync(descriptor, bytes, 0, bytes.length, 0);
    if (result.bytesRead !== 4) return false;
    return new Set([
      0xfeedface,
      0xfeedfacf,
      0xcefaedfe,
      0xcffaedfe,
      0xcafebabe,
      0xbebafeca,
      0xcafebabf,
      0xbfbafeca,
    ]).has(bytes.readUInt32BE(0));
  } finally {
    await closeAsync(descriptor);
  }
}

function codesign(path: string, includeEntitlements: boolean): void {
  const arguments_ = [
    '--force',
    '--options',
    'runtime',
    '--timestamp',
    '--sign',
    identity as string,
  ];
  if (includeEntitlements) {
    arguments_.push('--entitlements', absoluteEntitlements);
  }
  arguments_.push(path);
  run('codesign', arguments_);
}

function removeSignature(path: string): void {
  run('codesign', ['--remove-signature', path]);
}

function run(command: string, arguments_: string[]): void {
  const result = spawnSync(command, arguments_, { shell: false, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
}

function deepestFirst(left: string, right: string): number {
  return right.split('/').length - left.split('/').length;
}
