import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
  let fingerprint: string | undefined;
  let pollInFlight = false;
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
  const reconcile = async (initial = false): Promise<void> => {
    if (closed || pollInFlight) return;
    pollInFlight = true;
    try {
      const next = await workspaceFingerprint(root);
      if (closed) return;
      if (initial || fingerprint !== undefined && fingerprint !== next) schedule();
      fingerprint = next;
    } catch {
      schedule();
    } finally {
      pollInFlight = false;
    }
  };
  // fs.watch recursive delivery differs across platforms and filesystems. An
  // initial reconciliation closes its registration race; the low-frequency
  // fingerprint catches events a native watcher silently drops.
  void reconcile(true);
  const pollTimer = setInterval(() => { void reconcile(); }, Math.max(1_000, debounceMs * 4));
  pollTimer.unref();
  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(pollTimer);
      watcher.close();
    },
  };
}

async function workspaceFingerprint(root: string): Promise<string> {
  let count = 0;
  let size = 0;
  let modified = 0;
  const pending = [{ absolute: root, relative: '' }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const entries = await readdir(current.absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = current.relative === '' ? entry.name : `${current.relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (shouldTraverseDirectory(relative)) {
          pending.push({ absolute: join(current.absolute, entry.name), relative });
        }
        continue;
      }
      if (!entry.isFile() || !isReviewRelevantPath(relative)) continue;
      const metadata = await stat(join(current.absolute, entry.name));
      count += 1;
      size += metadata.size;
      modified += metadata.mtimeMs;
    }
  }
  return `${String(count)}:${String(size)}:${String(modified)}`;
}

function shouldTraverseDirectory(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
  const root = normalized.split('/')[0];
  if (root === undefined || root === '' || IGNORED_ROOTS.has(root)) return false;
  if (root !== '.git') return true;
  return normalized === '.git' || normalized === '.git/refs' || normalized.startsWith('.git/refs/');
}

export function isReviewRelevantPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
  const root = normalized.split('/')[0];
  if (root === undefined || root === '') return true;
  if (IGNORED_ROOTS.has(root)) return false;
  if (root !== '.git') return true;
  return normalized === '.git/HEAD' || normalized === '.git/index' || normalized.startsWith('.git/refs/');
}
