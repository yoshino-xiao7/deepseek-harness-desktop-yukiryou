import { resolve } from 'node:path';

import { writeUpdateMetadata } from './update-metadata.js';

await writeUpdateMetadata({
  sourceDirectory: resolve(requiredArgument('--assets')),
  outputDirectory: resolve(requiredArgument('--output')),
  version: requiredArgument('--version'),
  origin: argument('--origin'),
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
