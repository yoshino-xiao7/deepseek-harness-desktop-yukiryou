import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  canonicalConflictSiblingName,
  stagePackageResourceTree,
} from './package-resource-staging.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('package resource staging', () => {
  it('recognizes only numbered conflict copies', () => {
    expect(canonicalConflictSiblingName('package 2.json')).toBe('package.json');
    expect(canonicalConflictSiblingName('LICENSE 5')).toBe('LICENSE');
    expect(canonicalConflictSiblingName('chapter 1.md')).toBeUndefined();
    expect(canonicalConflictSiblingName('version 20.md')).toBeUndefined();
  });

  it('builds a clean mirror without mutating conflict copies in the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'package-resource-stage-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source');
    const target = join(root, 'target');
    await mkdir(join(source, 'nested'), { recursive: true });
    await writeFile(join(source, 'package.json'), '{"canonical":true}');
    await writeFile(join(source, 'package 2.json'), 'cloud conflict copy');
    await writeFile(join(source, 'chapter 1.md'), 'legitimate numbered file');
    await writeFile(join(source, 'nested', 'entry.js'), 'export {};');
    await symlink('entry.js', join(source, 'nested', 'current.js'));

    const result = await stagePackageResourceTree(source, target);

    expect(result).toEqual({ copiedFiles: 3, copiedSymlinks: 1, excludedConflictCopies: 1 });
    expect(await readdir(target)).toEqual(['chapter 1.md', 'nested', 'package.json']);
    expect(await readFile(join(target, 'package.json'), 'utf8')).toBe('{"canonical":true}');
    expect(await readFile(join(source, 'package 2.json'), 'utf8')).toBe('cloud conflict copy');
  });
});
