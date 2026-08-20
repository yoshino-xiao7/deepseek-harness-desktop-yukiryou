import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PET_MOTIONS } from '../../shared/pet-package.js';
import { createPngHeader } from './pet-package-test-helper.js';
import { preparePetSkillRun } from './pet-skill-run-preparer.js';

describe('preparePetSkillRun', () => {
  it('turns one primary reference and plain language into a validated nine-motion job graph', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'yukiryou-pet-skill-'));
    const primaryPath = join(temporary, 'character.png');
    const outputDirectory = join(temporary, 'nested', 'runs', 'run');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(
      primaryPath,
      createPngHeader({ width: 2048, height: 2048 }),
    ));

    const result = await preparePetSkillRun({
      schemaVersion: 1,
      locale: 'zh-CN',
      displayName: 'YukiRyou',
      request: '动作自然、活泼，保持角色形象稳定。',
      references: [{ id: 'primary', role: 'primary', path: primaryPath }],
    }, outputDirectory);

    expect(result.creatorInput.references).toHaveLength(1);
    expect(result.jobs.map(({ id }) => id)).toEqual(['canonical-look', ...PET_MOTIONS]);
    expect(result.jobs.find(({ id }) => id === 'sleeping')?.dependsOn).toEqual(['canonical-look', 'lying-down']);
    expect(result.jobs.find(({ id }) => id === 'eating')?.dependsOn).toEqual(['canonical-look', 'work-enter']);
    expect(result.jobs.find(({ id }) => id === 'standing')?.outputPath).toBe('generated/keyframes/standing');
    await expect(readFile(join(outputDirectory, 'creator-input.json'), 'utf8')).resolves.toContain('YukiRyou');
    await expect(readFile(join(outputDirectory, 'prompts', 'rubbing-eyes.md'), 'utf8')).resolves.toContain('120 final frames');
    await expect(readFile(join(outputDirectory, 'references', 'primary.png'))).resolves.toEqual(
      createPngHeader({ width: 2048, height: 2048 }),
    );
  });

  it('rejects multiple primary references before creating output', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'yukiryou-pet-skill-invalid-'));
    const first = join(temporary, 'first.png');
    const second = join(temporary, 'second.png');
    const { writeFile } = await import('node:fs/promises');
    await Promise.all([
      writeFile(first, createPngHeader({ width: 256, height: 256 })),
      writeFile(second, createPngHeader({ width: 256, height: 256 })),
    ]);

    await expect(preparePetSkillRun({
      schemaVersion: 1,
      locale: 'en',
      displayName: 'Invalid',
      request: 'Keep identity stable while moving naturally.',
      references: [
        { id: 'first', role: 'primary', path: first },
        { id: 'second', role: 'primary', path: second },
      ],
    }, join(temporary, 'run'))).rejects.toThrow('references.primary');
  });
});
