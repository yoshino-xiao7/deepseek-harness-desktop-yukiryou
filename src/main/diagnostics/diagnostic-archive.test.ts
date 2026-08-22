import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDiagnosticReport,
  createDiagnosticArchive,
} from './diagnostic-archive.js';

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('diagnostic archive', () => {
  it('redacts secrets and replaces the user home in its report', () => {
    const report = buildDiagnosticReport({
      application: 'DeepSeek YukiRyou',
      applicationVersion: '0.1.0',
      electronVersion: '43.4.0',
      harnessVersion: '0.1.0-rc.7',
      architecture: 'arm64',
      operatingSystem: 'darwin 25.6.0',
      failureCode: 'spawn-failed',
      failureDetails: 'at /Users/yuki/private Authorization: Bearer secret-value',
      userHome: '/Users/yuki',
    });

    expect(report).toContain('at ~/private');
    expect(report).toContain('Bearer [REDACTED]');
    expect(report).not.toContain('/Users/yuki');
    expect(report).not.toContain('secret-value');
  });

  it('creates a ZIP containing only redacted diagnostic logs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yukiryou-diagnostics-test-'));
    temporaryDirectories.push(directory);
    const logs = join(directory, 'logs');
    const archive = join(directory, 'diagnostics.zip');
    await mkdir(logs);
    await writeFile(
      join(logs, 'desktop.log'),
      'path=/Users/yuki/work token=sk-abcdefghijk12345',
    );
    await writeFile(join(logs, 'unrelated.txt'), 'must not be exported');

    await createDiagnosticArchive({
      destinationPath: archive,
      logDirectory: logs,
      metadata: {
        application: 'DeepSeek YukiRyou',
        applicationVersion: '0.1.0',
        electronVersion: '43.4.0',
        harnessVersion: '0.1.0-rc.7',
        architecture: 'arm64',
        operatingSystem: `${process.platform} test`,
        failureCode: 'none',
        failureDetails: 'No failure recorded',
        userHome: '/Users/yuki',
      },
    });

    const extracted = join(directory, 'extracted');
    await extractArchive(archive, extracted);
    const logContents = await readFile(join(
      extracted,
      'DeepSeek YukiRyou Diagnostics',
      'logs',
      'desktop.log',
    ), 'utf8');
    const listing = (await readdir(extracted, { recursive: true })).join('\n');
    expect(logContents).toContain('path=~/work token=[REDACTED_TOKEN]');
    expect(listing).not.toContain('unrelated.txt');
  }, 30_000);
});

async function extractArchive(archive: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  if (process.platform === 'win32') {
    await executeFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:DSH_TEST_ARCHIVE,$env:DSH_TEST_DESTINATION)',
    ], {
      env: {
        ...process.env,
        DSH_TEST_ARCHIVE: archive,
        DSH_TEST_DESTINATION: destination,
      },
    });
    return;
  }
  await executeFile('/usr/bin/unzip', ['-q', archive, '-d', destination]);
}
