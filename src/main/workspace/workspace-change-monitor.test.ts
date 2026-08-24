import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createWorkspaceChangeMonitor,
  isReviewRelevantPath,
} from './workspace-change-monitor.js';

describe('workspace change monitor', () => {
  it('keeps source and Git state changes while ignoring generated dependency noise', () => {
    expect(isReviewRelevantPath('src/main/app.ts')).toBe(true);
    expect(isReviewRelevantPath('.git/index')).toBe(true);
    expect(isReviewRelevantPath('.git/refs/heads/main')).toBe(true);
    expect(isReviewRelevantPath('node_modules/pkg/index.js')).toBe(false);
    expect(isReviewRelevantPath('dist/app.js')).toBe(false);
    expect(isReviewRelevantPath('.git/objects/ab/cd')).toBe(false);
  });

  it('notifies after a nested workspace file changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-change-monitor-'));
    await mkdir(join(root, 'src'));
    try {
      let resolveChanged: (() => void) | undefined;
      const changed = new Promise<void>((resolve) => { resolveChanged = resolve; });
      const monitor = createWorkspaceChangeMonitor(root, () => resolveChanged?.(), 10);
      await writeFile(join(root, 'src', 'app.ts'), 'export {}\n');
      await Promise.race([
        changed,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('workspace change was not observed')), 2_000);
        }),
      ]);
      monitor.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
