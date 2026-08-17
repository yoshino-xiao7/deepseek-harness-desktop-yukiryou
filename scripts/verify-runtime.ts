import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface InstalledRuntimeManifest {
  readonly architecture: 'arm64' | 'x64';
  readonly node: { readonly version: string };
  readonly dsh: { readonly version: string };
  readonly pnpm: { readonly version: string };
  readonly nodeExecutable: string;
  readonly dshEntrypoint: string;
  readonly pnpmEntrypoint: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeDirectory = join(projectRoot, 'resources', 'runtime');
const manifest = JSON.parse(
  await readFile(join(runtimeDirectory, 'runtime-manifest.json'), 'utf8'),
) as InstalledRuntimeManifest;
const nodeExecutable = join(runtimeDirectory, manifest.nodeExecutable);
const dshEntrypoint = join(runtimeDirectory, manifest.dshEntrypoint);
const pnpmEntrypoint = join(runtimeDirectory, manifest.pnpmEntrypoint);

expectOutput(nodeExecutable, ['--version'], `v${manifest.node.version}`);
expectOutput(nodeExecutable, ['--print', 'process.arch'], manifest.architecture);
const dshVersion = output(nodeExecutable, [dshEntrypoint, '--version']);
if (!dshVersion.includes(manifest.dsh.version)) {
  throw new Error(
    `dsh version mismatch: expected ${manifest.dsh.version}, got ${dshVersion}`,
  );
}
expectOutput(nodeExecutable, [pnpmEntrypoint, '--version'], manifest.pnpm.version);
process.stdout.write(
  `Verified Node ${manifest.node.version} + dsh ${manifest.dsh.version} + pnpm ${manifest.pnpm.version} (${manifest.architecture})\n`,
);

function expectOutput(command: string, args: readonly string[], expected: string): void {
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
