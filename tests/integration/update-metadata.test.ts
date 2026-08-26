import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  writeUpdateMetadata,
  writeWebsiteDownloadManifest,
} from '../../scripts/update-metadata.js';

const execFileAsync = promisify(execFile);

describe('cross-platform update metadata', () => {
  it('runs the update metadata CLI with the repository Node runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'update-metadata-cli-'));
    const assets = join(root, 'assets');
    const output = join(root, 'output');
    await mkdir(assets);
    const version = '1.2.3-beta.4';
    await writeFile(
      join(assets, `DeepSeek.YukiRyou-darwin-arm64-${version}.zip`),
      'signed-mac',
    );
    await writeFile(
      join(assets, `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`),
      'windows-installer',
    );

    await execFileAsync(process.execPath, [
      join(process.cwd(), 'scripts', 'prepare-update-metadata.ts'),
      `--assets=${assets}`,
      `--output=${output}`,
      `--version=${version}`,
    ]);

    await expect(readFile(join(output, 'darwin-arm64', 'latest-mac.yml'), 'utf8'))
      .resolves.toContain(`version: ${version}`);
    await expect(readFile(join(output, 'win32-x64', 'latest.yml'), 'utf8'))
      .resolves.toContain(`version: ${version}`);
  });

  it('can generate one platform gate without requiring the other platform artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'update-metadata-target-'));
    const assets = join(root, 'assets');
    const output = join(root, 'output');
    await mkdir(assets);
    const version = '1.2.4';
    await writeFile(
      join(assets, `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`),
      'windows-only-candidate',
    );

    await writeUpdateMetadata({
      sourceDirectory: assets,
      outputDirectory: output,
      version,
      target: 'win32-x64',
      origin: 'https://download-cn.suzuki.ink',
    });

    await expect(readFile(join(output, 'win32-x64', 'latest.yml'), 'utf8'))
      .resolves.toContain(`version: ${version}`);
  });

  it('runs the China mirror CLI with the repository Node runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'china-mirror-cli-'));
    const assets = join(root, 'assets');
    const output = join(root, 'output');
    await mkdir(assets);
    const version = '1.2.3-beta.4';
    const commit = 'a'.repeat(40);
    const files = [
      `DeepSeek.YukiRyou-${version}-arm64.dmg`,
      `DeepSeek.YukiRyou-darwin-arm64-${version}.zip`,
      `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`,
      `DeepSeek.YukiRyou-win32-x64-${version}-portable.zip`,
      'SHA256SUMS.txt',
      'SHA256SUMS-Windows.txt',
      'notarization-log.json',
    ];
    for (const [index, name] of files.entries()) {
      await writeFile(join(assets, name), `verified-${index}`);
    }
    await writeFile(join(assets, 'release-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      version,
      gitCommit: commit,
      dirtyWorktree: false,
    }));

    await execFileAsync(process.execPath, [
      join(process.cwd(), 'scripts', 'prepare-china-mirror.ts'),
      `--assets=${assets}`,
      `--output=${output}`,
      `--version=${version}`,
      '--origin=https://download-cn.suzuki.ink',
    ]);

    const manifest = JSON.parse(
      await readFile(join(output, 'downloads', 'latest.json'), 'utf8'),
    ) as { version: string; gitCommit: string };
    expect(manifest).toMatchObject({ version, gitCommit: commit });
    await expect(readFile(join(output, 'updates', 'darwin-arm64', 'latest-mac.yml'), 'utf8'))
      .resolves.toContain(`version: ${version}`);
    await expect(readFile(join(output, 'updates', 'win32-x64', 'latest.yml'), 'utf8'))
      .resolves.toContain(`version: ${version}`);
  });

  it('binds the exact macOS ZIP and Windows installer bytes with SHA-512', async () => {
    const root = await mkdtemp(join(tmpdir(), 'update-metadata-'));
    const assets = join(root, 'assets');
    const output = join(root, 'output');
    await mkdir(assets);
    const version = '1.2.3-beta.4';
    const macName = `DeepSeek.YukiRyou-darwin-arm64-${version}.zip`;
    const winName = `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`;
    await writeFile(join(assets, macName), 'signed-mac');
    await writeFile(join(assets, winName), 'windows-installer');

    await writeUpdateMetadata({
      sourceDirectory: assets,
      outputDirectory: output,
      version,
      origin: 'https://download-cn.suzuki.ink',
    });

    const mac = parse(
      await readFile(join(output, 'darwin-arm64', 'latest-mac.yml'), 'utf8'),
    ) as { version: string; files: Array<{ url: string; sha512: string; size: number }> };
    expect(mac.version).toBe(version);
    expect(mac.files[0]?.url).toBe(
      `https://download-cn.suzuki.ink/releases/v${version}/${macName}`,
    );
    expect(mac.files[0]?.sha512).toBe(
      createHash('sha512').update('signed-mac').digest('base64'),
    );
    expect(mac.files[0]?.size).toBe(Buffer.byteLength('signed-mac'));
  });

  it('publishes stable website links for all four verified downloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'website-download-metadata-'));
    const assets = join(root, 'assets');
    const output = join(root, 'output');
    await mkdir(assets);
    const version = '1.2.3-beta.4';
    const files = [
      `DeepSeek.YukiRyou-${version}-arm64.dmg`,
      `DeepSeek.YukiRyou-darwin-arm64-${version}.zip`,
      `DeepSeek.YukiRyou-${version}-win32-x64-Setup.exe`,
      `DeepSeek.YukiRyou-win32-x64-${version}-portable.zip`,
    ];
    for (const [index, name] of files.entries()) {
      await writeFile(join(assets, name), `verified-${index}`);
    }

    const destination = await writeWebsiteDownloadManifest({
      sourceDirectory: assets,
      outputDirectory: output,
      version,
      origin: 'https://download-cn.suzuki.ink/',
      gitCommit: 'a'.repeat(40),
    });
    const manifest = JSON.parse(await readFile(destination, 'utf8')) as {
      schemaVersion: number;
      version: string;
      gitCommit: string;
      platforms: Record<string, {
        primary: { name: string; url: string; size: number; sha256: string };
        alternative: { name: string; url: string; size: number; sha256: string };
      }>;
    };

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      version,
      gitCommit: 'a'.repeat(40),
    });
    expect(Object.keys(manifest.platforms)).toEqual(['darwin-arm64', 'win32-x64']);
    for (const platform of Object.values(manifest.platforms)) {
      for (const download of [platform.primary, platform.alternative]) {
        expect(download.url).toBe(
          `https://download-cn.suzuki.ink/releases/v${version}/${download.name}`,
        );
        expect(download.size).toBeGreaterThan(0);
        expect(download.sha256).toMatch(/^[0-9a-f]{64}$/u);
      }
    }
  });
});
