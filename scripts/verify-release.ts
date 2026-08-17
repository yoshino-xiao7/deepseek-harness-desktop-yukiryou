import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

type Architecture = 'arm64' | 'x64';

interface RuntimeManifest {
  readonly architecture: Architecture;
  readonly node: { readonly version: string };
  readonly dsh: { readonly version: string };
  readonly pnpm: { readonly version: string };
}

const arguments_ = new Map(
  process.argv
    .slice(2)
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => {
      const separator = argument.indexOf('=');
      return [argument.slice(2, separator), argument.slice(separator + 1)];
    }),
);
const applicationPath = arguments_.get('app');
const architecture = arguments_.get('expect-arch');
if (applicationPath === undefined) {
  throw new Error('Usage: verify-release --app=<path> --expect-arch=arm64|x64');
}
if (architecture !== 'arm64' && architecture !== 'x64') {
  throw new Error('--expect-arch must be arm64 or x64');
}

const resources = join(applicationPath, 'Contents', 'Resources');
const executable = join(
  applicationPath,
  'Contents',
  'MacOS',
  basename(applicationPath, '.app'),
);
const runtimeNode = join(resources, 'runtime', 'node', 'bin', 'node');
const manifest = JSON.parse(
  await readFile(join(resources, 'runtime', 'runtime-manifest.json'), 'utf8'),
) as RuntimeManifest;

await stat(join(resources, 'app.asar'));
expectArchitecture(executable, architecture);
expectArchitecture(runtimeNode, architecture);
if (manifest.architecture !== architecture) {
  throw new Error(
    `Runtime architecture ${manifest.architecture} does not match ${architecture}`,
  );
}

if (arguments_.get('require-signed') === 'true') {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', applicationPath]);
  const signature = run('codesign', ['-dv', '--verbose=2', applicationPath], true);
  if (signature.includes('TeamIdentifier=not set') || signature.includes('adhoc')) {
    throw new Error('Release must use a Developer ID signature, not an ad-hoc signature');
  }
}
if (arguments_.get('require-notarized') === 'true') {
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', applicationPath]);
  run('xcrun', ['stapler', 'validate', applicationPath]);
}

const digest = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
process.stdout.write(
  `Verified ${basename(applicationPath)} (${architecture}); Node ${manifest.node.version}, dsh ${manifest.dsh.version}, pnpm ${manifest.pnpm.version}; executable SHA-256 ${digest}\n`,
);

function expectArchitecture(path: string, expected: Architecture): void {
  const actual = run('lipo', ['-archs', path], true).trim();
  const expectedMachArchitecture = expected === 'x64' ? 'x86_64' : expected;
  if (actual !== expectedMachArchitecture) {
    throw new Error(`${path} architecture ${actual} does not match ${expected}`);
  }
}

function run(
  command: string,
  args: readonly string[],
  capture = false,
): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}
