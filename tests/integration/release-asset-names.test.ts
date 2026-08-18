import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('GitHub release asset names', () => {
  it('normalizes metadata before GitHub can rewrite filenames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'release-assets-'));
    const digest = 'a'.repeat(64);
    await writeFile(
      join(directory, 'release-manifest.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        artifacts: [
          {
            file: 'DeepSeek YukiRyou-0.1.1-beta.1-arm64.dmg',
            sha256: digest,
          },
        ],
      })}\n`,
    );
    await writeFile(
      join(directory, 'SHA256SUMS.txt'),
      `${digest}  DeepSeek YukiRyou-0.1.1-beta.1-arm64.dmg\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'normalize-release-asset-names.ts'),
        `--directory=${directory}`,
        '--metadata-only=true',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).toBe(
      `${digest}  DeepSeek.YukiRyou-0.1.1-beta.1-arm64.dmg\n`,
    );
    expect(
      JSON.parse(
        await readFile(join(directory, 'release-manifest.json'), 'utf8'),
      ),
    ).toMatchObject({
      artifacts: [
        { file: 'DeepSeek.YukiRyou-0.1.1-beta.1-arm64.dmg', sha256: digest },
      ],
    });
  });
});
