import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveE2eExecutablePath } from '../e2e/executable-path.js';

const durationMs = Number.parseInt(
  process.env.DSH_PACKAGED_SOAK_DURATION_MS ?? '5_000',
  10,
);

interface HealthSample {
  readonly processCount: number;
  readonly totalWorkingSetMiB: number;
}

describe('packaged application soak', () => {
  let electronApp: ElectronApplication | undefined;
  let userData: string | undefined;

  afterEach(async () => {
    await electronApp?.close();
    if (userData !== undefined) {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it(
    `keeps the shell and Harness healthy for ${String(durationMs)}ms`,
    async () => {
      userData = await mkdtemp(join(tmpdir(), 'dsh-packaged-soak-'));
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

      await expect.poll(() => readHealth(electronApp!), { timeout: 30_000 }).toMatchObject({
        shellReady: true,
        harnessReady: true,
      });
      const baseline = await sampleProcesses(electronApp);
      let peakWorkingSetMiB = baseline.totalWorkingSetMiB;
      let peakProcessCount = baseline.processCount;
      const deadline = Date.now() + durationMs;
      do {
        await shellPage.waitForTimeout(
          Math.min(1_000, Math.max(50, deadline - Date.now())),
        );
        expect(await readHealth(electronApp)).toEqual({
          shellReady: true,
          harnessReady: true,
        });
        const sample = await sampleProcesses(electronApp);
        peakWorkingSetMiB = Math.max(peakWorkingSetMiB, sample.totalWorkingSetMiB);
        peakProcessCount = Math.max(peakProcessCount, sample.processCount);
      } while (Date.now() < deadline);

      const final = await sampleProcesses(electronApp);
      process.stdout.write(
        `Packaged soak profile: ${JSON.stringify({ durationMs, baseline, final, peakWorkingSetMiB, peakProcessCount })}\n`,
      );
      expect(peakProcessCount).toBeLessThanOrEqual(baseline.processCount + 2);
      expect(final.totalWorkingSetMiB - baseline.totalWorkingSetMiB).toBeLessThan(96);
      expect(peakWorkingSetMiB - baseline.totalWorkingSetMiB).toBeLessThan(160);
    },
    durationMs + 60_000,
  );
});

async function readHealth(application: ElectronApplication): Promise<{
  readonly shellReady: boolean;
  readonly harnessReady: boolean;
}> {
  return application.evaluate(async ({ webContents }) => {
    const allContents = webContents.getAllWebContents();
    const shell = allContents.find((contents) => contents.getURL().startsWith('file:'));
    const harness = allContents.find((contents) =>
      contents.getURL().startsWith('http://127.0.0.1:'),
    );
    if (shell === undefined || harness === undefined) {
      return { shellReady: false, harnessReady: false };
    }
    const [shellReady, harnessReady] = await Promise.all([
      shell.executeJavaScript('document.readyState === "complete"').catch(() => false),
      harness.executeJavaScript('document.readyState === "complete"').catch(() => false),
    ]);
    return { shellReady: shellReady === true, harnessReady: harnessReady === true };
  });
}

async function sampleProcesses(application: ElectronApplication): Promise<HealthSample> {
  return application.evaluate(({ app }) => {
    const metrics = app.getAppMetrics();
    return {
      processCount: metrics.length,
      totalWorkingSetMiB:
        metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) /
        1024,
    };
  });
}
