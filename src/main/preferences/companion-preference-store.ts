import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  COMPANION_PANEL_DEFAULT_WIDTH,
  clampCompanionPreferredWidth,
} from '../../shared/desktop-companion.js';

export interface CompanionPanelPreference {
  readonly open: boolean;
  readonly preferredWidth: number;
}

export interface CompanionPreferenceStore {
  getSnapshot(): CompanionPanelPreference;
  save(preference: CompanionPanelPreference): Promise<void>;
}

const DEFAULT_PREFERENCE: CompanionPanelPreference = Object.freeze({
  open: true,
  preferredWidth: COMPANION_PANEL_DEFAULT_WIDTH,
});

export async function openCompanionPreferenceStore(
  path: string,
): Promise<CompanionPreferenceStore> {
  let document = await readDocument(path);
  let snapshot = readPreference(document) ?? DEFAULT_PREFERENCE;
  let pending = Promise.resolve();
  return {
    getSnapshot: () => snapshot,
    async save(preference) {
      const next = Object.freeze({
        open: preference.open,
        preferredWidth: clampCompanionPreferredWidth(preference.preferredWidth),
      });
      pending = pending.then(async () => {
        document = { ...document, companion: next };
        await writeDocument(path, document);
        snapshot = next;
      });
      await pending;
    },
  };
}

async function readDocument(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readPreference(document: Record<string, unknown>): CompanionPanelPreference | undefined {
  const value = document.companion;
  if (!isRecord(value) || typeof value.open !== 'boolean' || typeof value.preferredWidth !== 'number') {
    return undefined;
  }
  if (clampCompanionPreferredWidth(value.preferredWidth) !== value.preferredWidth) return undefined;
  return Object.freeze({ open: value.open, preferredWidth: value.preferredWidth });
}

async function writeDocument(path: string, document: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
