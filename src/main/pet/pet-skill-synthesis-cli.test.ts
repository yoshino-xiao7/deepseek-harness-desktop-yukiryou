import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from '../../shared/pet-package.js';
import { PET_MOTION_GENERATION_SPECS } from './frame-sequence-generation-orchestrator.js';

const execute = promisify(execFile);

describe('synthesize-yukiryou-pet-all CLI', () => {
  it('resumes a completed run without rebuilding or asking for per-motion input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yukiryou-pet-synthesis-all-'));
    const generated = join(root, 'generated');
    const atlases = join(generated, 'atlases');
    await mkdir(atlases, { recursive: true });
    await Promise.all(PET_MOTIONS.flatMap((motion) => {
      const spec = PET_MOTION_GENERATION_SPECS[motion];
      return [
        writeFile(join(atlases, `${motion}.png`), 'test-atlas'),
        writeFile(join(generated, `${motion}.json`), JSON.stringify({
          schemaVersion: 1,
          motion,
          frameCount: spec.frameCount,
          durationMs: spec.durationMs,
          loop: spec.loop,
          synthesis: { status: 'complete' },
        })),
      ];
    }));

    const { stdout } = await execute(process.execPath, [
      'scripts/synthesize-yukiryou-pet-all.mjs',
      `--run=${root}`,
    ], { cwd: process.cwd() });

    expect(JSON.parse(stdout)).toEqual({ status: 'complete', completed: [], skipped: PET_MOTIONS });
  });
});
