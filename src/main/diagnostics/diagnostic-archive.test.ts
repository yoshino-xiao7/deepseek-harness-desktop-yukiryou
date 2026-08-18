import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      macOSVersion: '25.6.0',
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
        macOSVersion: '25.6.0',
        failureCode: 'none',
        failureDetails: 'No failure recorded',
        userHome: '/Users/yuki',
      },
    });

    const { stdout: logContents } = await executeFile('/usr/bin/unzip', [
      '-p',
      archive,
      'DeepSeek YukiRyou Diagnostics/logs/desktop.log',
    ]);
    const { stdout: listing } = await executeFile('/usr/bin/unzip', [
      '-Z1',
      archive,
    ]);
    expect(logContents).toContain('path=~/work token=[REDACTED_TOKEN]');
    expect(listing).not.toContain('unrelated.txt');
  });
});
