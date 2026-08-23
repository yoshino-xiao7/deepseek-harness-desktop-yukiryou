import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

interface UpdateMetadata {
  readonly version?: unknown;
  readonly files?: unknown;
}

const directory = resolve(requiredArgument('--assets'));
const version = requiredArgument('--version');
await verify('latest-mac.yml', `DeepSeek.YukiRyou-darwin-arm64-${version}.zip`);
await verify('latest.yml', `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`);

async function verify(metadataName: string, artifactName: string): Promise<void> {
  const metadata = parse(await readFile(join(directory, metadataName), 'utf8')) as UpdateMetadata;
  if (metadata.version !== version || !Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error(`${metadataName} has an invalid version or file set`);
  }
  const file = metadata.files[0] as Record<string, unknown>;
  const artifact = join(directory, artifactName);
  if (
    typeof file.url !== 'string' ||
    (!file.url.endsWith(`/${artifactName}`) && file.url !== artifactName) ||
    file.size !== (await stat(artifact)).size ||
    file.sha512 !== await digestSha512(artifact)
  ) {
    throw new Error(`${metadataName} does not bind the exact ${artifactName} bytes`);
  }
}

async function digestSha512(path: string): Promise<string> {
  const hash = createHash('sha512');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest('base64');
}

function requiredArgument(name: string): string {
  const prefix = `${name}=`;
  const value = process.argv.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}
