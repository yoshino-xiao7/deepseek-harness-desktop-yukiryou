import { setTimeout as delay } from 'node:timers/promises';

export interface UpdateShellCandidate {
  url(): string;
  evaluate(pageFunction: () => boolean | Promise<boolean>): Promise<boolean>;
}

interface WaitOptions {
  maxAttempts?: number;
  intervalMs?: number;
  delay?: (milliseconds: number) => Promise<unknown>;
}

export async function waitForUpdateShell<T extends UpdateShellCandidate>(
  application: { windows(): T[] },
  options: WaitOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 120;
  const intervalMs = options.intervalMs ?? 250;
  const wait = options.delay ?? delay;
  let inspectedUrls: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const windows = application.windows();
    inspectedUrls = windows.map((page) => page.url());
    for (const page of windows) {
      try {
        const hasBridge = await page.evaluate(() => {
          const updates = (window as unknown as {
            deepSeekYukiRyouUpdates?: {
              check?: unknown;
              install?: unknown;
              getSnapshot?: unknown;
            };
          }).deepSeekYukiRyouUpdates;
          return updates !== undefined
            && typeof updates.check === 'function'
            && typeof updates.install === 'function'
            && typeof updates.getSnapshot === 'function';
        });
        if (hasBridge) return page;
      } catch {
        // A transient or closing window is not the desktop shell.
      }
    }
    if (attempt + 1 < maxAttempts) await wait(intervalMs);
  }

  throw new Error(
    `Desktop update bridge was unavailable after inspecting: ${
      inspectedUrls.length === 0 ? '(no windows)' : inspectedUrls.join(', ')
    }`,
  );
}
