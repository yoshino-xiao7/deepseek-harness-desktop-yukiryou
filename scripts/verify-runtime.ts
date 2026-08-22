import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type BundledRuntimeArchitecture,
  type BundledRuntimePlatform,
  type BundledRuntimeTarget,
  resolveBundledRuntimePlatform,
} from '../src/main/runtime/runtime-platform.ts';

interface SourceRuntimeManifest {
  readonly schemaVersion: number;
  readonly node: { readonly version: string };
  readonly dsh: { readonly version: string; readonly integrity: string };
  readonly pnpm: { readonly version: string; readonly integrity: string };
}

interface InstalledRuntimeManifest extends SourceRuntimeManifest {
  readonly target: BundledRuntimeTarget;
  readonly platform: BundledRuntimePlatform;
  readonly architecture: BundledRuntimeArchitecture;
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
if (sourceManifest.schemaVersion !== 2 || manifest.schemaVersion !== 2) {
  throw new Error('Bundled Runtime manifest schema must be 2');
}
const layout = resolveBundledRuntimePlatform(
  manifest.platform,
  manifest.architecture,
);
if (layout.platform !== process.platform) {
  throw new Error(
    `Bundled Runtime ${layout.target} must be verified on ${layout.platform}, not ${process.platform}`,
  );
}
const nodeExecutable = join(runtimeDirectory, manifest.nodeExecutable);
const dshEntrypoint = join(runtimeDirectory, manifest.dshEntrypoint);
const pnpmEntrypoint = join(runtimeDirectory, manifest.pnpmEntrypoint);
const runtimeNodeModules = join(runtimeDirectory, 'dsh', 'node_modules');
const nodePtyDirectory = join(runtimeNodeModules, 'node-pty');
const sharpDirectory = join(runtimeNodeModules, 'sharp');
const koffiDirectory = join(runtimeNodeModules, 'koffi');
const desktopFrameManifest = await readJson<DependencyPackageJson>(
  join(runtimeNodeModules, '@dsh-desktop', 'frame-prototype', 'package.json'),
);
const desktopMarketManifest = await readJson<DependencyPackageJson>(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'package.json'),
);
await verifyBundledExtension('settings', 'desktop-settings-plugin', [
  'client.js', 'index.js', 'package.json', 'brand.png',
]);
await verifyBundledExtension('companion', 'desktop-companion-plugin', [
  'client.js', 'index.js', 'package.json',
]);
await verifyBundledExtension('frame-prototype', 'desktop-frame-plugin', [
  'client.js', 'index.js', 'package.json',
]);
await verifyBundledExtension('market', 'desktop-market-plugin', [
  'artifact-cache.js', 'artifact-verifier.js', 'catalog-cache.js',
  'catalog-network.js', 'catalog.js', 'client.js', 'dependency-graph.js',
  'development-fixture.js', 'index.js', 'install-inspector.js', 'media.js', 'managed-installer.js',
  'managed-preview-vault.js', 'package.json', 'runtime-snapshot.js',
  'source-registry.js',
]);
const desktopMarketCache = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'catalog-cache.js'),
  'utf8',
);
const desktopMarketSources = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'source-registry.js'),
  'utf8',
);
const desktopMarketMedia = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'media.js'),
  'utf8',
);
const desktopMarketInspector = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'install-inspector.js'),
  'utf8',
);
const desktopMarketDependencyGraph = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'dependency-graph.js'),
  'utf8',
);
const desktopMarketRuntimeSnapshot = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'runtime-snapshot.js'),
  'utf8',
);
const desktopMarketArtifactVerifier = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'artifact-verifier.js'),
  'utf8',
);
const desktopMarketArtifactCache = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'artifact-cache.js'),
  'utf8',
);
const desktopMarketManagedInstaller = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'managed-installer.js'),
  'utf8',
);
const desktopMarketManagedPreviewVault = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'managed-preview-vault.js'),
  'utf8',
);
const desktopMarketDevelopmentFixture = await readFile(
  join(runtimeNodeModules, '@dsh-desktop', 'market', 'development-fixture.js'),
  'utf8',
);
const loaderImplementation = await readFile(
  join(runtimeNodeModules, '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js'),
  'utf8',
);
const appBootImplementation = await readFile(
  join(runtimeNodeModules, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'),
  'utf8',
);
const dshLibDirectory = join(runtimeNodeModules, '@deepseek-ai', 'dsh', 'lib');
const profileBootFiles = (await readdir(dshLibDirectory))
  .filter((name) => /^profile-boot-[A-Za-z0-9_-]+\.js$/u.test(name));
const profileBootCandidates = await Promise.all(profileBootFiles.map(
  async (name) => readFile(join(dshLibDirectory, name), 'utf8'),
));
const profileBootImplementations = profileBootCandidates.filter(
  (source) => source.includes('function allPatches(composed)'),
);
if (profileBootImplementations.length !== 1 || profileBootImplementations[0] === undefined) {
  throw new Error('Expected exactly one bundled Harness profile boot implementation');
}
const profileBootImplementation = profileBootImplementations[0];
const legacyDesktopPatch = await readFile(
  join(runtimeDirectory, 'desktop-extensions.patch.yml'),
  'utf8',
);
const integratedDesktopPatch = await readFile(
  join(runtimeDirectory, 'desktop-integrated.patch.yml'),
  'utf8',
);
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
  layout.nodePtyPrebuild,
);
const ptyNativeFiles = layout.nodePtyNativeFiles.map((file) =>
  join(nodePtyPrebuild, file));

