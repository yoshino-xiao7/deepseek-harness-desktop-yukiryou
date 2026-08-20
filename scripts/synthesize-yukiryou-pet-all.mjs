import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runDirectory = parseOptions(process.argv.slice(2));
const contract = JSON.parse(await readFile(
  join(repositoryRoot, 'skills/yukiryou-pet-authoring/references/motion-contract.json'),
  'utf8',
));
const completed = [];
const skipped = [];

for (const [motion, spec] of Object.entries(contract.motions)) {
  if (await hasCompletedEvidence(runDirectory, motion, spec)) {
    skipped.push(motion);
    continue;
  }
  await run(process.execPath, [
    join(repositoryRoot, 'scripts/synthesize-yukiryou-pet-motion.mjs'),
    `--run=${runDirectory}`,
    `--motion=${motion}`,
  ]);
  completed.push(motion);
}

process.stdout.write(`${JSON.stringify({ status: 'complete', completed, skipped })}\n`);

function parseOptions(args) {
  if (args.length !== 1 || !args[0].startsWith('--run=') || args[0].length <= 6) {
    throw new Error('usage: pnpm pet:authoring:synthesize-all --run=<run-directory>');
  }
  return resolve(args[0].slice(6));
}

async function hasCompletedEvidence(root, motion, spec) {
  try {
    const evidence = JSON.parse(await readFile(join(root, 'generated', `${motion}.json`), 'utf8'));
    if (
      evidence.schemaVersion !== 1
      || evidence.motion !== motion
      || evidence.frameCount !== spec.frameCount
      || evidence.durationMs !== spec.durationMs
      || evidence.loop !== spec.loop
      || evidence.synthesis?.status !== 'complete'
    ) return false;
    await access(join(root, 'generated', 'atlases', `${motion}.png`));
    return true;
  } catch {
    return false;
  }
}

async function run(command, args) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} exited ${code}`));
    });
  });
}
