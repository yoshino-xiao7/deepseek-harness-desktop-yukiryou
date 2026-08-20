import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repositoryRoot, 'skills/yukiryou-pet-authoring/scripts/optical-flow-interpolator.swift');
const options = parseOptions(process.argv.slice(2));
const contract = JSON.parse(await readFile(
  join(repositoryRoot, 'skills/yukiryou-pet-authoring/references/motion-contract.json'),
  'utf8',
));
const spec = contract.motions[options.motion];
if (spec === undefined) throw new Error(`unsupported motion: ${options.motion}`);

const toolchain = join(options.runDirectory, '.toolchain');
const binary = join(toolchain, 'optical-flow-interpolator');
const moduleCache = join(toolchain, 'swift-module-cache');
await mkdir(toolchain, { recursive: true });
await mkdir(moduleCache, { recursive: true });
if (await needsBuild(source, binary)) {
  await run('xcrun', [
    'swiftc',
    '-module-cache-path', moduleCache,
    source,
    '-framework', 'Vision',
    '-framework', 'CoreGraphics',
    '-framework', 'CoreVideo',
    '-framework', 'ImageIO',
    '-framework', 'UniformTypeIdentifiers',
    '-o', binary,
  ], {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: moduleCache,
    SWIFT_MODULECACHE_PATH: moduleCache,
  });
}

const keyframes = join(options.runDirectory, 'generated', 'keyframes', options.motion);
const frames = join(options.runDirectory, 'generated', 'frames', options.motion);
const atlas = join(options.runDirectory, 'generated', 'atlases', `${options.motion}.png`);
await access(keyframes);
await Promise.all([
  mkdir(dirname(frames), { recursive: true }),
  mkdir(dirname(atlas), { recursive: true }),
]);
const stdout = await run(binary, [
  `--input=${keyframes}`,
  `--output=${frames}`,
  `--frames=${spec.frameCount}`,
  `--loop=${String(spec.loop)}`,
  `--atlas=${atlas}`,
  '--columns=16',
], process.env);
const result = JSON.parse(stdout);
const evidencePath = join(options.runDirectory, 'generated', `${options.motion}.json`);
await writeFile(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  motion: options.motion,
  durationMs: spec.durationMs,
  columns: 16,
  rows: Math.ceil(spec.frameCount / 16),
  frameCount: spec.frameCount,
  loop: spec.loop,
  mediaType: 'image/png',
  atlas: `atlases/${options.motion}.png`,
  synthesis: result,
}, null, 2)}\n`, { flag: 'wx' });

process.stdout.write(`${JSON.stringify({
  status: 'complete',
  motion: options.motion,
  frames: spec.frameCount,
  atlas,
  evidence: evidencePath,
})}\n`);

function parseOptions(args) {
  const values = new Map();
  for (const argument of args) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw new Error(`invalid argument: ${argument}`);
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  const runDirectory = values.get('run');
  const motion = values.get('motion');
  if (runDirectory === undefined || motion === undefined || values.size !== 2) {
    throw new Error('usage: pnpm pet:authoring:synthesize --run=<run-directory> --motion=<motion>');
  }
  return { runDirectory: resolve(runDirectory), motion };
}

async function needsBuild(sourcePath, binaryPath) {
  try {
    const [sourceStat, binaryStat] = await Promise.all([stat(sourcePath), stat(binaryPath)]);
    return sourceStat.mtimeMs > binaryStat.mtimeMs;
  } catch {
    return true;
  }
}

async function run(command, args, environment) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveRun(Buffer.concat(stdout).toString('utf8').trim());
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} exited ${code}`));
    });
  });
}