expectValue('Node version', manifest.node.version, sourceManifest.node.version);
expectValue('Runtime target', manifest.target, layout.target);
expectValue('dsh version', manifest.dsh.version, sourceManifest.dsh.version);
expectValue(
  'dsh integrity',
  manifest.dsh.integrity,
  sourceManifest.dsh.integrity,
);
expectValue('pnpm version', manifest.pnpm.version, sourceManifest.pnpm.version);
expectValue('desktop frame prototype version', desktopFrameManifest.version, '0.0.1');
expectValue('desktop market version', desktopMarketManifest.version, '0.1.0');
if (!desktopMarketCache.includes('createCatalogSnapshotStore')) {
  throw new Error('Desktop market persistent cache adapter is missing');
}
if (!desktopMarketSources.includes('createSourceRegistry')) {
  throw new Error('Desktop market source registry is missing');
}
if (!desktopMarketMedia.includes('createMediaProxy')) {
  throw new Error('Desktop market media proxy is missing');
}
if (!desktopMarketInspector.includes('createInstallInspector')) {
  throw new Error('Desktop market install inspector is missing');
}
if (!desktopMarketDependencyGraph.includes('createDependencyGraphResolver')) {
  throw new Error('Desktop market dependency graph resolver is missing');
}
if (!desktopMarketRuntimeSnapshot.includes('createRuntimeSnapshot')) {
  throw new Error('Desktop market Runtime compatibility snapshot is missing');
}
if (!desktopMarketArtifactVerifier.includes('createArtifactVerifier')) {
  throw new Error('Desktop market artifact verifier is missing');
}
if (!desktopMarketArtifactCache.includes('createArtifactCache') ||
  !desktopMarketArtifactCache.includes('quota-exhausted') ||
  !desktopMarketArtifactCache.includes('cacheDigests')) {
  throw new Error('Desktop market bounded artifact cache is missing');
}
if (!desktopMarketManagedInstaller.includes('createManagedPluginInstaller')) {
  throw new Error('Desktop market managed installer is missing');
}
if (!desktopMarketManagedPreviewVault.includes('createManagedPreviewVault')) {
  throw new Error('Desktop market managed preview vault is missing');
}
if (!desktopMarketDevelopmentFixture.includes('createDevelopmentFixture') ||
  !desktopMarketDevelopmentFixture.includes("if (options.enabled !== true) return undefined")) {
  throw new Error('Desktop market development fixture isolation is missing');
}
if (!loaderImplementation.includes('Promise.allSettled(config.map')) {
  throw new Error(
    'Harness loader activation contract changed; re-audit managed plugin launch ordering',
  );
}
const prepareIndex = appBootImplementation.indexOf('await prepare?.(ctx)');
const mountIndex = appBootImplementation.indexOf('await mountRootInclude(');
if (prepareIndex < 0 || mountIndex < 0 || prepareIndex >= mountIndex) {
  throw new Error(
    'Harness host preparation no longer precedes config-tree mounting',
  );
}
if (
  !profileBootImplementation.includes('function allPatches(composed)') ||
  !profileBootImplementation.includes('...composed.overlays') ||
  !profileBootImplementation.includes('structuredClone(allPatches(composed))')
) {
  throw new Error(
    'Harness profile overlay composition changed; re-audit managed patch precedence',
  );
}
if (!legacyDesktopPatch.includes('@dsh-desktop/market')) {
  throw new Error('Legacy Runtime patch must load the desktop market');
}
if (!integratedDesktopPatch.includes('@dsh-desktop/market')) {
  throw new Error('Integrated Runtime patch must load the desktop market');
}
if (legacyDesktopPatch.includes('@dsh-desktop/frame-prototype')) {
  throw new Error('Legacy Runtime patch must not load the Integrated desktop frame');
}
if (!integratedDesktopPatch.includes('@dsh-desktop/frame-prototype')) {
  throw new Error('Integrated Runtime patch must load the desktop frame prototype');
}
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
await expectNativeArchitecture(nodeExecutable, layout.platform, layout.architecture);
for (const nativeFile of ptyNativeFiles) {
  await expectNativeArchitecture(nativeFile, layout.platform, layout.architecture);
}
if (layout.platform === 'darwin') {
  const ptySpawnHelper = join(nodePtyPrebuild, 'spawn-helper');
  if (((await stat(ptySpawnHelper)).mode & 0o111) === 0) {
    throw new Error(`node-pty spawn-helper is not executable: ${ptySpawnHelper}`);
  }
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
  ['-e', nodePtySmokeScript(layout.ptyShell), nodePtyDirectory],
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
  `Verified Node ${manifest.node.version} + dsh ${manifest.dsh.version} + pnpm ${manifest.pnpm.version} + node-pty ${nodePtyManifest.version} + sharp + koffi (${layout.target})\n`,
);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function verifyBundledExtension(
  targetName: string,
  sourceName: string,
  files: readonly string[],
): Promise<void> {
  for (const file of files) {
    const source = await readFile(join(projectRoot, 'runtime', sourceName, file));
    const bundled = await readFile(
      join(runtimeNodeModules, '@dsh-desktop', targetName, file),
    );
    if (!source.equals(bundled)) {
      throw new Error(
        `Bundled desktop extension is stale: @dsh-desktop/${targetName}/${file}; run npm run runtime:vendor`,
      );
    }
  }
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

async function expectNativeArchitecture(
  path: string,
  platform: BundledRuntimePlatform,
  expected: BundledRuntimeArchitecture,
): Promise<void> {
  if (platform === 'darwin') {
    const actual = output('lipo', ['-archs', path]);
    const expectedMachArchitecture = expected === 'x64' ? 'x86_64' : expected;
    if (actual !== expectedMachArchitecture) {
      throw new Error(
        `${path} architecture ${actual} does not match ${expected}`,
      );
    }
    return;
  }
  if (expected !== 'x64') {
    throw new Error(`Unsupported Windows native architecture: ${expected}`);
  }
  const contents = await readFile(path);
  const peOffset = contents.readUInt32LE(0x3c);
  if (
    contents.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0' ||
    contents.readUInt16LE(peOffset + 4) !== 0x8664
  ) {
    throw new Error(`${path} is not a Windows x64 PE image`);
  }
}

function nodePtySmokeScript(shell: {
  readonly command: string;
  readonly args: readonly string[];
  readonly input: string;
}): string {
  return String.raw`
const nodePty = require(process.argv[1]);
const marker = 'DSH_PTY_OK';
const child = nodePty.spawn(${JSON.stringify(shell.command)}, ${JSON.stringify(shell.args)}, {
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
child.write(${JSON.stringify(shell.input)});
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
