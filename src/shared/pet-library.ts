export interface PetAssetSummary {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly origin: 'built-in' | 'imported';
  readonly status: 'ready' | 'incompatible' | 'damaged';
  readonly thumbnailUrl: string;
  readonly thumbnailRevision: string;
  readonly license: string;
  readonly source: string;
}

export const PET_LIBRARY_REQUEST_CHANNEL = 'dsh-desktop:pet-library:request';
export const PET_LIBRARY_STATE_CHANNEL = 'dsh-desktop:pet-library:state';

export interface PetLibrarySnapshot {
  readonly enabled: boolean;
  readonly canImport: boolean;
  readonly activePetId?: string;
  readonly assets: readonly PetAssetSummary[];
  readonly inbox: readonly PetImportInboxItem[];
  readonly revision: number;
}

export interface PetImportInboxItem {
  readonly id: string;
  readonly packageId: string;
  readonly name: Readonly<{ 'zh-CN': string; en: string }>;
  readonly author: string;
  readonly status: 'awaiting-runtime-validation' | 'runtime-compatible' | 'runtime-rejected';
  readonly archiveHash: string;
  readonly packageContentHash: string;
}

export type PetLibraryCommand =
  | { readonly kind: 'import'; readonly expectedRevision: number }
  | { readonly kind: 'select'; readonly petId: string; readonly expectedRevision: number }
  | { readonly kind: 'remove'; readonly petId: string; readonly expectedRevision: number }
  | { readonly kind: 'set-enabled'; readonly enabled: boolean; readonly expectedRevision: number };

export type PetLibraryRejectionCode =
  | 'revision-conflict'
  | 'asset-not-found'
  | 'asset-not-ready'
  | 'built-in-immutable'
  | 'package-invalid'
  | 'package-too-large'
  | 'package-unsafe'
  | 'inbox-disabled'
  | 'window-not-foreground'
  | 'invalid-command';

export type PetLibraryResult =
  | { readonly status: 'accepted'; readonly snapshot: PetLibrarySnapshot }
  | { readonly status: 'cancelled' }
  | { readonly status: 'rejected'; readonly code: PetLibraryRejectionCode };

export interface PetLibrary {
  getSnapshot(): PetLibrarySnapshot;
  subscribe(listener: (snapshot: PetLibrarySnapshot) => void): () => void;
  request(command: PetLibraryCommand): Promise<PetLibraryResult>;
}

export type PetLibraryImportOutcome =
  | { readonly status: 'accepted'; readonly item: PetImportInboxItem }
  | { readonly status: 'cancelled' }
  | { readonly status: 'rejected'; readonly code: PetLibraryRejectionCode };

export function parsePetLibraryCommand(value: unknown): PetLibraryCommand | undefined {
  if (!isRecord(value) || !isRevision(value.expectedRevision) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'import' && hasExactKeys(value, ['kind', 'expectedRevision'])) {
    return { kind: 'import', expectedRevision: value.expectedRevision };
  }
  if (
    (value.kind === 'select' || value.kind === 'remove')
    && hasExactKeys(value, ['kind', 'petId', 'expectedRevision'])
    && isOpaquePetId(value.petId)
  ) {
    return { kind: value.kind, petId: value.petId, expectedRevision: value.expectedRevision };
  }
  if (
    value.kind === 'set-enabled'
    && hasExactKeys(value, ['kind', 'enabled', 'expectedRevision'])
    && typeof value.enabled === 'boolean'
  ) {
    return { kind: 'set-enabled', enabled: value.enabled, expectedRevision: value.expectedRevision };
  }
  return undefined;
}

export function validatedPetLibrarySnapshot(value: unknown): PetLibrarySnapshot | undefined {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.canImport !== 'boolean' || !isRevision(value.revision)) return undefined;
  const expectedKeys = value.activePetId === undefined
    ? ['enabled', 'canImport', 'assets', 'inbox', 'revision']
    : ['enabled', 'canImport', 'activePetId', 'assets', 'inbox', 'revision'];
  if (!hasExactKeys(value, expectedKeys) || !Array.isArray(value.assets) || !Array.isArray(value.inbox)) return undefined;
  if (value.activePetId !== undefined && !isOpaquePetId(value.activePetId)) return undefined;
  const assets = value.assets.map(parsePetAssetSummary);
  const inbox = value.inbox.map(parsePetInboxItem);
  if (assets.some((asset) => asset === undefined) || inbox.some((item) => item === undefined)) return undefined;
  return freezeSnapshot({
    enabled: value.enabled,
    canImport: value.canImport,
    revision: value.revision,
    assets: assets as PetAssetSummary[],
    inbox: inbox as PetImportInboxItem[],
    ...(typeof value.activePetId === 'string' ? { activePetId: value.activePetId } : {}),
  });
}

