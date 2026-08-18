import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from '../e2e/executable-path.js';

const cycles = Number.parseInt(process.env.DSH_MEMORY_CYCLES ?? '250', 10);

interface MemorySample {
  readonly cycle: number;
  readonly mainWorkingSetMiB: number;
  readonly rendererWorkingSetMiB: number;
  readonly totalWorkingSetMiB: number;
}

describe('Desktop Companion long-session memory profile', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it(
    `keeps working set bounded across ${String(cycles)} panel and tab transitions`,
    async () => {
      userData = await mkdtemp(join(tmpdir(), 'dsh-companion-memory-'));
      electronApp = await electron.launch({
        executablePath: resolveE2eExecutablePath(),
        args: [`--user-data-dir=${userData}`],
        env: { ...process.env, DSH_DESKTOP_E2E: '1' },
      });
      await electronApp.firstWindow();
      await expect
        .poll(
          () => electronApp?.windows().find((candidate) => candidate.url().startsWith('file:')),
          { timeout: 30_000 },
        )
        .toBeDefined();
      const shellPage = electronApp
        .windows()
        .find((candidate) => candidate.url().startsWith('file:'));
      if (shellPage === undefined) throw new Error('shell renderer did not open');
      await expect
        .poll(() => shellPage.locator('[data-testid="companion-toggle"]').isVisible(), {
          timeout: 30_000,
        })
        .toBe(true);
      await expect
        .poll(
          () =>
            electronApp?.evaluate(({ webContents }) =>
              webContents
                .getAllWebContents()
                .some((contents) => contents.getURL().startsWith('http://127.0.0.1:')),
            ),
          { timeout: 30_000 },
        )
        .toBe(true);

      await exercise(shellPage, 100);
      await shellPage.waitForTimeout(1_000);
      const samples: MemorySample[] = [await sampleMemory(electronApp, 0)];
      const sampleInterval = Math.max(1, Math.floor(cycles / 5));
      for (let completed = 0; completed < cycles; completed += sampleInterval) {
        const batch = Math.min(sampleInterval, cycles - completed);
        await exercise(shellPage, batch);
        await shellPage.waitForTimeout(500);
        samples.push(await sampleMemory(electronApp, completed + batch));
      }

      const baseline = samples[0];
      const final = samples.at(-1);
      if (baseline === undefined || final === undefined) {
        throw new Error('memory profile did not collect samples');
      }
      const totalGrowthMiB = final.totalWorkingSetMiB - baseline.totalWorkingSetMiB;
      const peakGrowthMiB = Math.max(
        ...samples.map((sample) => sample.totalWorkingSetMiB - baseline.totalWorkingSetMiB),
      );
      process.stdout.write(
        `Companion memory profile: ${JSON.stringify({ samples, totalGrowthMiB, peakGrowthMiB })}\n`,
      );

      expect(totalGrowthMiB).toBeLessThan(64);
      expect(peakGrowthMiB).toBeLessThan(96);
    },
    120_000,
  );
});

async function exercise(
  shellPage: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  count: number,
): Promise<void> {
  await shellPage.evaluate((iterations) => {
    const bridge = (window as unknown as {
      deepSeekYukiRyouCompanion: { toggle(): void };
    }).deepSeekYukiRyouCompanion;
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')];
    for (let cycle = 0; cycle < iterations; cycle += 1) {
      bridge.toggle();
      tabs[cycle % Math.max(1, tabs.length)]?.click();
    }
  }, count);
}

async function sampleMemory(
  application: ElectronApplication,
  cycle: number,
): Promise<MemorySample> {
  return application.evaluate(({ app }, sampleCycle) => {
    const metrics = app.getAppMetrics();
    const mainWorkingSet = metrics
      .filter((metric) => metric.type === 'Browser')
      .reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
    const rendererWorkingSet = metrics
      .filter((metric) => metric.type !== 'Browser')
      .reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
    return {
      cycle: sampleCycle,
      mainWorkingSetMiB: mainWorkingSet / 1024,
      rendererWorkingSetMiB: rendererWorkingSet / 1024,
      totalWorkingSetMiB: (mainWorkingSet + rendererWorkingSet) / 1024,
    };
  }, cycle);
}
