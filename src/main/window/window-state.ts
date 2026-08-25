import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 4 * 1024;
const MIN_WIDTH = 820;
const MIN_HEIGHT = 600;
const MAX_DIMENSION = 16_384;
const WRITE_DEBOUNCE_MS = 250;

export interface WindowRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopWindowState {
  readonly bounds: WindowRectangle;
  readonly maximized: boolean;
}

interface PersistedWindowState extends DesktopWindowState {
  readonly schemaVersion: 1;
}

export interface WindowStatePersistence {
  readonly initialState: DesktopWindowState | undefined;
  update(state: DesktopWindowState): void;
  flush(): Promise<void>;
}

export async function createWindowStatePersistence(
  path: string,
  workAreas: readonly WindowRectangle[],
  onError: (error: unknown) => void = () => {},
): Promise<WindowStatePersistence> {
  const initialState = await readWindowState(path, workAreas).catch((error: unknown) => {
    onError(error);
    return undefined;
  });
  let pending: PersistedWindowState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();

  const writePending = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    while (pending !== undefined) {
      const snapshot = pending;
      pending = undefined;
      // A transient write failure must not permanently poison the queue. The
      // caller still receives the current failure, while later updates remain
      // writable.
      writes = writes.catch(() => undefined).then(() => atomicWriteWindowState(path, snapshot));
      await writes;
    }
  };

  return {
    initialState,
    update(state) {
      pending = { schemaVersion: SCHEMA_VERSION, ...state };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void writePending().catch(onError);
      }, WRITE_DEBOUNCE_MS);
      timer.unref();
    },
    flush: writePending,
  };
}

export function normalizedWindowState(
  value: unknown,
  workAreas: readonly WindowRectangle[],
): DesktopWindowState | undefined {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION ||
      typeof value.maximized !== 'boolean' || !isRectangle(value.bounds) ||
      value.bounds.width < MIN_WIDTH || value.bounds.height < MIN_HEIGHT ||
      value.bounds.width > MAX_DIMENSION || value.bounds.height > MAX_DIMENSION ||
      workAreas.length === 0 || workAreas.some((area) => !isRectangle(area))) {
    return undefined;
  }
  const bounds = value.bounds;
  const ranked = workAreas
    .map((area) => ({ area, intersection: intersectionArea(bounds, area) }))
    .sort((left, right) => right.intersection - left.intersection);
  const selected = ranked[0];
  if (selected === undefined) return undefined;
  const width = Math.min(bounds.width, selected.area.width);
  const height = Math.min(bounds.height, selected.area.height);
  const x = selected.intersection > 0
    ? clamp(bounds.x, selected.area.x, selected.area.x + selected.area.width - width)
    : selected.area.x + Math.floor((selected.area.width - width) / 2);
  const y = selected.intersection > 0
    ? clamp(bounds.y, selected.area.y, selected.area.y + selected.area.height - height)
    : selected.area.y + Math.floor((selected.area.height - height) / 2);
  return { bounds: { x, y, width, height }, maximized: value.maximized };
}

async function readWindowState(
  path: string,
  workAreas: readonly WindowRectangle[],
): Promise<DesktopWindowState | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_STATE_BYTES) {
      return undefined;
    }
    return normalizedWindowState(JSON.parse(await readFile(path, 'utf8')), workAreas);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function atomicWriteWindowState(
  path: string,
  state: PersistedWindowState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function intersectionArea(left: WindowRectangle, right: WindowRectangle): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function isRectangle(value: unknown): value is WindowRectangle {
  if (!isRecord(value)) return false;
  return ['x', 'y', 'width', 'height'].every((key) =>
    typeof value[key] === 'number' && Number.isSafeInteger(value[key]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
