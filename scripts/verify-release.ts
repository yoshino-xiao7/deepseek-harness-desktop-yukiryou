import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Architecture = 'arm64' | 'x64';

interface RuntimeManifest {
  readonly architecture: Architecture;
  readonly node: { readonly version: string };
  readonly dsh: { readonly version: string };
  readonly pnpm: { readonly version: string };
}

interface RuntimePackageJson {
  readonly allowScripts: Record<string, boolean>;
}

interface DependencyPackageJson {
  readonly version: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const arguments_ = new Map(
  process.argv
    .slice(2)
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => {
      const separator = argument.indexOf('=');
      return [argument.slice(2, separator), argument.slice(separator + 1)];
    }),
);
const requestedApplicationPath = arguments_.get('app');
const architecture = arguments_.get('expect-arch');
if (requestedApplicationPath === undefined) {
  throw new Error('Usage: verify-release --app=<path> --expect-arch=arm64|x64');
}
if (architecture !== 'arm64' && architecture !== 'x64') {
  throw new Error('--expect-arch must be arm64 or x64');
}
const applicationPath = resolve(requestedApplicationPath);

const resources = join(applicationPath, 'Contents', 'Resources');
const executable = join(
  applicationPath,
  'Contents',
  'MacOS',
  basename(applicationPath, '.app'),
);
const runtimeNode = join(resources, 'runtime', 'node', 'bin', 'node');
const runtimeNodeModules = join(resources, 'runtime', 'dsh', 'node_modules');
const nodePtyDirectory = join(runtimeNodeModules, 'node-pty');
const nodePtyPrebuild = join(
  nodePtyDirectory,
  'prebuilds',
  `darwin-${architecture}`,
);
const ptyNativeModule = join(nodePtyPrebuild, 'pty.node');
const ptySpawnHelper = join(nodePtyPrebuild, 'spawn-helper');
const sharpDirectory = join(runtimeNodeModules, 'sharp');
const koffiDirectory = join(runtimeNodeModules, 'koffi');
const manifest = JSON.parse(
  await readFile(join(resources, 'runtime', 'runtime-manifest.json'), 'utf8'),
) as RuntimeManifest;
const runtimePackage = JSON.parse(
  await readFile(join(projectRoot, 'runtime', 'package.json'), 'utf8'),
) as RuntimePackageJson;
const nodePtyManifest = JSON.parse(
  await readFile(join(nodePtyDirectory, 'package.json'), 'utf8'),
) as DependencyPackageJson;

await stat(join(resources, 'app.asar'));
const updateBootstrap = await readFile(join(resources, 'app-update.yml'), 'utf8');
for (const requiredLine of [
  'provider: github',
  'owner: yoshino-xiao7',
  'repo: deepseek-harness-desktop-yukiryou',
]) {
  if (!updateBootstrap.includes(requiredLine)) {
    throw new Error(`Updater bootstrap is missing ${requiredLine}`);
  }
}
expectArchitecture(executable, architecture);
expectArchitecture(runtimeNode, architecture);
expectArchitecture(ptyNativeModule, architecture);
expectArchitecture(ptySpawnHelper, architecture);
if (((await stat(ptySpawnHelper)).mode & 0o111) === 0) {
  throw new Error(`node-pty spawn-helper is not executable: ${ptySpawnHelper}`);
}
if (manifest.architecture !== architecture) {
  throw new Error(
    `Runtime architecture ${manifest.architecture} does not match ${architecture}`,
  );
}
expectValue(
  'node-pty version',
  nodePtyManifest.version,
  allowedScriptVersion(runtimePackage, 'node-pty'),
);
expectOutput(
  runtimeNode,
  ['-e', nodePtySmokeScript(), nodePtyDirectory],
  'DSH_PTY_OK',
);
expectOutput(
  runtimeNode,
  ['-e', sharpSmokeScript(), sharpDirectory],
  'DSH_SHARP_OK',
);
expectOutput(
  runtimeNode,
  [
    '-e',
    "require(process.argv[1]); process.stdout.write('DSH_KOFFI_OK')",
    koffiDirectory,
  ],
  'DSH_KOFFI_OK',
);

if (arguments_.get('require-signed') === 'true') {
  run('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    applicationPath,
  ]);
  run('codesign', ['--verify', '--strict', '--verbose=2', ptyNativeModule]);
  run('codesign', ['--verify', '--strict', '--verbose=2', ptySpawnHelper]);
  const signature = run(
    'codesign',
    ['-dv', '--verbose=2', applicationPath],
    true,
  );
  if (
    signature.includes('TeamIdentifier=not set') ||
    signature.includes('adhoc')
  ) {
    throw new Error(
      'Release must use a Developer ID signature, not an ad-hoc signature',
    );
  }
}
if (arguments_.get('require-notarized') === 'true') {
  run('spctl', [
    '--assess',
    '--type',
    'execute',
    '--verbose=4',
    applicationPath,
  ]);
  run('xcrun', ['stapler', 'validate', applicationPath]);
}

const digest = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
process.stdout.write(
  `Verified ${basename(applicationPath)} (${architecture}); Node ${manifest.node.version}, dsh ${manifest.dsh.version}, pnpm ${manifest.pnpm.version}, node-pty ${nodePtyManifest.version}, sharp and koffi; executable SHA-256 ${digest}\n`,
);

function expectValue(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function allowedScriptVersion(
  packageJson: RuntimePackageJson,
  packageName: string,
): string {
  const prefix = `${packageName}@`;
  const matches = Object.entries(packageJson.allowScripts)
    .filter(([name, allowed]) => allowed && name.startsWith(prefix))
    .map(([name]) => name.slice(prefix.length));
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Expected exactly one allowed ${packageName} install script`,
    );
  }
  return matches[0];
}

function expectOutput(
  command: string,
  args: readonly string[],
  expected: string,
): void {
  const actual = run(command, args, true, 15_000).trim();
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function nodePtySmokeScript(): string {
  return String.raw`
const nodePty = require(process.argv[1]);
const marker = 'DSH_PTY_OK';
const child = nodePty.spawn('/bin/zsh', ['-f'], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color' },
});
let observed = '';
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 5_000);
child.onData((data) => { observed += data; });
child.onExit(({ exitCode }) => {
  clearTimeout(timer);
  if (!timedOut && exitCode === 0 && observed.includes(marker)) {
    process.stdout.write(marker);
    return;
  }
  process.stderr.write(observed);
  process.exitCode = 1;
});
child.write("printf 'DSH_%s_OK\\n' PTY; exit\r");
`;
}

function sharpSmokeScript(): string {
  return String.raw`
const sharp = require(process.argv[1]);
sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .png()
  .toBuffer()
  .then(
    (buffer) => {
      if (buffer.length === 0) throw new Error('sharp returned an empty PNG');
      process.stdout.write('DSH_SHARP_OK');
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
`;
}

function expectArchitecture(path: string, expected: Architecture): void {
  const actual = run('lipo', ['-archs', path], true).trim();
  const expectedMachArchitecture = expected === 'x64' ? 'x86_64' : expected;
  if (actual !== expectedMachArchitecture) {
    throw new Error(
      `${path} architecture ${actual} does not match ${expected}`,
    );
  }
}

function run(
  command: string,
  args: readonly string[],
  capture = false,
  timeout?: number,
): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    stdio: capture ? 'pipe' : 'inherit',
    timeout,
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
