import { createHash } from 'node:crypto';
import {
  cp,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  MODEL_CAPABILITIES_PATCH_DSH_VERSION,
  patchModelCapabilitiesEditor,
} from '../src/main/runtime/vendor-model-capabilities-patch.ts';
import {
  type BundledRuntimeTarget,
  resolveBundledRuntimePlatform,
  type BundledRuntimePlatformLayout,
} from '../src/main/runtime/runtime-platform.ts';

interface RuntimeManifest {
  readonly schemaVersion: number;
  readonly node: {
    readonly version: string;
    readonly archives: Partial<Record<
      BundledRuntimeTarget,
      { readonly file: string; readonly sha256: string }
    >>;
  };
  readonly dsh: { readonly version: string; readonly integrity: string };
  readonly pnpm: { readonly version: string; readonly integrity: string };
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const layout = parseRuntimeTarget(process.argv.slice(2));
const architecture = layout.architecture;
if (layout.platform !== process.platform) {
  throw new Error(
    `Bundled Runtime ${layout.target} must be assembled on ${layout.platform}, not ${process.platform}`,
  );
}
const sourceManifestPath = join(projectRoot, 'runtime', 'manifest.json');
const manifest = JSON.parse(
  await readFile(sourceManifestPath, 'utf8'),
) as RuntimeManifest;
if (manifest.schemaVersion !== 2) {
  throw new Error(`Unsupported Runtime source manifest schema: ${String(manifest.schemaVersion)}`);
}
const archive = manifest.node.archives[layout.target];
if (archive === undefined) {
  throw new Error(`Runtime source manifest does not define ${layout.target}`);
}
const cacheDirectory = join(projectRoot, '.cache', 'runtime');
const archivePath = join(cacheDirectory, archive.file);
const resourcesDirectory = join(projectRoot, 'resources');
const targetDirectory = join(resourcesDirectory, 'runtime');
const stagingDirectory = join(
  resourcesDirectory,
  `.runtime-staging-${layout.target}`,
);

await mkdir(cacheDirectory, { recursive: true });
await ensureArchive(
  `https://nodejs.org/download/release/v${manifest.node.version}/${archive.file}`,
  archivePath,
  archive.sha256,
);

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(join(stagingDirectory, 'node'), { recursive: true });
extractNodeArchive(archivePath, join(stagingDirectory, 'node'));

const dshDirectory = join(stagingDirectory, 'dsh');
await mkdir(dshDirectory, { recursive: true });
await copyFile(
  join(projectRoot, 'runtime', 'package.json'),
  join(dshDirectory, 'package.json'),
);
await copyFile(
  join(projectRoot, 'runtime', 'package-lock.json'),
  join(dshDirectory, 'package-lock.json'),
);

const nodeExecutable = join(stagingDirectory, layout.nodeExecutable);
const npmCli = join(stagingDirectory, layout.npmCli);
run(nodeExecutable, [
  npmCli,
  'ci',
  '--omit=dev',
  // rc.8 publishes composition services as peers. runtime/package.json pins
  // that complete composition explicitly, avoiding npm's conflicting UI-peer
  // backtracking while still making every runtime peer a locked dependency.
  '--legacy-peer-deps',
  '--strict-allow-scripts',
  '--prefix',
  dshDirectory,
], undefined, {
  npm_config_cpu: architecture,
  npm_config_os: layout.platform,
  PATH: [join(stagingDirectory, layout.nodeBinDirectory), process.env.PATH]
    .filter((entry): entry is string => entry !== undefined)
    .join(delimiter),
}, 600_000);

if (manifest.dsh.version !== MODEL_CAPABILITIES_PATCH_DSH_VERSION) {
  throw new Error(
    `Temporary model-capabilities patch targets dsh ${MODEL_CAPABILITIES_PATCH_DSH_VERSION}; review it before vendoring ${manifest.dsh.version}`,
  );
}
const modelsSettingsClient = join(
  dshDirectory,
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-settings-models',
  'lib',
  'client.js',
);
await writeFile(
  modelsSettingsClient,
  patchModelCapabilitiesEditor(await readFile(modelsSettingsClient, 'utf8')),
);

await cp(
  join(projectRoot, 'runtime', 'desktop-settings-plugin'),
  join(dshDirectory, 'node_modules', '@dsh-desktop', 'settings'),
  { recursive: true },
);
await cp(
  join(projectRoot, 'runtime', 'desktop-companion-plugin'),
  join(dshDirectory, 'node_modules', '@dsh-desktop', 'companion'),
  { recursive: true },
);
await cp(
  join(projectRoot, 'runtime', 'desktop-frame-plugin'),
  join(dshDirectory, 'node_modules', '@dsh-desktop', 'frame-prototype'),
  { recursive: true },
);
const desktopMarketSource = join(projectRoot, 'runtime', 'desktop-market-plugin');
const desktopMarketTarget = join(dshDirectory, 'node_modules', '@dsh-desktop', 'market');
await mkdir(desktopMarketTarget, { recursive: true });
for (const file of [
  'artifact-cache.js',
  'artifact-verifier.js',
  'catalog-cache.js',
  'catalog-network.js',
  'catalog.js',
  'client.js',
  'dependency-graph.js',
  'development-fixture.js',
  'index.js',
  'install-inspector.js',
  'media.js',
  'managed-installer.js',
  'managed-preview-vault.js',
  'package.json',
  'runtime-snapshot.js',
  'source-registry.js',
]) await copyFile(join(desktopMarketSource, file), join(desktopMarketTarget, file));
await copyFile(
  join(projectRoot, 'runtime', 'desktop-extensions.patch.yml'),
  join(stagingDirectory, 'desktop-extensions.patch.yml'),
);
await copyFile(
  join(projectRoot, 'runtime', 'desktop-integrated.patch.yml'),
  join(stagingDirectory, 'desktop-integrated.patch.yml'),
);

const installedManifest = {
  ...manifest,
  target: layout.target,
  platform: layout.platform,
  architecture,
  assembledAt: new Date().toISOString(),
  nodeExecutable: layout.nodeExecutable,
  dshEntrypoint: 'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
  pnpmEntrypoint: 'dsh/node_modules/pnpm/bin/pnpm.cjs',
};
await writeFile(
  join(stagingDirectory, 'runtime-manifest.json'),
  `${JSON.stringify(installedManifest, null, 2)}\n`,
  { mode: 0o600 },
);

run(
  nodeExecutable,
  ['--version'],
  `v${manifest.node.version}`,
  undefined,
  15_000,
);
run(
  nodeExecutable,
  [
    join(
      dshDirectory,
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js',
    ),
    '--version',
  ],
  manifest.dsh.version,
  undefined,
  15_000,
);
run(
  nodeExecutable,
  [join(dshDirectory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), '--version'],
  manifest.pnpm.version,
  undefined,
  15_000,
);
await pruneRuntime(stagingDirectory, layout);

await rm(targetDirectory, { recursive: true, force: true });
await rename(stagingDirectory, targetDirectory);
process.stdout.write(
  `Assembled Node ${manifest.node.version} + dsh ${manifest.dsh.version} for ${layout.target}\n`,
);

function parseRuntimeTarget(
  arguments_: readonly string[],
): BundledRuntimePlatformLayout {
  const requestedPlatform = arguments_.find((argument) =>
    argument.startsWith('--platform='),
  );
  const requested = arguments_.find((argument) => argument.startsWith('--arch='));
  return resolveBundledRuntimePlatform(
    (requestedPlatform?.slice('--platform='.length) ?? process.platform) as NodeJS.Platform,
    requested?.slice('--arch='.length) ?? process.arch,
  );
}

async function pruneRuntime(
  runtimeDirectory: string,
  runtimeLayout: BundledRuntimePlatformLayout,
): Promise<void> {
  const nodeDirectory = join(runtimeDirectory, 'node');
  const nodeEntries = runtimeLayout.platform === 'darwin'
    ? ['include', 'lib', 'share', 'CHANGELOG.md', 'README.md']
    : ['node_modules', 'CHANGELOG.md', 'README.md', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'corepack', 'corepack.cmd', 'install_tools.bat'];
  await Promise.all(nodeEntries.map((entry) =>
    rm(join(nodeDirectory, entry), { recursive: true, force: true })));
  if (runtimeLayout.platform === 'darwin') {
    await Promise.all(
      ['corepack', 'npm', 'npx'].map((entry) =>
        rm(join(nodeDirectory, 'bin', entry), { force: true }),
      ),
    );
  }

  const prebuildDirectory = join(
    runtimeDirectory,
    'dsh',
    'node_modules',
    'node-pty',
    'prebuilds',
  );
  const retained = runtimeLayout.nodePtyPrebuild;
  for (const entry of await readdir(prebuildDirectory)) {
    if (entry !== retained) {
      await rm(join(prebuildDirectory, entry), { recursive: true, force: true });
    }
  }
  if (runtimeLayout.platform === 'win32') {
    await Promise.all(
      ['conpty.pdb', 'conpty_console_list.pdb'].map((entry) =>
        rm(join(prebuildDirectory, retained, entry), { force: true }),
      ),
    );
  }
}

function extractNodeArchive(archivePath: string, destination: string): void {
  run('tar', [
    '-xf',
    archivePath,
    '-C',
    destination,
    '--strip-components=1',
  ]);
}

async function ensureArchive(
  url: string,
  destination: string,
  expectedSha256: string,
): Promise<void> {
  try {
    if ((await sha256(destination)) === expectedSha256) {
      return;
    }
  } catch {
    // Cache miss; download below.
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Node download failed: HTTP ${String(response.status)}`);
  }
  const temporary = `${destination}.download`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
  const actualSha256 = await sha256(temporary);
  if (actualSha256 !== expectedSha256) {
    await rm(temporary, { force: true });
    throw new Error(
      `Node archive checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  await rename(temporary, destination);
}

async function sha256(path: string): Promise<string> {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest('hex');
}

function run(
  command: string,
  args: readonly string[],
  expected?: string,
  environment?: NodeJS.ProcessEnv,
  timeout?: number,
): void {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    stdio: expected === undefined ? 'inherit' : 'pipe',
    timeout,
    env:
      environment === undefined
        ? undefined
        : { ...withoutNpmConfiguration(process.env), ...environment },
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
  if (expected !== undefined && result.stdout.trim() !== expected) {
    throw new Error(
      `${command} returned ${result.stdout.trim()}, expected ${expected}`,
    );
  }
}

function withoutNpmConfiguration(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !name.toLowerCase().startsWith('npm_'),
    ),
  );
}
