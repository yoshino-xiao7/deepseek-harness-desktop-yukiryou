import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type RuntimeArchitecture = 'arm64' | 'x64';

interface SourceRuntimeManifest {
  readonly node: { readonly version: string };
  readonly dsh: { readonly version: string; readonly integrity: string };
  readonly pnpm: { readonly version: string; readonly integrity: string };
}

interface InstalledRuntimeManifest extends SourceRuntimeManifest {
  readonly architecture: RuntimeArchitecture;
  readonly nodeExecutable: string;
  readonly dshEntrypoint: string;
  readonly pnpmEntrypoint: string;
}

interface RuntimePackageJson {
  readonly dependencies: Record<string, string>;
  readonly allowScripts: Record<string, boolean>;
}

interface DependencyPackageJson {
  readonly version: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeDirectory = join(projectRoot, 'resources', 'runtime');
const sourceManifest = await readJson<SourceRuntimeManifest>(
  join(projectRoot, 'runtime', 'manifest.json'),
);
const runtimePackage = await readJson<RuntimePackageJson>(
  join(projectRoot, 'runtime', 'package.json'),
);
const manifest = await readJson<InstalledRuntimeManifest>(
  join(runtimeDirectory, 'runtime-manifest.json'),
);
const nodeExecutable = join(runtimeDirectory, manifest.nodeExecutable);
const dshEntrypoint = join(runtimeDirectory, manifest.dshEntrypoint);
const pnpmEntrypoint = join(runtimeDirectory, manifest.pnpmEntrypoint);
const runtimeNodeModules = join(runtimeDirectory, 'dsh', 'node_modules');
const nodePtyDirectory = join(runtimeNodeModules, 'node-pty');
const sharpDirectory = join(runtimeNodeModules, 'sharp');
const koffiDirectory = join(runtimeNodeModules, 'koffi');
for (const [packageName, expectedVersion] of Object.entries(
  runtimePackage.dependencies,
)) {
  const installed = await readJson<DependencyPackageJson>(
    join(runtimeNodeModules, packageName, 'package.json'),
  );
  expectValue(`${packageName} version`, installed.version, expectedVersion);
}
const nodePtyManifest = await readJson<DependencyPackageJson>(
  join(nodePtyDirectory, 'package.json'),
);
const nodePtyPrebuild = join(
  nodePtyDirectory,
  'prebuilds',
  `darwin-${manifest.architecture}`,
);
const ptyNativeModule = join(nodePtyPrebuild, 'pty.node');
const ptySpawnHelper = join(nodePtyPrebuild, 'spawn-helper');

expectValue('Node version', manifest.node.version, sourceManifest.node.version);
expectValue('dsh version', manifest.dsh.version, sourceManifest.dsh.version);
expectValue(
  'dsh integrity',
  manifest.dsh.integrity,
  sourceManifest.dsh.integrity,
);
expectValue('pnpm version', manifest.pnpm.version, sourceManifest.pnpm.version);
expectValue(
  'pnpm integrity',
  manifest.pnpm.integrity,
  sourceManifest.pnpm.integrity,
);
expectValue(
  'node-pty version',
  nodePtyManifest.version,
  allowedScriptVersion(runtimePackage, 'node-pty'),
);

expectOutput(nodeExecutable, ['--version'], `v${manifest.node.version}`);
expectOutput(
  nodeExecutable,
  ['--print', 'process.arch'],
  manifest.architecture,
);
expectArchitecture(nodeExecutable, manifest.architecture);
expectArchitecture(ptyNativeModule, manifest.architecture);
expectArchitecture(ptySpawnHelper, manifest.architecture);
if (((await stat(ptySpawnHelper)).mode & 0o111) === 0) {
  throw new Error(`node-pty spawn-helper is not executable: ${ptySpawnHelper}`);
}
expectOutput(
  nodeExecutable,
  [dshEntrypoint, '--version'],
  manifest.dsh.version,
);
expectOutput(
  nodeExecutable,
  [pnpmEntrypoint, '--version'],
  manifest.pnpm.version,
);
expectOutput(
  nodeExecutable,
  ['-e', nodePtySmokeScript(), nodePtyDirectory],
  'DSH_PTY_OK',
);
expectOutput(
  nodeExecutable,
  ['-e', sharpSmokeScript(), sharpDirectory],
  'DSH_SHARP_OK',
);
expectOutput(
  nodeExecutable,
  [
    '-e',
    "require(process.argv[1]); process.stdout.write('DSH_KOFFI_OK')",
    koffiDirectory,
  ],
  'DSH_KOFFI_OK',
);
process.stdout.write(
  `Verified Node ${manifest.node.version} + dsh ${manifest.dsh.version} + pnpm ${manifest.pnpm.version} + node-pty ${nodePtyManifest.version} + sharp + koffi (${manifest.architecture})\n`,
);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

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

function expectArchitecture(path: string, expected: RuntimeArchitecture): void {
  const actual = output('lipo', ['-archs', path]);
  const expectedMachArchitecture = expected === 'x64' ? 'x86_64' : expected;
  if (actual !== expectedMachArchitecture) {
    throw new Error(
      `${path} architecture ${actual} does not match ${expected}`,
    );
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

function expectOutput(
  command: string,
  args: readonly string[],
  expected: string,
): void {
  const actual = output(command, args);
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function output(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}
