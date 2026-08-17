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

type RuntimeArchitecture = 'arm64' | 'x64';

interface RuntimeManifest {
  readonly schemaVersion: number;
  readonly node: {
    readonly version: string;
    readonly archives: Record<
      RuntimeArchitecture,
      { readonly file: string; readonly sha256: string }
    >;
  };
  readonly dsh: { readonly version: string; readonly integrity: string };
  readonly pnpm: { readonly version: string; readonly integrity: string };
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const architecture = parseArchitecture(process.argv.slice(2));
const sourceManifestPath = join(projectRoot, 'runtime', 'manifest.json');
const manifest = JSON.parse(
  await readFile(sourceManifestPath, 'utf8'),
) as RuntimeManifest;
const archive = manifest.node.archives[architecture];
const cacheDirectory = join(projectRoot, '.cache', 'runtime');
const archivePath = join(cacheDirectory, archive.file);
const resourcesDirectory = join(projectRoot, 'resources');
const targetDirectory = join(resourcesDirectory, 'runtime');
const stagingDirectory = join(
  resourcesDirectory,
  `.runtime-staging-${architecture}`,
);

await mkdir(cacheDirectory, { recursive: true });
await ensureArchive(
  `https://nodejs.org/download/release/v${manifest.node.version}/${archive.file}`,
  archivePath,
  archive.sha256,
);

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(join(stagingDirectory, 'node'), { recursive: true });
run('tar', [
  '-xJf',
  archivePath,
  '-C',
  join(stagingDirectory, 'node'),
  '--strip-components=1',
]);

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

const nodeExecutable = join(stagingDirectory, 'node', 'bin', 'node');
const npmCli = join(
  stagingDirectory,
  'node',
  'lib',
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);
run(nodeExecutable, [
  npmCli,
  'ci',
  '--omit=dev',
  '--strict-allow-scripts',
  '--prefix',
  dshDirectory,
], undefined, {
  npm_config_cpu: architecture,
  npm_config_os: 'darwin',
  PATH: [join(stagingDirectory, 'node', 'bin'), process.env.PATH]
    .filter((entry): entry is string => entry !== undefined)
    .join(delimiter),
});

await cp(
  join(projectRoot, 'runtime', 'desktop-settings-plugin'),
  join(dshDirectory, 'node_modules', '@dsh-desktop', 'settings'),
  { recursive: true },
);
await copyFile(
  join(projectRoot, 'runtime', 'desktop-settings.patch.yml'),
  join(stagingDirectory, 'desktop-settings.patch.yml'),
);

const installedManifest = {
  ...manifest,
  architecture,
  assembledAt: new Date().toISOString(),
  nodeExecutable: 'node/bin/node',
  dshEntrypoint: 'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
  pnpmEntrypoint: 'dsh/node_modules/pnpm/bin/pnpm.cjs',
};
await writeFile(
  join(stagingDirectory, 'runtime-manifest.json'),
  `${JSON.stringify(installedManifest, null, 2)}\n`,
  { mode: 0o600 },
);

run(nodeExecutable, ['--version'], `v${manifest.node.version}`);
run(nodeExecutable, [
  join(
    dshDirectory,
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  ),
  '--version',
]);
run(
  nodeExecutable,
  [join(dshDirectory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), '--version'],
  manifest.pnpm.version,
);
await pruneRuntime(stagingDirectory, architecture);

await rm(targetDirectory, { recursive: true, force: true });
await rename(stagingDirectory, targetDirectory);
process.stdout.write(
  `Assembled Node ${manifest.node.version} + dsh ${manifest.dsh.version} for ${architecture}\n`,
);

function parseArchitecture(arguments_: readonly string[]): RuntimeArchitecture {
  const requested = arguments_.find((argument) => argument.startsWith('--arch='));
  const value = requested?.slice('--arch='.length) ?? process.arch;
  if (value !== 'arm64' && value !== 'x64') {
    throw new Error(`Unsupported runtime architecture: ${value}`);
  }
  return value;
}

async function pruneRuntime(
  runtimeDirectory: string,
  runtimeArchitecture: RuntimeArchitecture,
): Promise<void> {
  const nodeDirectory = join(runtimeDirectory, 'node');
  await Promise.all(
    ['include', 'lib', 'share', 'CHANGELOG.md', 'README.md'].map((entry) =>
      rm(join(nodeDirectory, entry), { recursive: true, force: true }),
    ),
  );
  await Promise.all(
    ['corepack', 'npm', 'npx'].map((entry) =>
      rm(join(nodeDirectory, 'bin', entry), { force: true }),
    ),
  );

  const prebuildDirectory = join(
    runtimeDirectory,
    'dsh',
    'node_modules',
    'node-pty',
    'prebuilds',
  );
  const retained = `darwin-${runtimeArchitecture}`;
  for (const entry of await readdir(prebuildDirectory)) {
    if (entry !== retained) {
      await rm(join(prebuildDirectory, entry), { recursive: true, force: true });
    }
  }
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
): void {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    stdio: expected === undefined ? 'inherit' : 'pipe',
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
