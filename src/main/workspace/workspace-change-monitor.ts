import { watch, type FSWatcher } from 'node:fs';

const IGNORED_ROOTS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.astro', '.next', '.turbo', '.pnpm-store',
]);

export interface WorkspaceChangeMonitor {
  close(): void;
}

export function createWorkspaceChangeMonitor(
  root: string,
  onChange: () => void,
  debounceMs = 250,
): WorkspaceChangeMonitor {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const schedule = (): void => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, debounceMs);
    timer.unref();
  };
  const listener = (_event: string, filename: string | Buffer | null): void => {
    const path = filename === null ? undefined : filename.toString().replaceAll('\\', '/');
    if (path !== undefined && !isReviewRelevantPath(path)) return;
    schedule();
  };
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, listener);
  } catch {
    watcher = watch(root, listener);
  }
  watcher.on('error', schedule);
  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher.close();
    },
  };
}

export function isReviewRelevantPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
  const root = normalized.split('/')[0];
  if (root === undefined || root === '') return true;
  if (IGNORED_ROOTS.has(root)) return false;
  if (root !== '.git') return true;
  return normalized === '.git/HEAD' || normalized === '.git/index' || normalized.startsWith('.git/refs/');
}
