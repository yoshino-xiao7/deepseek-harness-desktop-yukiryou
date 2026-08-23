import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import {
  writeUpdateMetadata,
  writeWebsiteDownloadManifest,
} from './update-metadata.js';

interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly gitCommit: string;
  readonly dirtyWorktree: boolean;
}

const sourceDirectory = resolve(requiredArgument('--assets'));
const outputDirectory = resolve(requiredArgument('--output'));
const version = requiredArgument('--version');
const origin = (argument('--origin') ?? 'https://download-cn.suzuki.ink').replace(/\/+$/u, '');
const manifest = JSON.parse(
  await readFile(join(sourceDirectory, 'release-manifest.json'), 'utf8'),
) as ReleaseManifest;

if (
  manifest.schemaVersion !== 1 ||
  manifest.version !== version ||
  manifest.dirtyWorktree !== false ||
  !/^[0-9a-f]{40}$/u.test(manifest.gitCommit)
) {
  throw new Error('Release manifest does not describe the requested immutable release');
}

const tag = `v${version}`;
const artifactBase = 'DeepSeek.YukiRyou';
const macDmg = `${artifactBase}-${version}-arm64.dmg`;
const macZip = `${artifactBase}-darwin-arm64-${version}.zip`;
const windowsSetup = `${artifactBase}-${version}-win32-x64-Setup.exe`;
const windowsPortable = `${artifactBase}-win32-x64-${version}-portable.zip`;
const immutableAssets = [
  macDmg,
  macZip,
  windowsSetup,
  windowsPortable,
  'SHA256SUMS.txt',
  'SHA256SUMS-Windows.txt',
  'release-manifest.json',
  'notarization-log.json',
];

const immutableRoot = join(outputDirectory, 'releases', tag);
await mkdir(immutableRoot, { recursive: true });
for (const asset of immutableAssets) {
  await copyFile(join(sourceDirectory, asset), join(immutableRoot, basename(asset)));
}

await writeUpdateMetadata({
  sourceDirectory,
  outputDirectory: join(outputDirectory, 'updates'),
  version,
  origin,
});
await writeWebsiteDownloadManifest({
  sourceDirectory,
  outputDirectory,
  version,
  origin,
  gitCommit: manifest.gitCommit,
});

function requiredArgument(name: string): string {
  const value = argument(name);
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
