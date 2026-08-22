import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { redact } from './app-log.js';

export interface DiagnosticMetadata {
  readonly application: string;
  readonly applicationVersion: string;
  readonly electronVersion: string;
  readonly harnessVersion: string;
  readonly architecture: string;
  readonly operatingSystem: string;
  readonly failureCode: string;
  readonly failureDetails: string;
  readonly userHome: string;
}

export async function createDiagnosticArchive(options: {
  readonly destinationPath: string;
  readonly logDirectory: string;
  readonly metadata: DiagnosticMetadata;
}): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'deepseek-yukiryou-diagnostics-'));
  const bundleDirectory = join(temporaryRoot, 'DeepSeek YukiRyou Diagnostics');
  try {
    await mkdir(join(bundleDirectory, 'logs'), { recursive: true, mode: 0o700 });
    await writeFile(
      join(bundleDirectory, 'diagnostics.txt'),
      buildDiagnosticReport(options.metadata),
      { encoding: 'utf8', mode: 0o600 },
    );
    for (const logPath of await diagnosticLogPaths(options.logDirectory)) {
      const contents = await readFile(logPath, 'utf8');
      await writeFile(
        join(bundleDirectory, 'logs', basename(logPath)),
        sanitize(contents, options.metadata.userHome),
        { encoding: 'utf8', mode: 0o600 },
      );
    }
    await rm(options.destinationPath, { force: true });
    await runArchiver(bundleDirectory, options.destinationPath);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function buildDiagnosticReport(metadata: DiagnosticMetadata): string {
  return [
    `Generated: ${new Date().toISOString()}`,
    `Application: ${metadata.application} ${metadata.applicationVersion}`,
    `Electron: ${metadata.electronVersion}`,
    `Harness: ${metadata.harnessVersion}`,
    `Architecture: ${metadata.architecture}`,
    `Operating system: ${metadata.operatingSystem}`,
    `Failure: ${metadata.failureCode}`,
    `Details: ${sanitize(metadata.failureDetails, metadata.userHome)}`,
    '',
    'This archive contains redacted application logs only.',
  ].join('\n');
}

async function diagnosticLogPaths(logDirectory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(logDirectory);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
  return names
    .filter((name) => /^desktop\.log(?:\.\d+)?$/.test(name))
    .sort()
    .map((name) => join(logDirectory, name));
}

function sanitize(value: string, userHome: string): string {
  const redacted = redact(value);
  return userHome.length > 1 ? redacted.replaceAll(userHome, '~') : redacted;
}

async function runArchiver(source: string, destination: string): Promise<void> {
  if (process.platform === 'win32') {
    await runArchiveProcess(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:DSH_DIAGNOSTIC_SOURCE,$env:DSH_DIAGNOSTIC_DESTINATION,[IO.Compression.CompressionLevel]::Optimal,$true)',
      ],
      {
        ...process.env,
        DSH_DIAGNOSTIC_SOURCE: source,
        DSH_DIAGNOSTIC_DESTINATION: destination,
      },
    );
    return;
  }
  await runArchiveProcess(
    '/usr/bin/ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', source, destination],
  );
}

async function runArchiveProcess(
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', ...(env === undefined ? {} : { env }) });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${String(code)}`));
      }
    });
  });
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
