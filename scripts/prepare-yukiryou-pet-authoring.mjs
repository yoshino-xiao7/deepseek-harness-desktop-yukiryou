import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runnerImport } from 'vite';

const options = parseOptions(process.argv.slice(2));
const request = JSON.parse(await readFile(options.requestFile, 'utf8'));
const { module } = await runnerImport('./src/main/pet/pet-skill-run-preparer.ts', {
  configFile: false,
  logLevel: 'error',
});
const result = await module.preparePetSkillRun(request, options.outputDirectory);
process.stdout.write(`${JSON.stringify({
  status: 'ready',
  rootDirectory: result.rootDirectory,
  jobCount: result.jobs.length,
  motionCount: result.jobs.filter(({ kind }) => kind === 'motion-family').length,
})}\n`);

function parseOptions(args) {
  const values = new Map();
  for (const argument of args) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw new Error(`invalid argument: ${argument}`);
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  const requestFile = values.get('request');
  const outputDirectory = values.get('output');
  if (requestFile === undefined || outputDirectory === undefined || values.size !== 2) {
    throw new Error('usage: pnpm pet:authoring:prepare --request=<request.json> --output=<new-directory>');
  }
  return { requestFile: resolve(requestFile), outputDirectory: resolve(outputDirectory) };
}
