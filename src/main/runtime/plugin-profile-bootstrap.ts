import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 1024 * 1024;
const GENERATION_PATTERN = /^gen-[a-f0-9]{64}$/u;
const PACKAGE_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;

export interface PluginProfileCandidate {
  readonly packageName: string;
  readonly version: string;
  readonly integrity: string;
  readonly sourceId: string;
  readonly bundlePath: string;
  readonly graphHash: string;
  readonly lockHash: string;
}

export interface PluginProfileVersion extends PluginProfileCandidate {
  readonly generation: string;
  readonly installedAt: string;
  readonly cacheDigests: readonly string[];
  readonly enabled: boolean;
}

export interface PluginProfileReceipt extends PluginProfileVersion {
  readonly rollbackTarget: PluginProfileVersion | null;
}

export interface PluginProfileBlocklistEntry extends PluginProfileCandidate {
  readonly generation: string;
  readonly reason: 'startup-interrupted' | 'runtime-unhealthy';
  readonly blockedAt: string;
}

interface PendingMutationBase {
  readonly generation: string;
  readonly preparedAt: string;
  readonly phase: 'prepared' | 'trial-launched';
  readonly trialStartedAt: string | null;
}

interface PendingInstall extends PendingMutationBase {
  readonly kind: 'install';
  readonly candidate: PluginProfileCandidate;
  readonly cacheDigests: readonly string[];
  readonly receiptsHash?: string;
}

interface PendingRemoval extends PendingMutationBase {
  readonly kind: 'remove';
  readonly receipt: PluginProfileReceipt;
  readonly receiptsHash: string;
}

interface PendingEnabledChange extends PendingMutationBase {
  readonly kind: 'set-enabled';
  readonly receipt: PluginProfileReceipt;
  readonly enabled: boolean;
  readonly receiptsHash: string;
}

interface PendingRollback extends PendingMutationBase {
  readonly kind: 'rollback';
  readonly receipt: PluginProfileReceipt;
  readonly target: PluginProfileVersion;
  readonly receiptsHash: string;
}

type PendingMutation = PendingInstall | PendingRemoval | PendingEnabledChange | PendingRollback;

interface LoadState {
  readonly schemaVersion: 1;
  readonly currentGeneration: string | null;
  readonly pending: PendingMutation | null;
}

interface ReceiptState {
  readonly schemaVersion: 1;
  readonly receipts: readonly PluginProfileReceipt[];
}

interface BlocklistState {
  readonly schemaVersion: 1;
  readonly entries: readonly PluginProfileBlocklistEntry[];
}

interface RecoverySnapshot {
  readonly schemaVersion: 1;
  readonly generation: string;
  readonly loadState: LoadState;
  readonly receipts: ReceiptState;
  readonly blocklist: BlocklistState;
  readonly receiptsHash: string;
  readonly blocklistHash: string;
  readonly createdAt: string;
}

export interface PluginProfileSnapshot {
  readonly currentGeneration: string | null;
  readonly pendingGeneration: string | null;
  readonly receiptCount: number;
  readonly blocklistCount: number;
  readonly mutationReady: true;
}

export interface ManagedPluginProfileInventory {
  readonly currentGeneration: string | null;
  readonly entries: readonly {
    readonly packageName: string;
    readonly sourceId: string;
    readonly version: string;
    readonly generation: string;
    readonly installedAt: string;
    readonly enabled: boolean;
    readonly rollbackTarget: {
      readonly version: string;
      readonly generation: string;
      readonly installedAt: string;
    } | null;
    readonly lastBlockedAttempt: {
      readonly version: string;
      readonly reason: PluginProfileBlocklistEntry['reason'];
      readonly blockedAt: string;
    } | null;
  }[];
}

export interface PluginProfileBootstrap {
  inspect(): Promise<PluginProfileSnapshot>;
  inventory(): Promise<ManagedPluginProfileInventory>;
  prepare(
    generation: string,
    candidate: PluginProfileCandidate,
    cacheDigests?: readonly string[],
    expectedReceipt?: null | {
      readonly packageName: string;
      readonly version: string;
      readonly generation: string;
    },
  ): Promise<void>;
  prepareRemoval(input: {
    readonly packageName: string;
    readonly version: string;
    readonly generation: string;
  }): Promise<{ readonly generation: string }>;
  prepareEnabled(input: {
    readonly packageName: string;
    readonly version: string;
    readonly generation: string;
    readonly enabled: boolean;
  }): Promise<{ readonly generation: string }>;
  prepareRollback(input: {
    readonly packageName: string;
    readonly version: string;
    readonly generation: string;
  }): Promise<{ readonly generation: string }>;
  commit(generation: string): Promise<void>;
  recover(generation: string, reason: PluginProfileBlocklistEntry['reason']): Promise<void>;
  prepareRuntimeLaunch(): Promise<{
    readonly currentGeneration: string | null;
    readonly patchPaths: readonly string[];
    readonly recoveredGeneration: string | null;
    readonly trialGeneration: string | null;
  }>;
}

