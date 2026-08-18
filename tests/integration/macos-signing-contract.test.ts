import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMacOsSignOptions,
  shouldIgnoreCodeSigningPath,
} from '../../forge.config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe('macOS signing contract', () => {
  it('fails packaging when signing fails', () => {
    const options = createMacOsSignOptions('Developer ID Application: Test');

    expect(options.continueOnError).toBe(false);
    expect(options.strictVerify).toBe(true);
  });

  it('signs Mach-O code while leaving ordinary resources to the app seal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'signing-contract-'));
    temporaryDirectories.push(directory);
    const executable = join(directory, 'runtime-node');
    const font = join(directory, 'font.woff2');

    await writeFile(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    await writeFile(font, Buffer.from('ordinary bundled resource'));

    expect(shouldIgnoreCodeSigningPath(executable)).toBe(false);
    expect(shouldIgnoreCodeSigningPath(font)).toBe(true);
    expect(shouldIgnoreCodeSigningPath(join(directory, 'Helper.app'))).toBe(
      false,
    );
  });

  it('removes workspace metadata before the final signature and archive', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts', 'prepare-release-candidate.ts'),
      'utf8',
    );
    const copyIndex = source.indexOf("'--noextattr'");
    const xattrIndex = source.indexOf("run('xattr'");
    const codesignIndex = source.indexOf("run('codesign'");
    const verifyIndex = source.indexOf("'verify:release'");
    const archiveIndex = source.indexOf("'-c', '-k', '--keepParent'");

    expect(copyIndex).toBeGreaterThan(-1);
    expect(xattrIndex).toBeGreaterThan(copyIndex);
    expect(codesignIndex).toBeGreaterThan(xattrIndex);
    expect(verifyIndex).toBeGreaterThan(codesignIndex);
    expect(archiveIndex).toBeGreaterThan(verifyIndex);
  });
});
