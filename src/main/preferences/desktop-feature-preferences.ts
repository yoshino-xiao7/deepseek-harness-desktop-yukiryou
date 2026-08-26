import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  DEFAULT_DESKTOP_FEATURE_PREFERENCES,
  type DesktopFeaturePreferences,
  validatedDesktopFeaturePreferences,
} from '../../shared/desktop-feature-preferences.js';

const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 4 * 1024;

interface PersistedDesktopFeaturePreferences extends DesktopFeaturePreferences {
  readonly schemaVersion: 1;
}

export interface DesktopFeaturePreferencesPersistence {
  readonly initialState: DesktopFeaturePreferences;
  update(state: DesktopFeaturePreferences): void;
  flush(): Promise<void>;
}

export async function createDesktopFeaturePreferencesPersistence(
  path: string,
  onError: (error: unknown) => void = () => {},
): Promise<DesktopFeaturePreferencesPersistence> {
  const initialState = await readPreferences(path).catch((error: unknown) => {
    onError(error);
    return DEFAULT_DESKTOP_FEATURE_PREFERENCES;
  });
  let pending: PersistedDesktopFeaturePreferences | undefined;
  let writes = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    while (pending !== undefined) {
      const snapshot = pending;
      pending = undefined;
      writes = writes.catch(() => undefined).then(() => atomicWrite(path, snapshot));
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
        void flush().catch(onError);
      }, 100);
      timer.unref();
    },
    flush,
  };
}

export function normalizedDesktopFeaturePreferences(
  value: unknown,
): DesktopFeaturePreferences | undefined {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) return undefined;
  return validatedDesktopFeaturePreferences(value);
}

async function readPreferences(path: string): Promise<DesktopFeaturePreferences> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_STATE_BYTES) {
      return DEFAULT_DESKTOP_FEATURE_PREFERENCES;
    }
    return normalizedDesktopFeaturePreferences(JSON.parse(await readFile(path, 'utf8'))) ??
      DEFAULT_DESKTOP_FEATURE_PREFERENCES;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return DEFAULT_DESKTOP_FEATURE_PREFERENCES;
    }
    throw error;
  }
}

async function atomicWrite(
  path: string,
  state: PersistedDesktopFeaturePreferences,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}