interface PluginProfileBootstrapOptions {
  readonly now?: () => Date;
}

/**
 * Owns the durable user-plugin profile transaction boundary. This Module is
 * deliberately created and invoked before Harness starts, so recovery cannot
 * depend on the market UI or on any user-installed plugin being loadable.
 */
export function createPluginProfileBootstrap(
  runtimeHome: string,
  options: PluginProfileBootstrapOptions = {},
): PluginProfileBootstrap {
  const root = join(runtimeHome, 'plugin-management');
  const loadStatePath = join(root, 'load-state.json');
  const receiptsPath = join(root, 'receipts.json');
  const blocklistPath = join(root, 'blocklist.json');
  const recoveryRoot = join(root, 'recovery');
  const userPluginGenerations = join(runtimeHome, 'user-plugins', 'generations');
  const now = options.now ?? (() => new Date());

  async function readAll(): Promise<{
    loadState: LoadState;
    receipts: ReceiptState;
    blocklist: BlocklistState;
  }> {
    return {
      loadState: await readState(loadStatePath, emptyLoadState(), parseLoadState),
      receipts: await readState(receiptsPath, emptyReceipts(), parseReceipts),
      blocklist: await readState(blocklistPath, emptyBlocklist(), parseBlocklist),
    };
  }

  async function recover(
    generation: string,
    reason: PluginProfileBlocklistEntry['reason'],
  ): Promise<void> {
    assertGeneration(generation);
    const current = await readAll();
    if (current.loadState.pending?.generation !== generation) {
      throw new Error('Plugin profile recovery generation does not match pending state');
    }
    const recoveryPath = snapshotPath(recoveryRoot, generation);
    const snapshot = await readRequiredState(recoveryPath, parseRecoverySnapshot);
    if (snapshot.generation !== generation) {
      throw new Error('Plugin profile recovery snapshot generation mismatch');
    }
    const expectedReceiptState = receiptStateAfterCommit(
      snapshot.receipts,
      current.loadState.pending,
    );
    const expectedRecoveredBlocklist = blocklistStateAfterRecovery(
      snapshot.blocklist,
      current.loadState.pending,
      reason,
    );
    const expectedPreparedBlocklist = blocklistStateForPreparedTrial(
      snapshot.blocklist,
      current.loadState.pending,
    );
    const receiptsKnown = [snapshot.receiptsHash, digest(expectedReceiptState)].includes(
      digest(current.receipts),
    );
    const blocklistKnown = [
      snapshot.blocklistHash,
      digest(expectedPreparedBlocklist),
      digest(expectedRecoveredBlocklist),
    ].includes(digest(current.blocklist));
    if (!receiptsKnown || !blocklistKnown) {
      throw new Error('Plugin profile state changed after prepare; refusing automatic recovery');
    }

    await atomicWrite(receiptsPath, snapshot.receipts);
    await atomicWrite(blocklistPath, expectedRecoveredBlocklist);
    await atomicWrite(loadStatePath, snapshot.loadState);
    await rm(recoveryPath, { force: true }).catch(() => undefined);
  }

  return {
    async inspect() {
      const state = await readAll();
      return {
        currentGeneration: state.loadState.currentGeneration,
        pendingGeneration: state.loadState.pending?.generation ?? null,
        receiptCount: state.receipts.receipts.length,
        blocklistCount: state.blocklist.entries.length,
        // Execution remains fail-closed until the Harness loader proves the
        // bootstrap is ordered before every user plugin.
        mutationReady: true,
      };
    },

    async inventory() {
      const state = await readAll();
      const blockedByPackage = new Map(
        state.blocklist.entries.map((entry) => [entry.packageName, entry]),
      );
      return {
        currentGeneration: state.loadState.currentGeneration,
        entries: state.receipts.receipts.map((receipt) => {
          const blocked = blockedByPackage.get(receipt.packageName);
          return {
            packageName: receipt.packageName,
            sourceId: receipt.sourceId,
            version: receipt.version,
            generation: receipt.generation,
            installedAt: receipt.installedAt,
            enabled: receipt.enabled,
            rollbackTarget: receipt.rollbackTarget === null
              ? null
              : {
                  version: receipt.rollbackTarget.version,
                  generation: receipt.rollbackTarget.generation,
                  installedAt: receipt.rollbackTarget.installedAt,
                },
            lastBlockedAttempt:
              blocked === undefined
                ? null
                : {
                    version: blocked.version,
                    reason: blocked.reason,
                    blockedAt: blocked.blockedAt,
                  },
          };
        }),
      };
    },

    async prepare(generation, candidate, cacheDigests = [], expectedReceipt) {
      assertGeneration(generation);
      assertCandidate(candidate);
      const normalizedCacheDigests = parseCacheDigests(cacheDigests);
      if (createPluginProfileGeneration(candidate) !== generation) {
        throw new Error('Plugin profile generation does not match its verified candidate');
      }
      const state = await readAll();
      if (state.loadState.pending !== null) {
        throw new Error('A plugin profile generation is already pending');
      }
      if (expectedReceipt !== undefined) {
        const current = state.receipts.receipts.find(
          (receipt) => receipt.packageName === candidate.packageName,
        );
        if (
          expectedReceipt === null
            ? current !== undefined
            : current === undefined ||
              current.packageName !== expectedReceipt.packageName ||
              current.version !== expectedReceipt.version ||
              current.generation !== expectedReceipt.generation
        ) {
          throw new Error('Managed plugin install receipt no longer matches');
        }
      }
      const snapshot: RecoverySnapshot = {
        schemaVersion: SCHEMA_VERSION,
        generation,
        loadState: state.loadState,
        receipts: state.receipts,
        blocklist: state.blocklist,
        receiptsHash: digest(state.receipts),
        blocklistHash: digest(state.blocklist),
        createdAt: now().toISOString(),
      };
      await atomicWrite(snapshotPath(recoveryRoot, generation), snapshot);
      await atomicWrite(loadStatePath, {
        schemaVersion: SCHEMA_VERSION,
        currentGeneration: state.loadState.currentGeneration,
        pending: {
          kind: 'install',
          generation,
          candidate,
          cacheDigests: normalizedCacheDigests,
          receiptsHash: digest(state.receipts),
          preparedAt: now().toISOString(),
          phase: 'prepared',
          trialStartedAt: null,
        },
      } satisfies LoadState);
    },

    async prepareRemoval(input) {
      assertGeneration(input.generation);
      if (
        !PACKAGE_PATTERN.test(input.packageName) ||
        input.version.length === 0 ||
        input.version.length > 512 ||
        hasControlCharacter(input.version)
      ) {
        throw new Error('Invalid managed plugin removal identity');
      }
      const state = await readAll();
      if (state.loadState.pending !== null) {
        throw new Error('A plugin profile generation is already pending');
      }
      const receipt = state.receipts.receipts.find(
        (item) => item.packageName === input.packageName,
      );
      if (
        receipt === undefined ||
        receipt.version !== input.version ||
        receipt.generation !== input.generation
      ) {
        throw new Error('Managed plugin removal receipt no longer matches');
      }
      const generation = createRemovalGeneration(state.receipts, receipt);
      const snapshot: RecoverySnapshot = {
        schemaVersion: SCHEMA_VERSION,
        generation,
        loadState: state.loadState,
        receipts: state.receipts,
        blocklist: state.blocklist,
        receiptsHash: digest(state.receipts),
        blocklistHash: digest(state.blocklist),
        createdAt: now().toISOString(),
      };
      await atomicWrite(snapshotPath(recoveryRoot, generation), snapshot);
      await atomicWrite(loadStatePath, {
        schemaVersion: SCHEMA_VERSION,
        currentGeneration: state.loadState.currentGeneration,
        pending: {
          kind: 'remove',
          generation,
          receipt,
          receiptsHash: digest(state.receipts),
          preparedAt: now().toISOString(),
          phase: 'prepared',
          trialStartedAt: null,
        },
      } satisfies LoadState);
      return { generation };
    },

    async prepareEnabled(input) {
      assertManagedIdentity(input);
      const state = await readAll();
      if (state.loadState.pending !== null) {
        throw new Error('A plugin profile generation is already pending');
      }
      const receipt = exactReceipt(state.receipts, input);
      if (receipt.enabled === input.enabled) {
        throw new Error('Managed plugin enabled state already matches');
      }
      const generation = createEnabledChangeGeneration(state.receipts, receipt, input.enabled);
      const snapshot: RecoverySnapshot = {
        schemaVersion: SCHEMA_VERSION,
        generation,
        loadState: state.loadState,
        receipts: state.receipts,
        blocklist: state.blocklist,
        receiptsHash: digest(state.receipts),
        blocklistHash: digest(state.blocklist),
        createdAt: now().toISOString(),
      };
      await atomicWrite(snapshotPath(recoveryRoot, generation), snapshot);
      await atomicWrite(loadStatePath, {
        schemaVersion: SCHEMA_VERSION,
        currentGeneration: state.loadState.currentGeneration,
        pending: {
          kind: 'set-enabled',
          generation,
          receipt,
          enabled: input.enabled,
          receiptsHash: digest(state.receipts),
          preparedAt: now().toISOString(),
          phase: 'prepared',
          trialStartedAt: null,
        },
      } satisfies LoadState);
      return { generation };
    },

    async prepareRollback(input) {
      assertManagedIdentity(input);
      const state = await readAll();
      if (state.loadState.pending !== null) {
        throw new Error('A plugin profile generation is already pending');
      }
      const receipt = exactReceipt(state.receipts, input);
      if (receipt.rollbackTarget === null) {
        throw new Error('Managed plugin rollback target is unavailable');
      }
      const generation = createRollbackGeneration(state.receipts, receipt);
      const snapshot: RecoverySnapshot = {
        schemaVersion: SCHEMA_VERSION,
        generation,
        loadState: state.loadState,
        receipts: state.receipts,
        blocklist: state.blocklist,
        receiptsHash: digest(state.receipts),
        blocklistHash: digest(state.blocklist),
        createdAt: now().toISOString(),
      };
      await atomicWrite(snapshotPath(recoveryRoot, generation), snapshot);
      await atomicWrite(loadStatePath, {
        schemaVersion: SCHEMA_VERSION,
        currentGeneration: state.loadState.currentGeneration,
        pending: {
          kind: 'rollback',
          generation,
          receipt,
          target: receipt.rollbackTarget,
          receiptsHash: digest(state.receipts),
          preparedAt: now().toISOString(),
          phase: 'prepared',
          trialStartedAt: null,
        },
      } satisfies LoadState);
      return { generation };
    },

    async commit(generation) {
      assertGeneration(generation);
      const state = await readAll();
      if (state.loadState.pending?.generation !== generation) {
        throw new Error('Plugin profile commit generation does not match pending state');
      }
      if (state.loadState.pending.phase !== 'trial-launched') {
        throw new Error('Plugin profile generation was not trial-launched');
      }
      if (
        state.loadState.pending.receiptsHash !== undefined &&
        digest(state.receipts) !== state.loadState.pending.receiptsHash
      ) {
        throw new Error('Managed plugin state changed before commit');
      }
      await atomicWrite(
        receiptsPath,
        receiptStateAfterCommit(state.receipts, state.loadState.pending),
      );
      await atomicWrite(loadStatePath, {
        schemaVersion: SCHEMA_VERSION,
        currentGeneration: generation,
        pending: null,
      } satisfies LoadState);
      await rm(snapshotPath(recoveryRoot, generation), { force: true }).catch(() => undefined);
    },

    recover,

    async prepareRuntimeLaunch() {
      let state = await readAll();
      let recoveredGeneration: string | null = null;
      if (state.loadState.pending?.phase === 'trial-launched') {
        recoveredGeneration = state.loadState.pending.generation;
        await recover(recoveredGeneration, 'startup-interrupted');
        state = await readAll();
      }
      if (state.loadState.pending !== null) {
        const preparedBlocklist = blocklistStateForPreparedTrial(
          state.blocklist,
          state.loadState.pending,
        );
        if (digest(preparedBlocklist) !== digest(state.blocklist)) {
          await atomicWrite(blocklistPath, preparedBlocklist);
          state = { ...state, blocklist: preparedBlocklist };
        }
      }
      const blockedGenerations = new Set(state.blocklist.entries.map((entry) => entry.generation));
      let active: readonly PluginProfileReceipt[] = state.receipts.receipts.filter(
        (receipt) => receipt.enabled && !blockedGenerations.has(receipt.generation),
      );
      const pending = state.loadState.pending;
      let trialGeneration: string | null = null;
      if (pending !== null) {
        if (pending.kind === 'install') {
          if (
            pending.receiptsHash !== undefined &&
            digest(state.receipts) !== pending.receiptsHash
          ) {
            throw new Error('Managed plugin install state changed after confirmation');
          }
          const trialReceipt: PluginProfileReceipt = {
            ...pending.candidate,
            generation: pending.generation,
            installedAt: pending.preparedAt,
            cacheDigests: pending.cacheDigests,
            enabled: true,
            rollbackTarget: null,
          };
          active = [
            ...active.filter((receipt) => receipt.packageName !== trialReceipt.packageName),
            trialReceipt,
          ];
        } else if (pending.kind === 'remove') {
          if (
            digest(state.receipts) !== pending.receiptsHash ||
            !state.receipts.receipts.some((receipt) => sameReceipt(receipt, pending.receipt))
          ) {
            throw new Error('Managed plugin removal state changed after confirmation');
          }
          active = active.filter((receipt) => receipt.packageName !== pending.receipt.packageName);
        } else if (pending.kind === 'set-enabled') {
          if (
            digest(state.receipts) !== pending.receiptsHash ||
            !state.receipts.receipts.some((receipt) => sameReceipt(receipt, pending.receipt))
          ) {
            throw new Error('Managed plugin enabled state changed after confirmation');
          }
          active = pending.enabled
            ? [
                ...active.filter((receipt) => receipt.packageName !== pending.receipt.packageName),
                { ...pending.receipt, enabled: true },
              ]
            : active.filter((receipt) => receipt.packageName !== pending.receipt.packageName);
        } else {
          if (
            digest(state.receipts) !== pending.receiptsHash ||
            !state.receipts.receipts.some((receipt) => sameReceipt(receipt, pending.receipt))
          ) {
            throw new Error('Managed plugin rollback state changed after confirmation');
          }
          active = pending.target.enabled
            ? [
                ...active.filter((receipt) => receipt.packageName !== pending.receipt.packageName),
                { ...pending.target, rollbackTarget: null },
              ]
            : active.filter((receipt) => receipt.packageName !== pending.receipt.packageName);
        }
        trialGeneration = pending.generation;
      }
      const patchPaths = [];
      for (const receipt of [...active].sort((left, right) =>
        left.packageName.localeCompare(right.packageName),
      )) {
        patchPaths.push(await resolveManagedBundlePatch(userPluginGenerations, receipt));
      }
      await reconcileManagedPackages(
        runtimeHome,
        userPluginGenerations,
        state.receipts.receipts,
        active,
      );
      if (pending !== null) {
        await atomicWrite(loadStatePath, {
          ...state.loadState,
          pending: {
            ...pending,
            phase: 'trial-launched',
            trialStartedAt: now().toISOString(),
          },
        } satisfies LoadState);
      }
      return {
        currentGeneration: state.loadState.currentGeneration,
        patchPaths: Object.freeze(patchPaths),
        recoveredGeneration,
        trialGeneration,
      };
    },
  };
}

