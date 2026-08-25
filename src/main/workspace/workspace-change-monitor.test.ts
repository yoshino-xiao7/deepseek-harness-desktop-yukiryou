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

  it('reconciles after watcher startup before observing nested workspace changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-change-monitor-'));
    await mkdir(join(root, 'src'));
    let monitor: ReturnType<typeof createWorkspaceChangeMonitor> | undefined;
    try {
      let changeCount = 0;
      let resolveChanged: (() => void) | undefined;
      const nextChange = (): Promise<void> => new Promise((resolve) => { resolveChanged = resolve; });
      let changed = nextChange();
      monitor = createWorkspaceChangeMonitor(root, () => {
        changeCount += 1;
        resolveChanged?.();
      }, 10);
      await expectObserved(changed);

      changed = nextChange();
      await writeFile(join(root, 'src', 'app.ts'), 'export {}\n');
      await expectObserved(changed);
      expect(changeCount).toBeGreaterThanOrEqual(2);
    } finally {
      monitor?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function expectObserved(changed: Promise<void>): Promise<void> {
  await Promise.race([
    changed,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('workspace change was not observed')), 2_000);
    }),
  ]);
}
