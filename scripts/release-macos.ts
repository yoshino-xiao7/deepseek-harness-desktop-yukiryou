import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageManifest {
  readonly version: string;
}

interface NotaryResult {
  readonly id?: string;
  readonly status?: string;
}

interface NotaryLog {
  readonly issues?: ReadonlyArray<{ readonly severity?: string }> | null;
}

interface NotarizationState {
  readonly schemaVersion: 1;
  readonly submissionId: string;
  readonly status: 'In Progress';
  readonly productVersion: string;
  readonly architecture: 'arm64';
  readonly gitCommit: string;
  readonly dirtyWorktree: boolean;
  readonly temporaryRoot: string;
  readonly signedApp: string;
  readonly diskImage: string;
  readonly submittedAt: string;
}

interface PortableVerificationReceipt {
  readonly schemaVersion: 1;
  readonly verifiedArchiveSha256: string;
  readonly version: string;
  readonly architecture: 'arm64';
  readonly gitCommit: string;
  readonly smokeTest: 'passed';
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productName = 'DeepSeek YukiRyou';
const architecture = 'arm64' as const;
const outputDirectory = resolve(
  process.env.MACOS_RELEASE_OUTPUT ?? join(projectRoot, 'out', 'release'),
);
const statePath = join(outputDirectory, 'notarization-state.json');
const releaseWorkRoot = resolve(
  process.env.MACOS_RELEASE_WORK_ROOT ??
    join(
      homedir(),
      'Library',
      'Application Support',
      productName,
      'Release Work',
    ),
);
const notaryCredentials = notaryCredentialArguments();
await validateNotaryCredentials(notaryCredentials);

if (process.argv.includes('--finish')) {
  await finishRelease();
} else {
  await submitRelease();
}

async function submitRelease(): Promise<void> {
  if (await pathExists(statePath)) {
    throw new Error(
      `An existing notarization is recorded at ${statePath}. Run pnpm release:mac:finish instead of submitting again.`,
    );
  }

  const packageManifest = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  ) as PackageManifest;
  const version = packageManifest.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json contains an invalid release version: ${version}`);
  }

  const identity = requiredEnvironment('MACOS_SIGN_IDENTITY');
  const gitCommit = runCapture('git', ['rev-parse', 'HEAD'], projectRoot).trim();
  const gitStatus = runCapture('git', ['status', '--porcelain'], projectRoot).trim();
  if (gitStatus !== '' && process.env.MACOS_RELEASE_ALLOW_DIRTY !== 'true') {
    throw new Error(
      'Release builds require a clean Git worktree. Commit the changes or set MACOS_RELEASE_ALLOW_DIRTY=true for a non-publishable rehearsal.',
    );
  }
  if (process.env.MACOS_RELEASE_SKIP_PACKAGE !== 'true') {
    throw new Error(
      'Direct packaging and notarization is disabled. Build a candidate, verify it on a fresh runner, then submit that exact candidate with MACOS_RELEASE_SKIP_PACKAGE=true.',
    );
  }

  const candidateArchive = resolve(
    requiredEnvironment('MACOS_RELEASE_CANDIDATE'),
  );
  const receipt = await readPortableReceipt(
    resolve(requiredEnvironment('MACOS_RELEASE_PORTABLE_RECEIPT')),
  );
  if (
    receipt.verifiedArchiveSha256 !== (await sha256(candidateArchive)) ||
    receipt.version !== version ||
    receipt.architecture !== architecture ||
    receipt.gitCommit !== gitCommit ||
    receipt.smokeTest !== 'passed'
  ) {
    throw new Error(
      'Portable verification receipt does not match this candidate, version, architecture, and Git commit.',
    );
  }

  const appSource = resolve(
    process.env.MACOS_RELEASE_APP ??
      join(
        projectRoot,
        'out',
        `${productName}-darwin-${architecture}`,
        `${productName}.app`,
      ),
  );
  await mkdir(releaseWorkRoot, { recursive: true, mode: 0o700 });
  const temporaryRoot = await mkdtemp(join(releaseWorkRoot, 'release-'));
  const signedApp = join(temporaryRoot, `${productName}.app`);
  const diskImageRoot = join(temporaryRoot, 'dmg-root');
  const diskImage = join(temporaryRoot, `${productName}.dmg`);
  let submissionRecorded = false;

  try {
    await mkdir(outputDirectory, { recursive: true });
    run('ditto', [appSource, signedApp]);
    verifyApplicationSignature(signedApp);

    await mkdir(diskImageRoot, { recursive: true });
    const stagedApp = join(diskImageRoot, `${productName}.app`);
    run('ditto', [signedApp, stagedApp]);
    verifyApplicationSignature(stagedApp);
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
      diskImage,
    ]);
    run('codesign', ['--force', '--timestamp', '--sign', identity, diskImage]);
    run('hdiutil', ['verify', diskImage]);
    await rm(diskImageRoot, { recursive: true, force: true });

    const notaryResult = await submitForNotarization(diskImage);
    if (notaryResult.id === undefined || notaryResult.id.trim() === '') {
      throw new Error('Apple accepted the upload but returned no Submission ID');
    }

    const state: NotarizationState = {
      schemaVersion: 1,
      submissionId: notaryResult.id,
      status: 'In Progress',
      productVersion: version,
      architecture,
      gitCommit,
      dirtyWorktree: gitStatus !== '',
      temporaryRoot,
      signedApp,
      diskImage,
      submittedAt: new Date().toISOString(),
    };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    submissionRecorded = true;
    process.stdout.write(
      `Notarization submitted once as ${state.submissionId}. State saved to ${statePath}.\nRun pnpm release:mac:finish later; no long-lived connection is required.\n`,
    );
  } finally {
    if (!submissionRecorded) {
      process.stderr.write(
        `Release submission failed; intermediate files were preserved at ${temporaryRoot}\n`,
      );
    }
  }
}

async function finishRelease(): Promise<void> {
  const state = await readState();
  const result = await notarizationInfo(state.submissionId);

  if (result.status === 'In Progress') {
    process.stdout.write(
      `Notarization ${state.submissionId} is still In Progress. No files were resubmitted.\n`,
    );
    return;
  }
  if (result.status !== 'Accepted') {
    throw new Error(
      `Apple notarization ${state.submissionId} returned ${result.status ?? 'an unknown status'}. The preserved workspace is ${state.temporaryRoot}`,
    );
  }

  const notarizationLogPath = join(outputDirectory, 'notarization-log.json');
  const notarizationLog = await downloadNotarizationLog(state.submissionId);
  await writeFile(notarizationLogPath, `${JSON.stringify(notarizationLog, null, 2)}\n`);
  const warnings = (notarizationLog.issues ?? []).filter((issue) =>
    ['warning', 'error'].includes(issue.severity?.toLowerCase() ?? ''),
  );
  if (warnings.length > 0) {
    throw new Error(
      `Apple notarization log contains ${String(warnings.length)} warning/error issue(s); review ${notarizationLogPath} before continuing.`,
    );
  }

  run('xcrun', ['stapler', 'staple', state.signedApp]);
  run('xcrun', ['stapler', 'staple', state.diskImage]);
  verifyApplication(state.signedApp);
  verifyDiskImage(state.diskImage);

  const finalDmg = join(
    outputDirectory,
    `${productName}-${state.productVersion}-${state.architecture}.dmg`,
  );
  const finalZip = join(
    outputDirectory,
    `${productName}-darwin-${state.architecture}-${state.productVersion}.zip`,
  );
  const checksumPath = join(outputDirectory, 'SHA256SUMS.txt');
  const manifestPath = join(outputDirectory, 'release-manifest.json');

  run('ditto', ['-c', '-k', '--keepParent', state.signedApp, finalZip]);
  const archiveVerificationRoot = join(state.temporaryRoot, 'zip-verification');
  await mkdir(archiveVerificationRoot);
  run('ditto', ['-x', '-k', finalZip, archiveVerificationRoot]);
  verifyApplication(join(archiveVerificationRoot, `${productName}.app`));
  await rm(archiveVerificationRoot, { recursive: true, force: true });
  await copyFile(state.diskImage, finalDmg);
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
        version: state.productVersion,
        architecture: state.architecture,
        gitCommit: state.gitCommit,
        dirtyWorktree: state.dirtyWorktree,
        notarizationSubmissionId: state.submissionId,
        artifacts: checksums.map(([file, sha256Digest]) => ({
          file,
          sha256: sha256Digest,
        })),
      },
      null,
      2,
    )}\n`,
  );
  await rm(statePath, { force: true });
  await rm(state.temporaryRoot, { recursive: true, force: true });
  process.stdout.write(`Release artifacts ready in ${outputDirectory}\n`);
}