async function reconcileManagedPackages(
  runtimeHome: string,
  generationsRoot: string,
  previous: readonly PluginProfileReceipt[],
  active: readonly PluginProfileReceipt[],
): Promise<void> {
  const activePackages = new Set(active.map((receipt) => receipt.packageName));
  for (const receipt of previous) {
    if (!activePackages.has(receipt.packageName)) {
      await removeManagedPackageLink(runtimeHome, generationsRoot, receipt.packageName);
    }
  }
  await activateManagedPackages(runtimeHome, generationsRoot, active);
}

async function removeManagedPackageLink(
  runtimeHome: string,
  generationsRoot: string,
  packageName: string,
): Promise<void> {
  const target = join(runtimeHome, 'profiles', 'node_modules', ...packageName.split('/'));
  const existing = await lstat(target).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (existing === undefined) return;
  if (!existing.isSymbolicLink()) {
    throw new Error(`Managed plugin profile target is not a symbolic link: ${packageName}`);
  }
  const [resolvedGenerations, resolvedExisting] = await Promise.all([
    realpath(generationsRoot),
    realpath(target),
  ]);
  assertContained(
    resolvedGenerations,
    resolvedExisting,
    `Managed plugin profile target is not owned by plugin management: ${packageName}`,
  );
  await rm(target);
}