export function createPetLibraryFake(input: {
  readonly assets: readonly PetAssetSummary[];
  readonly activePetId?: string;
  readonly enabled?: boolean;
  readonly revision?: number;
  readonly inbox?: readonly PetImportInboxItem[];
  readonly importPet?: () => Promise<PetLibraryImportOutcome>;
  readonly canImport?: boolean;
}): PetLibrary {
  const listeners = new Set<(snapshot: PetLibrarySnapshot) => void>();
  const initialActivePetId = input.activePetId ?? input.assets.find((asset) => asset.status === 'ready')?.id;
  let snapshot = freezeSnapshot({
    enabled: input.enabled ?? true,
    canImport: input.canImport ?? input.importPet !== undefined,
    ...(initialActivePetId === undefined ? {} : { activePetId: initialActivePetId }),
    assets: input.assets,
    inbox: input.inbox ?? [],
    revision: input.revision ?? 0,
  });

  const publish = (next: Omit<PetLibrarySnapshot, 'revision'>): PetLibraryResult => {
    snapshot = freezeSnapshot({ ...next, revision: snapshot.revision + 1 });
    for (const listener of listeners) listener(snapshot);
    return { status: 'accepted', snapshot };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(command) {
      const parsed = parsePetLibraryCommand(command);
      if (parsed === undefined) return { status: 'rejected', code: 'invalid-command' };
      if (parsed.expectedRevision !== snapshot.revision) return { status: 'rejected', code: 'revision-conflict' };
      if (parsed.kind === 'import') {
        const outcome = await input.importPet?.() ?? { status: 'cancelled' };
        if (parsed.expectedRevision !== snapshot.revision) {
          return { status: 'rejected', code: 'revision-conflict' };
        }
        if (outcome.status !== 'accepted') return outcome;
        if (snapshot.inbox.some((item) => item.id === outcome.item.id)) {
          return { status: 'accepted', snapshot };
        }
        return publish({ ...snapshot, inbox: [...snapshot.inbox, outcome.item] });
      }
      if (parsed.kind === 'set-enabled') {
        return publish({ ...snapshot, enabled: parsed.enabled });
      }
      const asset = snapshot.assets.find((candidate) => candidate.id === parsed.petId);
      if (asset === undefined) return { status: 'rejected', code: 'asset-not-found' };
      if (parsed.kind === 'select') {
        if (asset.status !== 'ready') return { status: 'rejected', code: 'asset-not-ready' };
        return publish({ ...snapshot, activePetId: asset.id });
      }
      if (asset.origin === 'built-in') return { status: 'rejected', code: 'built-in-immutable' };
      const assets = snapshot.assets.filter((candidate) => candidate.id !== asset.id);
      const fallbackId = snapshot.activePetId === asset.id
        ? assets.find((candidate) => candidate.origin === 'built-in' && candidate.status === 'ready')?.id
        : snapshot.activePetId;
      return publish({
        enabled: snapshot.enabled,
        canImport: snapshot.canImport,
        assets,
        inbox: snapshot.inbox,
        ...(fallbackId === undefined ? {} : { activePetId: fallbackId }),
      });
    },
  };
}

function freezeSnapshot(value: PetLibrarySnapshot): PetLibrarySnapshot {
  const assets = Object.freeze(value.assets.map((asset) => Object.freeze({ ...asset })));
  const inbox = Object.freeze(value.inbox.map((item) => Object.freeze({ ...item, name: Object.freeze({ ...item.name }) })));
  return Object.freeze({ ...value, assets, inbox });
}

function isOpaquePetId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function parsePetAssetSummary(value: unknown): PetAssetSummary | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'name', 'author', 'origin', 'status', 'thumbnailUrl',
    'thumbnailRevision', 'license', 'source',
  ])) return undefined;
  if (
    !isOpaquePetId(value.id)
    || typeof value.name !== 'string'
    || typeof value.author !== 'string'
    || (value.origin !== 'built-in' && value.origin !== 'imported')
    || (value.status !== 'ready' && value.status !== 'incompatible' && value.status !== 'damaged')
    || typeof value.thumbnailUrl !== 'string'
    || !value.thumbnailUrl.startsWith('dsh-pet://thumbnail/')
    || typeof value.thumbnailRevision !== 'string'
    || typeof value.license !== 'string'
    || typeof value.source !== 'string'
  ) return undefined;
  return {
    id: value.id,
    name: value.name,
    author: value.author,
    origin: value.origin,
    status: value.status,
    thumbnailUrl: value.thumbnailUrl,
    thumbnailRevision: value.thumbnailRevision,
    license: value.license,
    source: value.source,
  };
}

function parsePetInboxItem(value: unknown): PetImportInboxItem | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'packageId', 'name', 'author', 'status', 'archiveHash', 'packageContentHash',
  ])) return undefined;
  if (
    !isOpaquePetId(value.id)
    || typeof value.packageId !== 'string'
    || !isRecord(value.name)
    || !hasExactKeys(value.name, ['zh-CN', 'en'])
    || typeof value.name['zh-CN'] !== 'string'
    || typeof value.name.en !== 'string'
    || typeof value.author !== 'string'
    || (value.status !== 'awaiting-runtime-validation'
      && value.status !== 'runtime-compatible'
      && value.status !== 'runtime-rejected')
    || typeof value.archiveHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.archiveHash)
    || value.id !== value.archiveHash
    || typeof value.packageContentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.packageContentHash)
  ) return undefined;
  return {
    id: value.id,
    packageId: value.packageId,
    name: { 'zh-CN': value.name['zh-CN'], en: value.name.en },
    author: value.author,
    status: value.status,
    archiveHash: value.archiveHash,
    packageContentHash: value.packageContentHash,
  };
}
