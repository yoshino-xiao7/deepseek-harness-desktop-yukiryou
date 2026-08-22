export async function loadProductDocument(
  load: () => Promise<void>,
  timeoutMs: number,
  reset: () => Promise<void> = async () => undefined,
  resetBeforeFirst = false,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (attempt > 0 || resetBeforeFirst) await reset();
      await loadProductDocumentOnce(load, timeoutMs);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

type ProductDocumentFailureListener = (
  event: unknown,
  errorCode: number,
  errorDescription: string,
  validatedUrl: string,
  isMainFrame: boolean,
) => void;

interface ProductDocumentNavigationTarget {
  once(event: 'did-finish-load', listener: () => void): unknown;
  on(event: 'did-fail-load', listener: ProductDocumentFailureListener): unknown;
  removeListener(event: 'did-finish-load', listener: () => void): unknown;
  removeListener(event: 'did-fail-load', listener: ProductDocumentFailureListener): unknown;
  loadURL(url: string): Promise<void>;
}

export async function navigateProductDocument(
  target: ProductDocumentNavigationTarget,
  url: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => settle(resolve);
    const fail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) return;
      settle(() => reject(new Error(
        `Product document navigation failed (${String(errorCode)}): ${errorDescription}`,
      )));
    };
    const cleanup = () => {
      target.removeListener('did-finish-load', finish);
      target.removeListener('did-fail-load', fail);
    };
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };

    target.once('did-finish-load', finish);
    target.on('did-fail-load', fail);
    void target.loadURL(url).then(
      () => settle(resolve),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

interface ProductDocumentResetTarget {
  stop(): void;
  getURL(): string;
  loadURL(url: string): Promise<void>;
}

export async function resetProductDocument(
  target: ProductDocumentResetTarget,
): Promise<void> {
  target.stop();
  const current = target.getURL();
  if (current === 'about:blank') return;
  try {
    await target.loadURL('about:blank');
  } catch (error) {
    if (!isAbortedNavigation(error)) throw error;
  }
}

function isAbortedNavigation(error: unknown): boolean {
  return error instanceof Error &&
    (('code' in error && error.code === 'ERR_ABORTED') ||
      ('errno' in error && error.errno === -3));
}

async function loadProductDocumentOnce(
  load: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      load(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(
            `Product document navigation timed out after ${String(timeoutMs)}ms`,
          ));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
