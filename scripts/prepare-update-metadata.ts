import { resolve } from 'node:path';

import { writeUpdateMetadata } from './update-metadata.ts';

await writeUpdateMetadata({
  sourceDirectory: resolve(requiredArgument('--assets')),
  outputDirectory: resolve(requiredArgument('--output')),
  version: requiredArgument('--version'),
  origin: argument('--origin'),
  target: targetArgument(),
});

function targetArgument(): 'darwin-arm64' | 'win32-x64' | undefined {
  const value = argument('--target');
  if (value === undefined) return undefined;
  if (value !== 'darwin-arm64' && value !== 'win32-x64') {
    throw new Error(`Unsupported --target=${value}`);
  }
  return value;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
}

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