async function activateManagedPackages(
  runtimeHome: string,
  generationsRoot: string,
  receipts: readonly PluginProfileReceipt[],
): Promise<void> {
  if (receipts.length === 0) return;
  const profileModules = join(runtimeHome, 'profiles', 'node_modules');
  const resolvedGenerations = await realpath(generationsRoot);
  for (const receipt of receipts) {
    const source = await realpath(
      join(generationsRoot, receipt.generation, 'node_modules', ...receipt.packageName.split('/')),
    );
    assertContained(
      resolvedGenerations,
      source,
      `Managed plugin package escapes its generation: ${receipt.packageName}`,
    );
    const target = join(profileModules, ...receipt.packageName.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const existing = await lstat(target).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    if (existing !== undefined) {
      if (!existing.isSymbolicLink()) {
        throw new Error(
          `Managed plugin profile target is not a symbolic link: ${receipt.packageName}`,
        );
      }
      const resolvedExisting = await realpath(target);
      if (resolvedExisting === source) continue;
      assertContained(
        resolvedGenerations,
        resolvedExisting,
        `Managed plugin profile target is not owned by plugin management: ${receipt.packageName}`,
      );
    }
    const temporary = `${target}.managed-${randomUUID()}`;
    await symlink(source, temporary, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      if (existing !== undefined) await rm(target);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function assertContained(root: string, candidate: string, message: string): void {
  const containment = relative(root, candidate);
  if (containment === '..' || containment.startsWith(`..${sep}`) || isAbsolute(containment)) {
    throw new Error(message);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createPluginProfileGeneration(input: PluginProfileCandidate): string {
  assertCandidate(input);
  return `gen-${createHash('sha256').update(stableJson(input)).digest('hex')}`;
}

function createRemovalGeneration(state: ReceiptState, receipt: PluginProfileReceipt): string {
  return `gen-${createHash('sha256')
    .update(
      stableJson({
        kind: 'remove',
        packageName: receipt.packageName,
        version: receipt.version,
        generation: receipt.generation,
        receiptsHash: digest(state),
      }),
    )
    .digest('hex')}`;
}

function createEnabledChangeGeneration(
  state: ReceiptState,
  receipt: PluginProfileReceipt,
  enabled: boolean,
): string {
  return `gen-${createHash('sha256')
    .update(
      stableJson({
        kind: 'set-enabled',
        packageName: receipt.packageName,
        version: receipt.version,
        generation: receipt.generation,
        enabled,
        receiptsHash: digest(state),
      }),
    )
    .digest('hex')}`;
}

function createRollbackGeneration(state: ReceiptState, receipt: PluginProfileReceipt): string {
  return `gen-${createHash('sha256')
    .update(
      stableJson({
        kind: 'rollback',
        packageName: receipt.packageName,
        version: receipt.version,
        generation: receipt.generation,
        targetGeneration: receipt.rollbackTarget?.generation,
        receiptsHash: digest(state),
      }),
    )
    .digest('hex')}`;
}

function assertManagedIdentity(input: {
  readonly packageName: string;
  readonly version: string;
  readonly generation: string;
}): void {
  assertGeneration(input.generation);
  if (
    !PACKAGE_PATTERN.test(input.packageName) ||
    input.version.length === 0 ||
    input.version.length > 512 ||
    hasControlCharacter(input.version)
  ) {
    throw new Error('Invalid managed plugin identity');
  }
}

function exactReceipt(
  state: ReceiptState,
  input: {
    readonly packageName: string;
    readonly version: string;
    readonly generation: string;
  },
): PluginProfileReceipt {
  const receipt = state.receipts.find((item) => item.packageName === input.packageName);
  if (
    receipt === undefined ||
    receipt.version !== input.version ||
    receipt.generation !== input.generation
  ) {
    throw new Error('Managed plugin receipt no longer matches');
  }
  return receipt;
}

function emptyLoadState(): LoadState {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentGeneration: null,
    pending: null,
  };
}

function emptyReceipts(): ReceiptState {
  return { schemaVersion: SCHEMA_VERSION, receipts: [] };
}

function emptyBlocklist(): BlocklistState {
  return { schemaVersion: SCHEMA_VERSION, entries: [] };
}

function snapshotPath(root: string, generation: string): string {
  assertGeneration(generation);
  return join(root, `${generation}.json`);
}

async function readState<T>(path: string, fallback: T, parse: (value: unknown) => T): Promise<T> {
  try {
    return await readRequiredState(path, parse);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readRequiredState<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Plugin profile state must be a regular file');
  }
  if (metadata.size > MAX_STATE_BYTES) {
    throw new Error('Plugin profile state exceeds the size limit');
  }
  const source = await readFile(path, 'utf8');
  try {
    return parse(JSON.parse(source) as unknown);
  } catch (error) {
    throw new Error('Invalid plugin profile state', { cause: error });
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, 'wx', 0o600);
    try {
      await file.writeFile(`${stableJson(value, 2)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown, space?: number): string {
  return JSON.stringify(sortValue(value), null, space);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}

function parseLoadState(value: unknown): LoadState {
  const record = objectRecord(value);
  requireSchema(record);
  const currentGeneration = nullableGeneration(record.currentGeneration);
  let pending: LoadState['pending'] = null;
  if (record.pending !== null) {
    const pendingRecord = objectRecord(record.pending);
    const common = {
      generation: requiredGeneration(pendingRecord.generation),
      preparedAt: requiredIsoDate(pendingRecord.preparedAt),
      phase:
        pendingRecord.phase === undefined
          ? ('prepared' as const)
          : requiredPendingPhase(pendingRecord.phase),
      trialStartedAt:
        pendingRecord.trialStartedAt === undefined || pendingRecord.trialStartedAt === null
          ? null
          : requiredIsoDate(pendingRecord.trialStartedAt),
    };
    pending =
      pendingRecord.kind === 'remove'
        ? {
            kind: 'remove',
            ...common,
            receipt: parseReceipt(pendingRecord.receipt),
            receiptsHash: requiredSha256(pendingRecord.receiptsHash),
          }
        : pendingRecord.kind === 'set-enabled'
          ? {
              kind: 'set-enabled',
              ...common,
              receipt: parseReceipt(pendingRecord.receipt),
              enabled: requiredBoolean(pendingRecord.enabled),
              receiptsHash: requiredSha256(pendingRecord.receiptsHash),
            }
          : pendingRecord.kind === 'rollback'
            ? {
                kind: 'rollback',
                ...common,
                receipt: parseReceipt(pendingRecord.receipt),
                target: parseVersion(pendingRecord.target),
                receiptsHash: requiredSha256(pendingRecord.receiptsHash),
              }
          : {
              // Schema-v1 install records written before mutation kinds remain valid.
              kind: 'install',
              ...common,
              candidate: parseCandidate(pendingRecord.candidate),
              cacheDigests: parseCacheDigests(pendingRecord.cacheDigests ?? []),
              ...(pendingRecord.receiptsHash === undefined
                ? {}
                : { receiptsHash: requiredSha256(pendingRecord.receiptsHash) }),
            };
    if (
      (pending.phase === 'prepared' && pending.trialStartedAt !== null) ||
      (pending.phase === 'trial-launched' && pending.trialStartedAt === null)
    )
      throw new Error('Invalid plugin profile trial state');
  }
  return { schemaVersion: SCHEMA_VERSION, currentGeneration, pending };
}

function parseReceipts(value: unknown): ReceiptState {
  const record = objectRecord(value);
  requireSchema(record);
  if (!Array.isArray(record.receipts)) throw new Error('Invalid plugin receipt list');
  return {
    schemaVersion: SCHEMA_VERSION,
    receipts: record.receipts.map(parseReceipt),
  };
}

function parseReceipt(value: unknown): PluginProfileReceipt {
  const receipt = objectRecord(value);
  return {
    ...parseVersion(receipt),
    rollbackTarget:
      receipt.rollbackTarget === undefined || receipt.rollbackTarget === null
        ? null
        : parseVersion(receipt.rollbackTarget),
  };
}

function parseVersion(value: unknown): PluginProfileVersion {
  const version = objectRecord(value);
  return {
    ...parseCandidate(version),
    generation: requiredGeneration(version.generation),
    installedAt: requiredIsoDate(version.installedAt),
    cacheDigests: parseCacheDigests(version.cacheDigests ?? []),
    // Receipts created before managed enable/disable shipped are enabled.
    enabled: version.enabled === undefined ? true : requiredBoolean(version.enabled),
  };
}

function parseBlocklist(value: unknown): BlocklistState {
  const record = objectRecord(value);
  requireSchema(record);
  if (!Array.isArray(record.entries)) throw new Error('Invalid plugin blocklist');
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: record.entries.map((item) => {
      const entry = objectRecord(item);
      if (entry.reason !== 'startup-interrupted' && entry.reason !== 'runtime-unhealthy') {
        throw new Error('Invalid plugin blocklist reason');
      }
      return {
        ...parseCandidate(entry),
        generation: requiredGeneration(entry.generation),
        reason: entry.reason,
        blockedAt: requiredIsoDate(entry.blockedAt),
      };
    }),
  };
}

function parseRecoverySnapshot(value: unknown): RecoverySnapshot {
  const record = objectRecord(value);
  requireSchema(record);
  const receiptsHash = requiredString(record.receiptsHash);
  const blocklistHash = requiredString(record.blocklistHash);
  if (!receiptsHash.startsWith('sha256:') || !blocklistHash.startsWith('sha256:')) {
    throw new Error('Invalid plugin recovery digest');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generation: requiredGeneration(record.generation),
    loadState: parseLoadState(record.loadState),
    receipts: parseReceipts(record.receipts),
    blocklist: parseBlocklist(record.blocklist),
    receiptsHash,
    blocklistHash,
    createdAt: requiredIsoDate(record.createdAt),
  };
}

function parseCandidate(value: unknown): PluginProfileCandidate {
  const record = objectRecord(value);
  const candidate = {
    packageName: requiredString(record.packageName),
    version: requiredString(record.version),
    integrity: requiredString(record.integrity),
    sourceId: requiredString(record.sourceId),
    bundlePath: requiredString(record.bundlePath),
    graphHash: requiredString(record.graphHash),
    lockHash: requiredString(record.lockHash),
  };
  assertCandidate(candidate);
  return candidate;
}

function assertCandidate(candidate: PluginProfileCandidate): void {
  if (!PACKAGE_PATTERN.test(candidate.packageName)) throw new Error('Invalid plugin package name');
  for (const value of [candidate.version, candidate.integrity, candidate.sourceId]) {
    if (value.length === 0 || value.length > 512 || hasControlCharacter(value)) {
      throw new Error('Invalid plugin profile candidate');
    }
  }
  if (!validRelativeBundlePath(candidate.bundlePath)) {
    throw new Error('Invalid plugin bundle path');
  }
  if (!validSha256(candidate.graphHash) || !validSha256(candidate.lockHash)) {
    throw new Error('Invalid plugin graph or lock hash');
  }
}

function validSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function validRelativeBundlePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 240 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    hasControlCharacter(value)
  )
    return false;
  const parts = value.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

async function resolveManagedBundlePatch(
  generationsRoot: string,
  receipt: PluginProfileReceipt,
): Promise<string> {
  const modulesRoot = join(generationsRoot, receipt.generation, 'node_modules');
  const packageParts = receipt.packageName.split('/');
  const candidate = join(modulesRoot, ...packageParts, ...receipt.bundlePath.split('/'));
  let resolvedRoot: string;
  let resolvedCandidate: string;
  try {
    [resolvedRoot, resolvedCandidate] = await Promise.all([
      realpath(modulesRoot),
      realpath(candidate),
    ]);
  } catch (error) {
    throw new Error(`Managed plugin bundle is unavailable: ${receipt.packageName}`, {
      cause: error,
    });
  }
  const containment = relative(resolvedRoot, resolvedCandidate);
  if (containment === '..' || containment.startsWith(`..${sep}`) || isAbsolute(containment)) {
    throw new Error(`Managed plugin bundle escapes its profile: ${receipt.packageName}`);
  }
  const metadata = await lstat(resolvedCandidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Managed plugin bundle is not a regular file: ${receipt.packageName}`);
  }
  return resolvedCandidate;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function upsertBlocklistEntry(
  entries: readonly PluginProfileBlocklistEntry[],
  entry: PluginProfileBlocklistEntry,
): readonly PluginProfileBlocklistEntry[] {
  return [...entries.filter((item) => item.packageName !== entry.packageName), entry].sort(
    (left, right) => left.packageName.localeCompare(right.packageName),
  );
}

function blocklistStateForPreparedTrial(
  state: BlocklistState,
  pending: NonNullable<LoadState['pending']>,
): BlocklistState {
  const packageName =
    pending.kind === 'install'
      ? pending.candidate.packageName
      : pending.kind === 'set-enabled' && pending.enabled
        ? pending.receipt.packageName
        : pending.kind === 'rollback'
          ? pending.target.packageName
        : undefined;
  if (packageName === undefined) return state;
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: state.entries.filter((entry) => entry.packageName !== packageName),
  };
}

function receiptStateAfterCommit(
  state: ReceiptState,
  pending: NonNullable<LoadState['pending']>,
): ReceiptState {
  if (pending.kind === 'remove') {
    return {
      schemaVersion: SCHEMA_VERSION,
      receipts: state.receipts.filter((item) => item.packageName !== pending.receipt.packageName),
    };
  }
  if (pending.kind === 'set-enabled') {
    return {
      schemaVersion: SCHEMA_VERSION,
      receipts: state.receipts.map((item) =>
        sameReceipt(item, pending.receipt) ? { ...item, enabled: pending.enabled } : item,
      ),
    };
  }
  if (pending.kind === 'rollback') {
    return {
      schemaVersion: SCHEMA_VERSION,
      receipts: state.receipts.map((item) =>
        sameReceipt(item, pending.receipt)
          ? { ...pending.target, rollbackTarget: null }
          : item,
      ),
    };
  }
  const previous = state.receipts.find(
    (item) => item.packageName === pending.candidate.packageName,
  );
  const receipt: PluginProfileReceipt = {
    ...pending.candidate,
    generation: pending.generation,
    installedAt: pending.preparedAt,
    cacheDigests: pending.cacheDigests,
    enabled: true,
    rollbackTarget:
      previous === undefined
        ? null
        : previous.version === pending.candidate.version
          ? previous.rollbackTarget
          : versionFromReceipt(previous),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    receipts: [
      ...state.receipts.filter((item) => item.packageName !== receipt.packageName),
      receipt,
    ].sort((left, right) => left.packageName.localeCompare(right.packageName)),
  };
}

function blocklistStateAfterRecovery(
  state: BlocklistState,
  pending: NonNullable<LoadState['pending']>,
  reason: PluginProfileBlocklistEntry['reason'],
): BlocklistState {
  if (pending.kind !== 'install' && pending.kind !== 'rollback') return state;
  const candidate = pending.kind === 'install' ? pending.candidate : pending.target;
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: upsertBlocklistEntry(state.entries, {
      ...candidate,
      generation: pending.kind === 'install' ? pending.generation : pending.target.generation,
      reason,
      // A retry must derive the same state if the first recovery was
      // interrupted after publishing blocklist.json.
      blockedAt: pending.preparedAt,
    }),
  };
}

function versionFromReceipt(receipt: PluginProfileReceipt): PluginProfileVersion {
  return {
    packageName: receipt.packageName,
    version: receipt.version,
    integrity: receipt.integrity,
    sourceId: receipt.sourceId,
    bundlePath: receipt.bundlePath,
    graphHash: receipt.graphHash,
    lockHash: receipt.lockHash,
    generation: receipt.generation,
    installedAt: receipt.installedAt,
    cacheDigests: receipt.cacheDigests,
    enabled: receipt.enabled,
  };
}

function sameReceipt(left: PluginProfileReceipt, right: PluginProfileReceipt): boolean {
  return (
    left.packageName === right.packageName &&
    left.version === right.version &&
    left.integrity === right.integrity &&
    left.sourceId === right.sourceId &&
    left.bundlePath === right.bundlePath &&
    left.graphHash === right.graphHash &&
    left.lockHash === right.lockHash &&
    left.generation === right.generation &&
    left.installedAt === right.installedAt &&
    left.enabled === right.enabled &&
    left.cacheDigests.length === right.cacheDigests.length &&
    left.cacheDigests.every((digestValue, index) => digestValue === right.cacheDigests[index])
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}

function requireSchema(record: Record<string, unknown>): void {
  if (record.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported plugin profile schema');
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean');
  return value;
}

function requiredGeneration(value: unknown): string {
  const generation = requiredString(value);
  assertGeneration(generation);
  return generation;
}

function requiredSha256(value: unknown): string {
  const hash = requiredString(value);
  if (!validSha256(hash)) throw new Error('Invalid plugin profile state hash');
  return hash;
}

function nullableGeneration(value: unknown): string | null {
  return value === null ? null : requiredGeneration(value);
}

function assertGeneration(generation: string): void {
  if (!GENERATION_PATTERN.test(generation)) throw new Error('Invalid plugin profile generation');
}

function requiredIsoDate(value: unknown): string {
  const date = requiredString(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date)) {
    throw new Error('Invalid plugin profile timestamp');
  }
  return date;
}

function requiredPendingPhase(value: unknown): 'prepared' | 'trial-launched' {
  if (value !== 'prepared' && value !== 'trial-launched') {
    throw new Error('Invalid plugin profile pending phase');
  }
  return value;
}

function parseCacheDigests(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some((digest) => typeof digest !== 'string' || !/^sha512:[a-f0-9]{128}$/u.test(digest))
  ) {
    throw new Error('Invalid plugin profile cache references');
  }
  const normalized = [...new Set(value as string[])].sort();
  if (normalized.length !== value.length)
    throw new Error('Duplicate plugin profile cache reference');
  return Object.freeze(normalized);
}
