import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createPetLibraryFake,
  type PetLibraryImportOutcome,
  type PetAssetSummary,
  type PetLibrary,
  type PetLibraryCommand,
  type PetLibraryResult,
} from '../../shared/pet-library.js';
import { preflightPetPackage } from './pet-package-preflight.js';
import { openPetImportInbox } from './pet-import-inbox.js';
import type { PetRuntimeValidationResult, PetRuntimeValidator } from './pet-runtime-validator.js';

interface PetLibraryIndex {
  readonly schemaVersion: 0;
  readonly enabled: boolean;
  readonly activePetId?: string;
  readonly revision: number;
}

export async function openPetLibraryStore(options: {
  readonly rootDirectory: string;
  readonly builtInAssets: readonly PetAssetSummary[];
  readonly chooseArchive?: () => Promise<Uint8Array | undefined>;
  readonly developmentInboxEnabled?: boolean;
  readonly runtimeValidator?: PetRuntimeValidator;
}): Promise<PetLibrary> {
  await mkdir(options.rootDirectory, { recursive: true, mode: 0o700 });
  const indexPath = join(options.rootDirectory, 'library.json');
  const inbox = options.developmentInboxEnabled === true
    ? await openPetImportInbox(join(options.rootDirectory, 'dev-inbox'))
    : undefined;
  const stored = await readIndex(indexPath);
  const fallbackActiveId = options.builtInAssets.find((asset) => asset.status === 'ready')?.id;
  const activePetId = stored?.activePetId !== undefined
    && options.builtInAssets.some((asset) => asset.id === stored.activePetId && asset.status === 'ready')
    ? stored.activePetId
    : fallbackActiveId;
  const memory = createPetLibraryFake({
    assets: options.builtInAssets,
    enabled: stored?.enabled ?? true,
    canImport: options.developmentInboxEnabled === true,
    revision: stored?.revision ?? 0,
    inbox: inbox?.list() ?? [],
    importPet: async (): Promise<PetLibraryImportOutcome> => {
      if (options.developmentInboxEnabled !== true) return { status: 'rejected', code: 'inbox-disabled' };
      try {
        const archive = await options.chooseArchive?.();
        if (archive === undefined) return { status: 'cancelled' };
        if (inbox === undefined) return { status: 'rejected', code: 'inbox-disabled' };
        if (options.runtimeValidator !== undefined) {
          const validation = await options.runtimeValidator.validate(archive);
          if (isPreflightRejection(validation)) {
            return { status: 'rejected', code: libraryPackageRejection(validation.code) };
          }
          const summary = validation.package;
          const sealed = await inbox.seal(archive, summary);
          const item = await inbox.setRuntimeStatus(
            sealed.id,
            validation.status === 'accepted' ? 'runtime-compatible' : 'runtime-rejected',
          );
          return { status: 'accepted', item };
        }
        const result = await preflightPetPackage(archive);
        if (result.status === 'rejected') {
          return { status: 'rejected', code: libraryPackageRejection(result.code) };
        }
        return { status: 'accepted', item: await inbox.seal(archive, result.package) };
      } catch {
        return { status: 'rejected', code: 'package-invalid' };
      }
    },
    ...(activePetId === undefined ? {} : { activePetId }),
  });
  let requestTail: Promise<void> = Promise.resolve();

  return {
    getSnapshot: () => memory.getSnapshot(),
    subscribe: (listener) => memory.subscribe(listener),
    request(command: PetLibraryCommand): Promise<PetLibraryResult> {
      const result = requestTail.then(async () => {
        const outcome = await memory.request(command);
        if (outcome.status === 'accepted') await writeIndex(indexPath, outcome.snapshot);
        return outcome;
      });
      requestTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

function isPreflightRejection(
  result: PetRuntimeValidationResult,
): result is Extract<PetRuntimeValidationResult, { status: 'rejected'; code: `pet-package-${string}` }> {
  return result.status === 'rejected'
    && (result.code === 'pet-package-invalid'
      || result.code === 'pet-package-too-large'
      || result.code === 'pet-package-unsafe');
}

function libraryPackageRejection(
  code: 'pet-package-invalid' | 'pet-package-too-large' | 'pet-package-unsafe',
): 'package-invalid' | 'package-too-large' | 'package-unsafe' {
  return code === 'pet-package-too-large'
    ? 'package-too-large'
    : code === 'pet-package-unsafe'
      ? 'package-unsafe'
      : 'package-invalid';
}

async function readIndex(path: string): Promise<PetLibraryIndex | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const keys = Object.keys(parsed).sort();
  const expected = (parsed.activePetId === undefined
    ? ['enabled', 'revision', 'schemaVersion']
    : ['activePetId', 'enabled', 'revision', 'schemaVersion']).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return undefined;
  if (
    parsed.schemaVersion !== 0
    || typeof parsed.enabled !== 'boolean'
    || !Number.isSafeInteger(parsed.revision)
    || (parsed.revision as number) < 0
    || (parsed.activePetId !== undefined && typeof parsed.activePetId !== 'string')
  ) return undefined;
  return {
    schemaVersion: 0,
    enabled: parsed.enabled,
    revision: parsed.revision as number,
    ...(typeof parsed.activePetId === 'string' ? { activePetId: parsed.activePetId } : {}),
  };
}

async function writeIndex(path: string, snapshot: ReturnType<PetLibrary['getSnapshot']>): Promise<void> {
  const temporaryPath = `${path}.staging-${randomUUID()}`;
  const index: PetLibraryIndex = {
    schemaVersion: 0,
    enabled: snapshot.enabled,
    revision: snapshot.revision,
    ...(snapshot.activePetId === undefined ? {} : { activePetId: snapshot.activePetId }),
  };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
