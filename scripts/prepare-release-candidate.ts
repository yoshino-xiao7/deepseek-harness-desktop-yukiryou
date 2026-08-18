import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageManifest {
  readonly version: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productName = 'DeepSeek YukiRyou';
const architecture = 'arm64';
const outputDirectory = join(projectRoot, 'out', 'release-candidate');
const applicationPath = join(
  projectRoot,
  'out',
  `${productName}-darwin-${architecture}`,
  `${productName}.app`,
);
const packageManifest = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const gitCommit = capture('git', ['rev-parse', 'HEAD']).trim();
const gitStatus = capture('git', ['status', '--porcelain']).trim();

if (process.env.MACOS_SIGN_IDENTITY?.trim() === '') {
  throw new Error('MACOS_SIGN_IDENTITY cannot be empty');
}
if (process.env.MACOS_SIGN_IDENTITY === undefined) {
  throw new Error('MACOS_SIGN_IDENTITY is required for a release candidate');
}
if (gitStatus !== '') {
  throw new Error('Release candidates require a clean Git worktree');
}

run('pnpm', ['package:mac', '--', '--arch=arm64']);
run('pnpm', [
  'verify:release',
  '--',
  `--app=${applicationPath}`,
  '--expect-arch=arm64',
  '--require-signed=true',
]);

await mkdir(outputDirectory, { recursive: true });
const archivePath = join(
  outputDirectory,
  `${productName}-darwin-${architecture}-${packageManifest.version}-candidate.zip`,
);
const manifestPath = join(outputDirectory, 'candidate-manifest.json');
await rm(archivePath, { force: true });
run('ditto', ['-c', '-k', '--keepParent', applicationPath, archivePath]);
const digest = await sha256(archivePath);
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      productName,
      version: packageManifest.version,
      architecture,
      gitCommit,
      archive: {
        file: basename(archivePath),
        sha256: digest,
      },
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Release candidate ready: ${archivePath}\n`);

function run(command: string, arguments_: readonly string[]): void {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
}

function capture(command: string, arguments_: readonly string[]): string {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
  return result.stdout;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest('hex');
}
