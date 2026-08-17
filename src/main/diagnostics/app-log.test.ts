import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppLog, redact } from './app-log.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('diagnostic redaction', () => {
  it('redacts tokens, authorization headers, and sensitive URL parameters', () => {
    const value = [
      'sk-abcdefghijk12345',
      'Authorization: Bearer private-value',
      'https://example.test/path?api_key=top-secret&mode=safe&token=also-secret',
    ].join(' ');

    const result = redact(value);

    expect(result).not.toContain('abcdefghijk12345');
    expect(result).not.toContain('private-value');
    expect(result).not.toContain('top-secret');
    expect(result).not.toContain('also-secret');
    expect(result).toContain('mode=safe');
  });

  it('rotates logs sequentially and keeps only the configured backups', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yukiryou-log-test-'));
    temporaryDirectories.push(directory);
    const log = await createAppLog(directory, {
      maxFileBytes: 180,
      backupCount: 2,
    });

    for (let index = 0; index < 8; index += 1) {
      log.write('test.event', `record-${String(index)}-${'x'.repeat(48)}`);
    }
    await log.close();

    const files = (await readdir(directory)).sort();
    expect(files).toEqual(['desktop.log', 'desktop.log.1', 'desktop.log.2']);
    expect(await readFile(join(directory, 'desktop.log'), 'utf8')).toContain(
      'record-7',
    );
  });
});