async function readState(): Promise<NotarizationState> {
  let state: NotarizationState;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8')) as NotarizationState;
  } catch (error) {
    throw new Error(
      `Unable to read ${statePath}. Submit with pnpm release:mac first.`,
      { cause: error },
    );
  }
  if (
    state.schemaVersion !== 1 ||
    typeof state.submissionId !== 'string' ||
    typeof state.signedApp !== 'string' ||
    typeof state.diskImage !== 'string'
  ) {
    throw new Error(`Invalid notarization state in ${statePath}`);
  }
  await access(state.signedApp);
  await access(state.diskImage);
  return state;
}

async function submitForNotarization(path: string): Promise<NotaryResult> {
  const arguments_ = [
    'notarytool',
    'submit',
    path,
    ...notaryCredentials,
    '--no-s3-acceleration',
    '--output-format',
    'json',
  ];
  if (process.env.MACOS_RELEASE_WAIT === 'true') {
    arguments_.push('--wait');
  }
  const output = await runStreaming('xcrun', arguments_);
  return JSON.parse(output) as NotaryResult;
}

async function readPortableReceipt(
  path: string,
): Promise<PortableVerificationReceipt> {
  const receipt = JSON.parse(
    await readFile(path, 'utf8'),
  ) as PortableVerificationReceipt;
  if (
    receipt.schemaVersion !== 1 ||
    typeof receipt.verifiedArchiveSha256 !== 'string' ||
    typeof receipt.version !== 'string' ||
    receipt.architecture !== 'arm64' ||
    typeof receipt.gitCommit !== 'string' ||
    receipt.smokeTest !== 'passed'
  ) {
    throw new Error(`Invalid portable verification receipt: ${path}`);
  }
  return receipt;
}

async function notarizationInfo(submissionId: string): Promise<NotaryResult> {
  const output = await runStreaming('xcrun', [
    'notarytool',
    'info',
    submissionId,
    ...notaryCredentials,
    '--output-format',
    'json',
  ]);
  return JSON.parse(output) as NotaryResult;
}

async function downloadNotarizationLog(
  submissionId: string,
): Promise<NotaryLog> {
  const output = await runStreaming('xcrun', [
    'notarytool',
    'log',
    submissionId,
    ...notaryCredentials,
  ]);
  return JSON.parse(output) as NotaryLog;
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
  verifyApplicationSignature(path);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', path]);
  run('xcrun', ['stapler', 'validate', path]);
}

function verifyApplicationSignature(path: string): void {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', path]);
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
      else {
        rejectPromise(
          new Error(`${command} failed with status ${String(code)}: ${stderr}`),
        );
      }
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
