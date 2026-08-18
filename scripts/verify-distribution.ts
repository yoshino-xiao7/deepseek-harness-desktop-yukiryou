import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  distributionVerificationPolicy,
  type ArchiveKind,
  type DistributionVerificationPolicy,
} from './distribution-verification-policy.js';

interface CandidateManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly architecture: 'arm64';
  readonly gitCommit: string;
  readonly archive: { readonly sha256: string };
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productName = 'DeepSeek YukiRyou';
const options = new Map(
  process.argv
    .slice(2)
    .filter((value) => value.startsWith('--') && value.includes('='))
    .map((value) => {
      const separator = value.indexOf('=');
      return [value.slice(2, separator), value.slice(separator + 1)];
    }),
);
const archivePath = resolve(requiredOption('archive'));
const kind = requiredOption('kind') as ArchiveKind;
const installApp = requiredOption('install-app');
const requireNotarized = options.get('require-notarized') === 'true';
const verificationPolicy = distributionVerificationPolicy(
  kind,
  requireNotarized,
);
const simulateDownload = options.get('simulate-download') === 'true';
const receiptPath = options.get('receipt');
const manifestPath = options.get('candidate-manifest');
const expectedVersion = options.get('expect-version');

if (kind !== 'zip' && kind !== 'dmg') {
  throw new Error('--kind must be zip or dmg');
}
if (!isAbsolute(installApp) || !installApp.endsWith('.app')) {
  throw new Error('--install-app must be an absolute .app path');
}
if (await pathExists(installApp)) {
  throw new Error(`Refusing to overwrite existing application: ${installApp}`);
}

if (simulateDownload) {
  run('xattr', [
    '-w',
    'com.apple.quarantine',
    `0081;${Math.floor(Date.now() / 1000).toString(16)};GitHub Actions;`,
    archivePath,
  ]);
}

if (verificationPolicy.requireArchiveTicket) {
  verifyDiskImageArchive(archivePath);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'deepseek-distribution-'));
const sourceRoot = join(temporaryRoot, 'source');
let mounted = false;
try {
  await mkdir(sourceRoot);
  if (kind === 'zip') {
    run('ditto', ['-x', '-k', archivePath, sourceRoot]);
  } else {
    run('hdiutil', [
      'attach',
      archivePath,
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      sourceRoot,
    ]);
    mounted = true;
  }

  const sourceApp = join(sourceRoot, `${productName}.app`);
  await access(sourceApp);
  await mkdir(dirname(installApp), { recursive: true });
  run('ditto', [sourceApp, installApp]);
  verifyInstalledApplication(installApp, verificationPolicy);
  smokeTest(installApp, expectedVersion);

  if (receiptPath !== undefined) {
    if (manifestPath === undefined) {
      throw new Error('--candidate-manifest is required with --receipt');
    }
    const manifest = JSON.parse(
      await readFile(resolve(manifestPath), 'utf8'),
    ) as CandidateManifest;
    const digest = await sha256(archivePath);
    if (
      manifest.schemaVersion !== 1 ||
      manifest.architecture !== 'arm64' ||
      manifest.archive.sha256 !== digest
    ) {
      throw new Error('Candidate manifest does not match the verified archive');
    }
    await writeFile(
      resolve(receiptPath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          verifiedArchiveSha256: digest,
          version: manifest.version,
          architecture: manifest.architecture,
          gitCommit: manifest.gitCommit,
          installedPath: installApp,
          smokeTest: 'passed',
          verifiedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }
  process.stdout.write(`Distribution verification passed: ${archivePath}\n`);
} finally {
  if (mounted) {
    run('hdiutil', ['detach', sourceRoot]);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

function verifyInstalledApplication(
  path: string,
  policy: DistributionVerificationPolicy,
): void {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', path]);
  const details = capture('codesign', ['-dv', '--verbose=4', path]);
  if (
    !details.includes('Authority=Developer ID Application:') ||
    !details.includes('TeamIdentifier=7G6J4S76PN')
  ) {
    throw new Error('Installed app does not have the expected Developer ID chain');
  }
  run(process.execPath, [
    join(projectRoot, 'scripts', 'verify-release.ts'),
    `--app=${path}`,
    '--expect-arch=arm64',
    '--require-signed=true',
    '--require-notarized=false',
  ]);
  if (policy.requireInstalledAppGatekeeper) {
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', path]);
  }
  if (policy.requireInstalledAppTicket) {
    run('xcrun', ['stapler', 'validate', path]);
  }
}

function verifyDiskImageArchive(path: string): void {
  run('codesign', ['--verify', '--verbose=2', path]);
  run('spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=4',
    path,
  ]);
  run('xcrun', ['stapler', 'validate', path]);
}

function smokeTest(
  applicationPath: string,
  expectedApplicationVersion: string | undefined,
): void {
  const executable = join(
    applicationPath,
    'Contents',
    'MacOS',
    productName,
  );
  const result = spawnSync(executable, ['--release-smoke-test'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    shell: false,
    timeout: 30_000,
  });
  if (result.error !== undefined) throw result.error;
  const marker = 'DEEPSEEK_YUKIRYOU_RELEASE_SMOKE_OK';
  const markerIndex = result.stdout.indexOf(marker);
  if (result.status !== 0 || markerIndex === -1) {
    throw new Error(
      `Packaged app smoke test failed: status=${String(result.status)} stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }
  const payloadText = result.stdout
    .slice(markerIndex + marker.length)
    .split('\n', 1)[0]
    ?.trim();
  const payload = JSON.parse(payloadText ?? '') as {
    readonly version?: string;
    readonly architecture?: string;
    readonly packaged?: boolean;
  };
  if (
    payload.architecture !== 'arm64' ||
    payload.packaged !== true ||
    (expectedApplicationVersion !== undefined &&
      payload.version !== expectedApplicationVersion)
  ) {
    throw new Error(
      `Packaged app smoke metadata does not match the release: ${JSON.stringify(payload)}`,
    );
  }
}

function requiredOption(name: string): string {
  const value = options.get(name);
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required option: --${name}=...`);
  }
  return value;
}

function run(command: string, arguments_: readonly string[]): void {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
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
    encoding: 'utf8',
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
  return `${result.stdout}${result.stderr}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
