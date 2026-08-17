import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageManifest {
  readonly version: string;
}

interface NotaryResult {
  readonly id?: string;
  readonly status?: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const productName = 'DeepSeek YukiRyou';
const architecture = 'arm64';
const version = packageManifest.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json contains an invalid release version: ${version}`);
}
const identity = requiredEnvironment('MACOS_SIGN_IDENTITY');
const notaryCredentials = notaryCredentialArguments();
await validateNotaryCredentials(notaryCredentials);
const gitCommit = runCapture('git', ['rev-parse', 'HEAD'], projectRoot).trim();
const gitStatus = runCapture('git', ['status', '--porcelain'], projectRoot).trim();
if (gitStatus !== '' && process.env.MACOS_RELEASE_ALLOW_DIRTY !== 'true') {
  throw new Error(
    'Release builds require a clean Git worktree. Commit the changes or set MACOS_RELEASE_ALLOW_DIRTY=true for a non-publishable rehearsal.',
  );
}
const outputDirectory = resolve(
  process.env.MACOS_RELEASE_OUTPUT ?? join(projectRoot, 'out', 'release'),
);
const appSource = resolve(
  process.env.MACOS_RELEASE_APP ??
    join(
      projectRoot,
      'out',
      `${productName}-darwin-${architecture}`,
      `${productName}.app`,
    ),
);
const temporaryRoot = await mkdtemp(
  join(tmpdir(), 'deepseek-yukiryou-release-'),
);
const signedApp = join(temporaryRoot, `${productName}.app`);
const diskImageRoot = join(temporaryRoot, 'dmg-root');
const temporaryDmg = join(temporaryRoot, `${productName}.dmg`);
const finalDmg = join(
  outputDirectory,
  `${productName}-${version}-${architecture}.dmg`,
);
const finalZip = join(
  outputDirectory,
  `${productName}-darwin-${architecture}-${version}.zip`,
);
const checksumPath = join(outputDirectory, 'SHA256SUMS.txt');
const manifestPath = join(outputDirectory, 'release-manifest.json');
let releaseCompleted = false;

try {
  if (process.env.MACOS_RELEASE_SKIP_PACKAGE !== 'true') {
    run('pnpm', ['package:mac', '--', '--arch=arm64'], projectRoot);
  }

  await mkdir(outputDirectory, { recursive: true });
  run('ditto', [appSource, signedApp]);
  run('xattr', ['-cr', signedApp]);
  run(process.execPath, [
    join(projectRoot, 'scripts', 'sign-macos-app.ts'),
    `--app=${signedApp}`,
    `--identity=${identity}`,
    `--entitlements=${join(projectRoot, 'resources', 'entitlements.mac.plist')}`,
  ]);

  await mkdir(diskImageRoot, { recursive: true });
  run('ditto', [signedApp, join(diskImageRoot, `${productName}.app`)]);
  await symlink('/Applications', join(diskImageRoot, 'Applications'));
  run('hdiutil', [
    'create',
    '-volname',
    productName,
    '-srcfolder',
    diskImageRoot,
    '-ov',
    '-format',
    'UDZO',
    temporaryDmg,
  ]);
  run('codesign', [
    '--force',
    '--timestamp',
    '--sign',
    identity,
    temporaryDmg,
  ]);
  run('hdiutil', ['verify', temporaryDmg]);

  const notaryResult = await submitForNotarization(
    temporaryDmg,
    notaryCredentials,
  );
  if (notaryResult.status !== 'Accepted') {
    throw new Error(
      `Apple notarization returned ${notaryResult.status ?? 'an unknown status'}`,
    );
  }

  run('xcrun', ['stapler', 'staple', signedApp]);
  run('xcrun', ['stapler', 'staple', temporaryDmg]);
  verifyApplication(signedApp);
  verifyDiskImage(temporaryDmg);

  run('ditto', ['-c', '-k', '--keepParent', signedApp, finalZip]);
  await copyFile(temporaryDmg, finalDmg);
  const checksums = [
    [basename(finalDmg), await sha256(finalDmg)],
    [basename(finalZip), await sha256(finalZip)],
  ] as const;
  await writeFile(
    checksumPath,
    `${checksums.map(([file, digest]) => `${digest}  ${file}`).join('\n')}\n`,
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version,
        architecture,
        gitCommit,
        dirtyWorktree: gitStatus !== '',
        notarizationSubmissionId: notaryResult.id,
        artifacts: checksums.map(([file, sha256Digest]) => ({
          file,
          sha256: sha256Digest,
        })),
      },
      null,
      2,
    )}\n`,
  );
  releaseCompleted = true;
  process.stdout.write(`Release artifacts ready in ${outputDirectory}\n`);
} finally {
  if (releaseCompleted) {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    process.stderr.write(
      `Release failed; intermediate files were preserved at ${temporaryRoot}\n`,
    );
  }
}

async function submitForNotarization(
  path: string,
  credentialArguments: readonly string[],
): Promise<NotaryResult> {
  const output = await runStreaming('xcrun', [
    'notarytool',
    'submit',
    path,
    ...credentialArguments,
    '--wait',
    '--output-format',
    'json',
  ]);
  return JSON.parse(output) as NotaryResult;
}

function notaryCredentialArguments(): string[] {
  const profile = process.env.APPLE_NOTARY_KEYCHAIN_PROFILE;
  if (profile !== undefined && profile.trim() !== '') {
    return ['--keychain-profile', profile];
  }
  return [
    '--key',
    requiredEnvironment('APPLE_API_KEY'),
    '--key-id',
    requiredEnvironment('APPLE_API_KEY_ID'),
    '--issuer',
    requiredEnvironment('APPLE_API_ISSUER'),
  ];
}

async function validateNotaryCredentials(
  credentialArguments: readonly string[],
): Promise<void> {
  const keyIndex = credentialArguments.indexOf('--key');
  if (keyIndex !== -1) {
    const keyPath = credentialArguments[keyIndex + 1];
    if (keyPath === undefined) throw new Error('Missing Apple API key path');
    await access(keyPath);
  }
}

function verifyApplication(path: string): void {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', path]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', path]);
  run('xcrun', ['stapler', 'validate', path]);
}

function verifyDiskImage(path: string): void {
  run('codesign', ['--verify', '--verbose=2', path]);
  run('hdiutil', ['verify', path]);
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

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function run(command: string, arguments_: readonly string[], cwd?: string): void {
  const result = spawnSync(command, arguments_, {
    cwd,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
}

function runCapture(
  command: string,
  arguments_: readonly string[],
  cwd?: string,
): string {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}`);
  }
  return result.stdout;
}

async function runStreaming(
  command: string,
  arguments_: readonly string[],
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(
        new Error(`${command} failed with status ${String(code)}: ${stderr}`),
      );
    });
  });
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest('hex');
}
