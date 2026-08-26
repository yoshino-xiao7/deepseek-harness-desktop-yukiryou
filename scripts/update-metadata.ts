import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { stringify } from 'yaml';

export async function writeUpdateMetadata(options: {
  readonly sourceDirectory: string;
  readonly outputDirectory: string;
  readonly version: string;
  readonly origin?: string;
  readonly target?: 'darwin-arm64' | 'win32-x64';
}): Promise<readonly string[]> {
  const artifactBase = 'DeepSeek.YukiRyou';
  const targets = [
    {
      directory: 'darwin-arm64',
      metadata: 'latest-mac.yml',
      artifact: `${artifactBase}-darwin-arm64-${options.version}.zip`,
    },
    {
      directory: 'win32-x64',
      metadata: 'latest.yml',
      artifact: `${artifactBase}-${options.version}-win32-x64-Setup.exe`,
    },
  ] as const;
  const written: string[] = [];
  for (const target of targets.filter((candidate) =>
    options.target === undefined || candidate.directory === options.target)) {
    const source = join(options.sourceDirectory, target.artifact);
    const output = join(options.outputDirectory, target.directory);
    const size = (await stat(source)).size;
    const sha512 = await digestSha512(source);
    const url = options.origin === undefined
      ? basename(target.artifact)
      : `${options.origin.replace(/\/+$/u, '')}/releases/v${options.version}/${target.artifact}`;
    await mkdir(output, { recursive: true });
    await writeFile(join(output, target.metadata), stringify({
      version: options.version,
      files: [{ url, sha512, size }],
      path: url,
      sha512,
    }));
    written.push(join(output, target.metadata));
  }
  return Object.freeze(written);
}

export async function writeWebsiteDownloadManifest(options: {
  readonly sourceDirectory: string;
  readonly outputDirectory: string;
  readonly version: string;
  readonly origin: string;
  readonly gitCommit: string;
}): Promise<string> {
  const artifactBase = 'DeepSeek.YukiRyou';
  const artifacts = {
    macDmg: `${artifactBase}-${options.version}-arm64.dmg`,
    macZip: `${artifactBase}-darwin-arm64-${options.version}.zip`,
    windowsSetup: `${artifactBase}-${options.version}-win32-x64-Setup.exe`,
    windowsPortable: `${artifactBase}-win32-x64-${options.version}-portable.zip`,
  } as const;
  const origin = options.origin.replace(/\/+$/u, '');
  const releaseRoot = `${origin}/releases/v${options.version}`;
  const download = async (name: string) => {
    const path = join(options.sourceDirectory, name);
    return {
      name,
      url: `${releaseRoot}/${name}`,
      size: (await stat(path)).size,
      sha256: await digest(path, 'sha256', 'hex'),
    };
  };
  const [macDmg, macZip, windowsSetup, windowsPortable] = await Promise.all([
    download(artifacts.macDmg),
    download(artifacts.macZip),
    download(artifacts.windowsSetup),
    download(artifacts.windowsPortable),
  ]);
  const destination = join(options.outputDirectory, 'downloads', 'latest.json');
  await mkdir(join(options.outputDirectory, 'downloads'), { recursive: true });
  await writeFile(destination, `${JSON.stringify({
    schemaVersion: 1,
    version: options.version,
    gitCommit: options.gitCommit,
    platforms: {
      'darwin-arm64': {
        primary: macDmg,
        alternative: macZip,
      },
      'win32-x64': {
        primary: windowsSetup,
        alternative: windowsPortable,
      },
    },
  }, null, 2)}\n`);
  return destination;
}

async function digestSha512(path: string): Promise<string> {
  return digest(path, 'sha512', 'base64');
}

async function digest(
  path: string,
  algorithm: 'sha256' | 'sha512',
  encoding: 'base64' | 'hex',
): Promise<string> {
  const hash = createHash(algorithm);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest(encoding);
}
