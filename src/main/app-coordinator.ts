import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { release } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRendererLocation } from './app-config.js';
import { createAppLog, redact, type AppLog } from './diagnostics/app-log.js';
import { createDiagnosticArchive } from './diagnostics/diagnostic-archive.js';
import { recoverInvalidPreferences } from './preferences/preferences-recovery.js';
import {
  createDesktopFeaturePreferencesPersistence,
  type DesktopFeaturePreferencesPersistence,
} from './preferences/desktop-feature-preferences.js';
import {
  createRuntimeSupervisor,
  type RuntimeFailure,
  type RuntimeSupervisor,
} from './runtime/runtime-supervisor.js';
import { runtimeStartupTimeoutMs } from './runtime/runtime-startup-policy.js';
import { createRuntimeRecoveryPolicy } from './runtime/runtime-recovery-policy.js';
import { createHarnessRuntimeCommand } from './runtime/runtime-command.js';
import {
  type DistributionRegion,
  desktopUpdateSources,
  distributionRegion,
  releaseDownloadPageUrl,
} from './distribution/distribution-routing.js';
import { createRuntimeCompanionClient } from './runtime/runtime-companion-client.js';
import { ensureRuntimeHomeUpgradeBackup } from './runtime/runtime-home-upgrade.js';
import {
  createPluginProfileBootstrap,
  type PluginProfileBootstrap,
} from './runtime/plugin-profile-bootstrap.js';
import { createManagedInstallTransaction } from './runtime/managed-install-transaction.js';
import {
  createManagedInstallConfirmation,
  type ManagedInstallConfirmation,
} from './runtime/managed-install-confirmation.js';
import { createRuntimeMarketClient } from './runtime/runtime-market-client.js';
import { developmentPluginFixtureEnabled } from './runtime/development-plugin-fixture-policy.js';
import { pluginProfileRestartKind } from './runtime/plugin-profile-restart-policy.js';
import {
  createManagedPluginRemoval,
  type ManagedPluginRemoval,
} from './runtime/managed-plugin-removal.js';
import {
  createManagedPluginActivation,
  type ManagedPluginActivation,
} from './runtime/managed-plugin-activation.js';
import {
  createManagedPluginRollback,
  type ManagedPluginRollback,
} from './runtime/managed-plugin-rollback.js';
import { createRuntimeStderrScrubber } from './runtime/runtime-stderr-scrubber.js';
import {
  createExternalPluginControl,
  type ExternalPluginControl,
} from './runtime/external-plugin-control.js';
import {
  resolveStableRuntimePort,
  StableRuntimePortOccupiedError,
} from './runtime/runtime-port.js';
import {
  finalizeApplicationExit,
  relaunchAfterStartupFailure,
  startupPreparationFailureLogDetails,
} from './startup-recovery.js';
import {
  createWorkspaceInspector,
  type WorkspaceInspector,
} from './workspace/workspace-inspector.js';
import { ensureBundledRuntimeExtensions } from './runtime/runtime-extension.js';
import { createAppUpdater, type AppUpdater } from './update/app-updater.js';
import { isUpdaterSupported } from './update/update-config.js';
import { createDesktopWindow, type DesktopWindow } from './window/desktop-window.js';
import { resolveDesktopCarrierMode } from './window/desktop-carrier-mode.js';
import {
  createWindowStatePersistence,
  type WindowStatePersistence,
} from './window/window-state.js';
import type { UpdateCommand } from '../shared/update-bridge.js';
import type { AccountBalanceSnapshot } from '../shared/account-balance.js';
import type { HarnessContextSnapshot } from '../shared/desktop-companion.js';
import type {
  WorkspaceReviewRequest,
  WorkspaceReviewResponse,
} from '../shared/workspace-review.js';
import {
  type ManagedPluginExecuteRequest,
  type ManagedPluginExecuteResult,
  type ManagedPluginInstallOperation,
  type ManagedPluginPreviewRequest,
  type ManagedPluginPreviewResult,
  type ManagedPluginPreviewSummary,
  validatedManagedPluginPreviewSummary,
} from '../shared/managed-plugin-preview.js';
import type {
  ManagedPluginInventoryRequest,
  ManagedPluginInventoryResult,
  ManagedPluginRemoveRequest,
  ManagedPluginRemoveResult,
  ManagedPluginSetEnabledRequest,
  ManagedPluginSetEnabledResult,
  ManagedPluginRollbackRequest,
  ManagedPluginRollbackResult,
  ExternalPluginControlRequest,
  ExternalPluginControlResult,
} from '../shared/managed-plugin-inventory.js';
import {
  WINDOW_MENU_CHANNEL,
  validatedWindowMenuRequest,
} from '../shared/window-menu.js';
import { type DesktopLocale, validatedDesktopLocale } from '../shared/locale-sync.js';
import {
  createWorkspaceChangeMonitor,
  type WorkspaceChangeMonitor,
} from './workspace/workspace-change-monitor.js';
import {
  runtimeAuthorityIdentityMatches,
  reusableWorkspaceAuthority,
  shouldRetryWorkspaceAuthority,
  workspaceRetryDelay,
  type ActiveWorkspaceAuthority,
} from './workspace/workspace-authority-recovery.js';
import { createApplicationMenuTemplate } from './application-menu-template.js';
import {
  DEFAULT_DESKTOP_FEATURE_PREFERENCES,
  type DesktopFeaturePreferences,
} from '../shared/desktop-feature-preferences.js';
import { acquireSingleInstanceLock } from './single-instance-lock.js';

const moduleDirectory = __dirname;
export class AppCoordinator {
  #window: DesktopWindow | undefined;
  #windowState: WindowStatePersistence | undefined;
  #featurePreferences: DesktopFeaturePreferencesPersistence | undefined;
  #desktopFeaturePreferences: DesktopFeaturePreferences =
    DEFAULT_DESKTOP_FEATURE_PREFERENCES;
  #runtime: RuntimeSupervisor | undefined;
  #log: AppLog | undefined;
  #updater: AppUpdater | undefined;
  #quitting = false;
  readonly #recovery = createRuntimeRecoveryPolicy([250, 1_000]);
  #recovering = false;
  #lastFailure: RuntimeFailure | undefined;
  #companionToken = '';
  readonly #runtimeStderr = createRuntimeStderrScrubber({
    onLine: (line) => this.#log?.write('runtime.stderr', line),
  });
  #workspaceAuthorityRevision = 0;
  #latestHarnessContext: HarnessContextSnapshot | undefined;
  #activeWorkspaceAuthority: ActiveWorkspaceAuthority | undefined;
  #workspaceAuthorityRetryTimer: ReturnType<typeof setTimeout> | undefined;
  #workspaceInspector: WorkspaceInspector | undefined;
  #workspaceChangeMonitor: WorkspaceChangeMonitor | undefined;
  #pluginProfileBootstrap: PluginProfileBootstrap | undefined;
  #pluginTrialGeneration: string | undefined;
  #pluginTrialRecoveryActive = false;
  #managedInstallConfirmation: ManagedInstallConfirmation | undefined;
  #managedPluginRemoval: ManagedPluginRemoval | undefined;
  #managedPluginActivation: ManagedPluginActivation | undefined;
  #managedPluginRollback: ManagedPluginRollback | undefined;
  #externalPluginControl: ExternalPluginControl | undefined;
  #pluginRestartScheduled = false;
  #runtimeRoot = '';
  #carrierMode: ReturnType<typeof resolveDesktopCarrierMode> = 'legacy';
  #distributionRegion: DistributionRegion = 'global';

  async run(): Promise<void> {
    if (!await acquireSingleInstanceLock({
      request: () => app.requestSingleInstanceLock(),
      maxAttempts: process.platform === 'darwin' && app.isPackaged ? 9 : 1,
    })) {
      app.quit();
      return;
    }

    app.on('second-instance', () => this.#window?.reveal());
    app.on('activate', () => this.#window?.reveal());
    app.on('before-quit', (event) => {
      if (!this.#quitting) {
        // Capture before Runtime shutdown: macOS may alter zoom/bounds while
        // the asynchronous quit sequence is in progress.
        this.#window?.captureWindowState();
        event.preventDefault();
        void this.quit();
      }
    });

    await app.whenReady();
    const carrierMode = resolveDesktopCarrierMode(
      process.env.DSH_DESKTOP_CARRIER_MODE,
      process.env.DSH_DESKTOP_INTEGRATED_PROTOTYPE,
    );
    this.#carrierMode = carrierMode;
    this.#distributionRegion = distributionRegion({
      countryCode: app.getLocaleCountryCode(),
      ...(process.env.DSH_DESKTOP_DISTRIBUTION_REGION === undefined
        ? {}
        : { override: process.env.DSH_DESKTOP_DISTRIBUTION_REGION }),
    });
    const userData = app.getPath('userData');
    const runtimeHome = join(userData, 'runtime');
    const runtimeRoot = app.isPackaged
      ? join(process.resourcesPath, 'runtime')
      : join(app.getAppPath(), 'resources', 'runtime');
    this.#runtimeRoot = runtimeRoot;
    this.#externalPluginControl = createExternalPluginControl({ runtimeHome, runtimeRoot });
    const logDirectory = join(userData, 'logs');
    await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
    this.#log = await createAppLog(logDirectory);
    this.#log.write('desktop.carrier-selected', `mode=${carrierMode}`);
    this.#windowState = await createWindowStatePersistence(
      join(userData, 'window-state.json'),
      screen.getAllDisplays().map((display) => display.workArea),
      (error) => this.#log?.write(
        'desktop.window-state-error',
        error instanceof Error ? error.message : String(error),
      ),
    );
    this.#featurePreferences = await createDesktopFeaturePreferencesPersistence(
      join(userData, 'desktop-features.json'),
      (error) => this.#log?.write(
        'desktop.feature-preferences-error',
        error instanceof Error ? error.message : String(error),
      ),
    );
    this.#desktopFeaturePreferences = this.#featurePreferences.initialState;
    this.#updater = createAppUpdater({
      enabled:
        process.env.DSH_DESKTOP_E2E !== '1' &&
        isUpdaterSupported({
          isPackaged: app.isPackaged,
          platform: process.platform,
          architecture: process.arch,
        }),
      currentVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      updateSources: desktopUpdateSources({
        region: this.#distributionRegion,
        platform: process.platform,
        architecture: process.arch,
      }),
      onError: (error) => this.#handleUpdaterError(error),
    });

    const loadingLocation = rendererLocation();
    this.#window = createDesktopWindow({
      carrierMode,
      loadingUrl: loadingLocation,
      shellPreloadPath: join(moduleDirectory, 'shell-preload-entry.cjs'),
      harnessPreloadPath: join(moduleDirectory, 'harness-preload-entry.cjs'),
      initialWindowState: this.#windowState.initialState,
      initialFeaturePreferences: this.#desktopFeaturePreferences,
      onWindowStateChange: (state) => this.#windowState?.update(state),
      onRetry: () => void this.#retryStartup(),
      onOpenLogs: () => void shell.openPath(logDirectory),
      onCopyDiagnostics: () => this.#copyDiagnostics(),
      onExportDiagnostics: () => void this.#exportDiagnostics(logDirectory),
      onUpdateCommand: (command) => void this.#handleUpdateCommand(command),
      onAccountBalanceRequest: (force) => this.#readAccountBalance(force),
      onFeaturePreferencesChange: (preferences) =>
        this.#setDesktopFeaturePreferences(preferences),
      onHarnessContext: (snapshot) => void this.#handleHarnessContext(snapshot),
      onLocale: (locale) => this.#installMenu(logDirectory, locale),
      onWorkspaceReviewRequest: (request) => this.#handleWorkspaceReviewRequest(request),
      onHarnessReviewIntent: (intent) =>
        this.#workspaceInspector?.previewChangedPath(intent.path, intent.historicalDiff) ??
        Promise.resolve({ kind: 'unavailable', reason: 'no-workspace' }),
      onRendererCrash: (target, reason) =>
        this.#log?.write('renderer.crashed', `target=${target} reason=${reason}`),
      onManagedPluginPreview: (request) => this.#previewManagedPlugin(request),
      onManagedPluginExecute: (request) => this.#executeManagedPlugin(request),
      onManagedPluginInventory: (request) => this.#readManagedPluginInventory(request),
      onManagedPluginRemove: (request) => this.#removeManagedPlugin(request),
      onManagedPluginSetEnabled: (request) => this.#setManagedPluginEnabled(request),
      onManagedPluginRollback: (request) => this.#rollbackManagedPlugin(request),
      onExternalPluginControl: (request) => this.#controlExternalPlugin(request),
    });
    await this.#window.showLoading();

    let recoveredPreferences: string | undefined;
    let managedPluginPatches: readonly string[];
    let runtimePort: Awaited<ReturnType<typeof resolveStableRuntimePort>>;
    try {
      // Resolve endpoint ownership before copying or opening Runtime Home. An
      // orphaned rc.7 process may still be writing the incompatible storage.
      runtimePort = await resolveStableRuntimePort(userData);
      const upgradeBackup = await ensureRuntimeHomeUpgradeBackup(runtimeHome);
      if (upgradeBackup.status === 'created') {
        this.#log.write(
          'runtime.upgrade-backup-created',
          `backup=${basename(upgradeBackup.backupPath)}`,
        );
      }
      recoveredPreferences = await this.#recoverPreferences(runtimeHome);
      this.#pluginProfileBootstrap = createPluginProfileBootstrap(runtimeHome);
      const launchPlan = await this.#pluginProfileBootstrap.prepareRuntimeLaunch();
      if (launchPlan.recoveredGeneration !== null) {
        this.#log.write('plugin-profile.recovered', `generation=${launchPlan.recoveredGeneration}`);
      }
      this.#pluginTrialGeneration = launchPlan.trialGeneration ?? undefined;
      managedPluginPatches = launchPlan.patchPaths;
      this.#log.write(
        'plugin-profile.launch-plan',
        `generation=${launchPlan.currentGeneration ?? 'none'} trial=${launchPlan.trialGeneration ?? 'none'} patches=${String(managedPluginPatches.length)}`,
      );
      this.#log.write(
        'runtime.endpoint-selected',
        `port=${String(runtimePort.port)} source=${runtimePort.source}`,
      );
    } catch (error) {
      const failureDetails = startupPreparationFailureLogDetails(error);
      const failure: RuntimeFailure = {
        code:
          error instanceof StableRuntimePortOccupiedError
            ? 'runtime-endpoint-occupied'
            : 'upgrade-preparation-failed',
        message: `Runtime preparation failed (${failureDetails})`,
      };
      this.#lastFailure = failure;
      this.#log.write('runtime.upgrade-preparation-failed', failureDetails);
      await this.#window.showFailure(failure);
      return;
    }

    // Do not enqueue or rotate this process's log until the previous ready
    // origin has been read. That log is the one-time migration source for
    // releases that predate runtime-endpoint.json.
    this.#updater.subscribe((state) => {
      this.#log?.write('update.state', JSON.stringify(state));
      this.#window?.setUpdateState(state);
    });
    // Update checks must not wait for the bundled Harness runtime to finish
    // booting. A slow or failed runtime should never hide an available desktop
    // update from the user.
    this.#updater.startAutomaticChecks();

    if (recoveredPreferences !== undefined) {
      this.#notifyPreferenceRecovery(recoveredPreferences);
    }

    await ensureBundledRuntimeExtensions(runtimeHome, runtimeRoot);
    const externalPluginPatches = await this.#externalPluginControl.patchPaths();
    const runtimeCommand = createHarnessRuntimeCommand(
      runtimeRoot,
      carrierMode,
      [...managedPluginPatches, ...externalPluginPatches],
    );
    this.#runtime = createRuntimeSupervisor({
      command: runtimeCommand.command,
      args: runtimeCommand.args,
      runtimeHome,
      runtimeBinDirectories: [
        join(runtimeRoot, 'dsh', 'node_modules', '.bin'),
        join(runtimeRoot, 'node', 'bin'),
      ],
      workspaceRoot: app.getPath('documents'),
      version: '0.1.1-rc.2',
      startupTimeoutMs: runtimeStartupTimeoutMs(),
      shutdownTimeoutMs: 5_000,
      port: runtimePort.port,
      developmentPluginFixture: developmentPluginFixtureEnabled(app.isPackaged),
      distributionRegion: this.#distributionRegion,
      createCompanionToken: () => {
        const companionToken = randomBytes(32).toString('base64url');
        this.#runtimeStderr.rotateCompanionSecret(companionToken);
        this.#companionToken = companionToken;
        return companionToken;
      },
      onOutput: (stream, chunk) => {
        if (stream === 'stderr') {
          this.#runtimeStderr.write(chunk);
        }
      },
    });
    this.#runtime.subscribe((state) => {
      if (state.kind === 'stopped' || state.kind === 'failed') {
        this.#runtimeStderr.flush();
        this.#companionToken = '';
        this.#workspaceAuthorityRevision += 1;
        this.#clearWorkspaceAuthorityRetry();
        this.#clearWorkspaceAuthority();
        this.#window?.setCompanionWorkspace(
          this.#desktopFeaturePreferences.workspaceReview &&
          this.#latestHarnessContext?.sessionId !== undefined
            ? { status: 'unavailable', running: this.#latestHarnessContext.running }
            : { status: 'none' },
        );
        this.#managedInstallConfirmation = undefined;
        this.#managedPluginRemoval = undefined;
        this.#managedPluginActivation = undefined;
        this.#managedPluginRollback = undefined;
      }
      this.#log?.write('runtime.state', JSON.stringify(state));
      if (state.kind === 'failed') {
        this.#lastFailure = state.failure;
        if (state.failure.code === 'unexpected-exit') {
          if (this.#pluginTrialGeneration !== undefined) {
            void this.#recoverPluginTrial(state.failure);
          } else {
            void this.#recoverRuntime(state.failure);
          }
        } else {
          void this.#window?.showFailure(state.failure);
        }
      }
    });
    this.#installMenu(
      logDirectory,
      validatedDesktopLocale(app.getLocale()) ?? 'zh-CN',
    );
    await this.#startRuntime();
  }

  async #readAccountBalance(force: boolean): Promise<AccountBalanceSnapshot> {
    if (!this.#desktopFeaturePreferences.accountBalance) {
      return {
        status: 'unavailable',
        reason: 'network',
        today: { status: 'unavailable' },
      };
    }
    const state = this.#runtime?.getState();
    if (state?.kind !== 'ready' || this.#companionToken === '') {
      return {
        status: 'unavailable',
        reason: 'network',
        today: { status: 'unavailable' },
      };
    }
    return createRuntimeCompanionClient(this.#companionToken).readAccountBalance(
      state.origin,
      force,
    );
  }

  async #handleHarnessContext(snapshot: HarnessContextSnapshot): Promise<void> {
    this.#latestHarnessContext = snapshot;
    this.#clearWorkspaceAuthorityRetry();
    if (!this.#desktopFeaturePreferences.workspaceReview || snapshot.sessionId === undefined) {
      this.#workspaceAuthorityRevision += 1;
      this.#clearWorkspaceAuthority();
      this.#window?.setCompanionWorkspace({ status: 'none' });
      return;
    }
    const reusable = reusableWorkspaceAuthority(this.#activeWorkspaceAuthority, snapshot);
    if (reusable !== undefined && this.#workspaceInspector !== undefined) {
      this.#window?.setCompanionWorkspace({
        status: 'ready',
        sessionId: reusable.sessionId,
        workspaceId: reusable.workspaceId,
        title: reusable.title,
        running: snapshot.running,
      });
      return;
    }
    const requestRevision = ++this.#workspaceAuthorityRevision;
    this.#clearWorkspaceAuthority();
    this.#window?.setCompanionWorkspace({
      status: 'authorizing',
      running: snapshot.running,
    });
    await this.#authorizeWorkspace(snapshot, requestRevision, 0);
  }

  async #authorizeWorkspace(
    snapshot: HarnessContextSnapshot,
    requestRevision: number,
    retryAttempt: number,
  ): Promise<void> {
    if (
      snapshot.sessionId === undefined ||
      !this.#desktopFeaturePreferences.workspaceReview ||
      requestRevision !== this.#workspaceAuthorityRevision
    ) return;
    const state = this.#runtime?.getState();
    if (state?.kind !== 'ready' || this.#companionToken === '') {
      this.#window?.setCompanionWorkspace({
        status: 'unavailable',
        running: snapshot.running,
      });
      if (shouldRetryWorkspaceAuthority(retryAttempt)) {
        this.#scheduleWorkspaceAuthorityRetry(snapshot, requestRevision, retryAttempt);
      }
      return;
    }
    const runtimeIdentity = { origin: state.origin, token: this.#companionToken };
    const authority = await createRuntimeCompanionClient(runtimeIdentity.token).authorizeWorkspace(
      state.origin,
      {
        sessionId: snapshot.sessionId,
        ...(snapshot.workspaceId === undefined ? {} : { workspaceId: snapshot.workspaceId }),
      },
    );
    const currentRuntime = this.#runtime?.getState();
    if (
      requestRevision !== this.#workspaceAuthorityRevision ||
      !runtimeAuthorityIdentityMatches(
        runtimeIdentity,
        currentRuntime?.kind === 'ready'
          ? { origin: currentRuntime.origin, token: this.#companionToken }
          : undefined,
      )
    ) return;
    if (
      authority === undefined ||
      (snapshot.workspaceId !== undefined && authority.workspaceId !== snapshot.workspaceId)
    ) {
      this.#window?.setCompanionWorkspace({
        status: 'unavailable',
        running: snapshot.running,
      });
      if (shouldRetryWorkspaceAuthority(retryAttempt)) {
        this.#scheduleWorkspaceAuthorityRetry(snapshot, requestRevision, retryAttempt);
      }
      return;
    }
    this.#workspaceChangeMonitor?.close();
    this.#workspaceInspector = createWorkspaceInspector(authority.root);
    this.#activeWorkspaceAuthority = {
      ...authority,
      sessionId: snapshot.sessionId,
    };
    this.#workspaceChangeMonitor = createWorkspaceChangeMonitor(authority.root, () => {
      if (requestRevision === this.#workspaceAuthorityRevision) {
        this.#window?.notifyWorkspaceChanged();
      }
    });
    this.#window?.setCompanionWorkspace({
      status: 'ready',
      sessionId: snapshot.sessionId,
      workspaceId: authority.workspaceId,
      title: authority.title,
      running: snapshot.running,
    });
  }

  #scheduleWorkspaceAuthorityRetry(
    snapshot: HarnessContextSnapshot,
    requestRevision: number,
    retryAttempt: number,
  ): void {
    this.#clearWorkspaceAuthorityRetry();
    this.#workspaceAuthorityRetryTimer = setTimeout(() => {
      this.#workspaceAuthorityRetryTimer = undefined;
      void this.#authorizeWorkspace(snapshot, requestRevision, retryAttempt + 1);
    }, workspaceRetryDelay(retryAttempt));
    this.#workspaceAuthorityRetryTimer.unref();
  }

  #clearWorkspaceAuthorityRetry(): void {
    if (this.#workspaceAuthorityRetryTimer !== undefined) {
      clearTimeout(this.#workspaceAuthorityRetryTimer);
      this.#workspaceAuthorityRetryTimer = undefined;
    }
  }

  #clearWorkspaceAuthority(): void {
    this.#workspaceChangeMonitor?.close();
    this.#workspaceChangeMonitor = undefined;
    this.#workspaceInspector = undefined;
    this.#activeWorkspaceAuthority = undefined;
  }

  #setDesktopFeaturePreferences(preferences: DesktopFeaturePreferences): void {
    const previous = this.#desktopFeaturePreferences;
    this.#desktopFeaturePreferences = preferences;
    this.#featurePreferences?.update(preferences);
    if (previous.workspaceReview === preferences.workspaceReview) return;
    if (!preferences.workspaceReview) {
      this.#workspaceAuthorityRevision += 1;
      this.#clearWorkspaceAuthorityRetry();
      this.#clearWorkspaceAuthority();
      this.#window?.setCompanionWorkspace({ status: 'none' });
      return;
    }
    if (this.#latestHarnessContext !== undefined) {
      void this.#handleHarnessContext(this.#latestHarnessContext);
    }
  }

  async #handleWorkspaceReviewRequest(
    request: WorkspaceReviewRequest,
  ): Promise<WorkspaceReviewResponse> {
    const inspector = this.#workspaceInspector;
    if (inspector === undefined) return { kind: 'unavailable', reason: 'no-workspace' };
    if (request.kind === 'overview') return inspector.overview();
    if (request.kind === 'file.search') return inspector.search(request.query);
    if (request.kind === 'directory.list') return inspector.listDirectory(request.nodeId);
    if (request.kind === 'change.diff') return inspector.diff(request.nodeId);
    if (request.kind === 'file.preview-relative')
      return inspector.previewRelative(request.nodeId, request.target);
    return inspector.preview(request.nodeId);
  }

  async #previewManagedPlugin(
    request: ManagedPluginPreviewRequest,
  ): Promise<ManagedPluginPreviewResult> {
    const state = this.#runtime?.getState();
    const confirmation = this.#managedInstallConfirmation;
    if (state?.kind !== 'ready' || this.#companionToken === '' || confirmation === undefined) {
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'runtime-unavailable',
      };
    }
    try {
      const preview = await createRuntimeMarketClient(this.#companionToken).preview(state.origin, {
        sourceRecordId: request.sourceRecordId,
        itemId: request.itemId,
        versionPreference: request.versionPreference,
      });
      const summary = validatedManagedPluginPreviewSummary(preview.inspection);
      if (summary === undefined) {
        return {
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'not-installable',
        };
      }
      const inventory = await this.#pluginProfileBootstrap?.inventory();
      const current = inventory?.entries.find(
        (entry) => entry.packageName === preview.candidate.packageName,
      );
      const operation: ManagedPluginInstallOperation =
        current === undefined
          ? { kind: 'install' }
          : current.version === preview.candidate.version
            ? { kind: 'reinstall', currentVersion: current.version }
            : { kind: 'update', currentVersion: current.version };
      const capability = confirmation.issue({
        generation: preview.profileGeneration,
        candidate: preview.candidate,
        stagingPreviewId: preview.previewId,
        expiresInSeconds: preview.expiresInSeconds,
        summary,
        operation,
        expectedReceipt:
          current === undefined
            ? null
            : {
                packageName: current.packageName,
                version: current.version,
                generation: current.generation,
              },
      });
      this.#log?.write(
        'plugin-market.preview-issued',
        `package=${preview.candidate.packageName} generation=${preview.profileGeneration}`,
      );
      return {
        requestId: request.requestId,
        status: 'ready',
        previewId: capability.previewId,
        profileGeneration: capability.profileGeneration,
        expiresInSeconds: capability.expiresInSeconds,
        operation: capability.operation,
        summary: capability.summary,
      };
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
      this.#log?.write('plugin-market.preview-failed', code || 'invalid-response');
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason:
          code.endsWith('preview-limit') || code.endsWith('busy') ? 'busy' : 'invalid-response',
      };
    }
  }

  async #readManagedPluginInventory(
    request: ManagedPluginInventoryRequest,
  ): Promise<ManagedPluginInventoryResult> {
    const bootstrap = this.#pluginProfileBootstrap;
    if (bootstrap === undefined) {
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'runtime-unavailable',
      };
    }
    try {
      const snapshot = await bootstrap.inventory();
      const externalEntries = await this.#externalPluginControl?.inventory() ?? [];
      return { requestId: request.requestId, status: 'ready', ...snapshot, externalEntries };
    } catch (error) {
      this.#log?.write(
        'plugin-profile.inventory-failed',
        error instanceof Error ? error.message : String(error),
      );
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'invalid-response',
      };
    }
  }

  async #removeManagedPlugin(
    request: ManagedPluginRemoveRequest,
  ): Promise<ManagedPluginRemoveResult> {
    const removal = this.#managedPluginRemoval;
    if (removal === undefined) {
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'runtime-unavailable',
      };
    }
    const result = await removal.execute(request);
    this.#log?.write(
      'plugin-market.remove-result',
      `package=${request.packageName} status=${result.status}${result.status === 'unavailable' ? ` reason=${result.reason}` : ''}`,
    );
    return result;
  }

  async #setManagedPluginEnabled(
    request: ManagedPluginSetEnabledRequest,
  ): Promise<ManagedPluginSetEnabledResult> {
    const activation = this.#managedPluginActivation;
    if (activation === undefined) {
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'runtime-unavailable',
      };
    }
    const result = await activation.execute(request);
    this.#log?.write(
      'plugin-market.enabled-result',
      `package=${request.packageName} enabled=${String(request.enabled)} status=${result.status}${result.status === 'unavailable' ? ` reason=${result.reason}` : ''}`,
    );
    return result;
  }

  async #rollbackManagedPlugin(
    request: ManagedPluginRollbackRequest,
  ): Promise<ManagedPluginRollbackResult> {
    const rollback = this.#managedPluginRollback;
    if (rollback === undefined) {
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'runtime-unavailable',
      };
    }
    const result = await rollback.execute(request);
    this.#log?.write(
      'plugin-market.rollback-result',
      `package=${request.packageName} status=${result.status}${result.status === 'unavailable' ? ` reason=${result.reason}` : ''}`,
    );
    return result;
  }

  async #controlExternalPlugin(
    request: ExternalPluginControlRequest,
  ): Promise<ExternalPluginControlResult> {
    const control = this.#externalPluginControl;
    if (control === undefined || this.#runtime === undefined) {
      return { requestId: request.requestId, status: 'unavailable', reason: 'runtime-unavailable' };
    }
    let entry;
    try {
      entry = (await control.inventory()).find(
        (candidate) => candidate.packageName === request.packageName &&
          candidate.version === request.version && candidate.entryIds.includes(request.entryId),
      );
    } catch {
      entry = undefined;
    }
    if (entry === undefined || !entry.allowedActions.includes(request.action)) {
      return { requestId: request.requestId, status: 'unavailable', reason: 'identity-mismatch' };
    }
    const confirmed = await this.#confirmExternalPluginControl(request);
    if (!confirmed) return { requestId: request.requestId, status: 'cancelled' };
    try {
      if (request.action === 'uninstall') {
        await this.#runtime.stop('restart');
        await control.remove(request);
      } else {
        await control.setEnabled({ ...request, enabled: request.action === 'enable' });
      }
      this.#log?.write(
        'plugin-market.external-control-prepared',
        `package=${request.packageName} action=${request.action}`,
      );
      this.#schedulePluginProfileRestart();
      return { requestId: request.requestId, status: 'prepared', restartScheduled: true };
    } catch (error) {
      this.#log?.write(
        'plugin-market.external-control-failed',
        error instanceof Error ? error.message : String(error),
      );
      if (this.#runtime.getState().kind === 'stopped') void this.#restartPluginProfileRuntime();
      return { requestId: request.requestId, status: 'unavailable', reason: 'failed' };
    }
  }

  async #confirmExternalPluginControl(request: ExternalPluginControlRequest): Promise<boolean> {
    const chinese = app.getLocale().toLowerCase().startsWith('zh');
    const action = request.action === 'uninstall'
      ? (chinese ? '卸载' : 'Uninstall')
      : request.action === 'disable'
        ? (chinese ? '停用' : 'Disable')
        : (chinese ? '启用' : 'Enable');
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: chinese ? `${action}外部插件` : `${action} external plugin`,
      message: `${action} ${request.packageName}@${request.version}?`,
      detail: request.action === 'uninstall'
        ? (chinese
            ? '将通过 Harness 官方插件命令从 web 配置中移除这个顶层包，并重启应用。其子入口不会被单独卸载。'
            : 'The top-level package will be removed from the web profile through the official Harness plugin command, then the app will restart. Nested entries are never uninstalled separately.')
        : (chinese
            ? '桌面端只会写入自己的覆盖配置，不修改插件代码或用户原有配置；随后应用将重启。'
            : 'The desktop writes only its own overlay and does not modify plugin code or existing user configuration; the app will then restart.'),
      buttons: chinese ? ['取消', `${action}并重启`] : ['Cancel', `${action} and restart`],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response.response === 1;
  }

  async #executeManagedPlugin(
    request: ManagedPluginExecuteRequest,
  ): Promise<ManagedPluginExecuteResult> {
    const confirmation = this.#managedInstallConfirmation;
    if (confirmation === undefined) {
      return {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'runtime-unavailable',
      };
    }
    const result = await confirmation.execute(request);
    this.#log?.write(
      'plugin-market.execute-result',
      `status=${result.status}${result.status === 'unavailable' ? ` reason=${result.reason}` : ''}`,
    );
    return result;
  }

  async #confirmManagedPluginInstall(
    summary: ManagedPluginPreviewSummary,
    operation: ManagedPluginInstallOperation,
  ): Promise<boolean> {
    const chinese = app.getLocale().toLowerCase().startsWith('zh');
    const artifactSize = `${formatBytes(summary.artifact.verifiedCompressedBytes)} / ${formatBytes(summary.artifact.verifiedUnpackedBytes)}`;
    const detail = chinese
      ? [
          `已验证包体：${summary.artifact.verifiedArtifacts} 个`,
          `压缩 / 解包大小：${artifactSize}`,
          `文件数：${summary.artifact.verifiedFileCount}`,
          `依赖图：${summary.dependencies.nodes} 个节点、${summary.dependencies.edges} 条边`,
          '',
          '安装后插件与 Harness 共享当前用户权限。应用将重启并以试运行模式加载；若启动失败，会自动恢复到上一份配置。',
        ].join('\n')
      : [
          `Verified artifacts: ${summary.artifact.verifiedArtifacts}`,
          `Compressed / unpacked size: ${artifactSize}`,
          `Files: ${summary.artifact.verifiedFileCount}`,
          `Dependency graph: ${summary.dependencies.nodes} nodes, ${summary.dependencies.edges} edges`,
          '',
          'The plugin shares the current user permissions with Harness. The app will restart in trial mode and automatically recover the previous profile if startup fails.',
        ].join('\n');
    const updating = operation.kind === 'update';
    const reinstalling = operation.kind === 'reinstall';
    const action = updating
      ? chinese
        ? '更新'
        : 'Update'
      : reinstalling
        ? chinese
          ? '重新安装'
          : 'Reinstall'
        : chinese
          ? '安装'
          : 'Install';
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: chinese ? `${action}社区插件` : `${action} community plugin`,
      message: updating
        ? chinese
          ? `将 ${summary.packageName} 从 ${operation.currentVersion} 更新到 ${summary.version}？`
          : `Update ${summary.packageName} from ${operation.currentVersion} to ${summary.version}?`
        : `${action} ${summary.packageName}@${summary.version}?`,
      detail,
      buttons: chinese ? ['取消', `${action}并重启`] : ['Cancel', `${action} and restart`],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response.response === 1;
  }

  async #confirmManagedPluginRemoval(summary: {
    readonly packageName: string;
    readonly version: string;
    readonly installedAt: string;
  }): Promise<boolean> {
    const chinese = app.getLocale().toLowerCase().startsWith('zh');
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: chinese ? '卸载社区插件' : 'Uninstall community plugin',
      message: chinese
        ? `卸载 ${summary.packageName}@${summary.version}？`
        : `Uninstall ${summary.packageName}@${summary.version}?`,
      detail: chinese
        ? '应用将重启并试运行不包含该插件的新配置；若启动失败，会自动恢复插件和上一份配置。插件包体不会立即删除，后续由安全缓存回收处理。'
        : 'The app will restart and trial a profile without this plugin. If startup fails, the plugin and previous profile are restored automatically. Cached artifacts are reclaimed later.',
      buttons: chinese ? ['取消', '卸载并重启'] : ['Cancel', 'Uninstall and restart'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response.response === 1;
  }

  async #confirmManagedPluginEnabled(summary: {
    readonly packageName: string;
    readonly version: string;
    readonly enabled: boolean;
  }): Promise<boolean> {
    const chinese = app.getLocale().toLowerCase().startsWith('zh');
    const action = summary.enabled ? (chinese ? '启用' : 'Enable') : chinese ? '停用' : 'Disable';
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: chinese ? `${action}社区插件` : `${action} community plugin`,
      message: chinese
        ? `${action} ${summary.packageName}@${summary.version}？`
        : `${action} ${summary.packageName}@${summary.version}?`,
      detail: chinese
        ? `应用将重启并试运行${summary.enabled ? '包含' : '不包含'}该插件的新配置；若启动失败，会自动恢复之前的启用状态和配置。插件仍保持安装，不会删除 receipt 或缓存包体。`
        : `The app will restart and trial a profile ${summary.enabled ? 'with' : 'without'} this plugin. If startup fails, the previous enabled state and profile are restored. The plugin remains installed and its receipt and cached artifacts are retained.`,
      buttons: chinese ? ['取消', `${action}并重启`] : ['Cancel', `${action} and restart`],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response.response === 1;
  }

  async #confirmManagedPluginRollback(summary: {
    readonly packageName: string;
    readonly currentVersion: string;
    readonly targetVersion: string;
  }): Promise<boolean> {
    const chinese = app.getLocale().toLowerCase().startsWith('zh');
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: chinese ? '回滚社区插件' : 'Roll back community plugin',
      message: chinese
        ? `将 ${summary.packageName} 从 ${summary.currentVersion} 回滚到 ${summary.targetVersion}？`
        : `Roll back ${summary.packageName} from ${summary.currentVersion} to ${summary.targetVersion}?`,
      detail: chinese
        ? '应用将重启并试运行上一份已验证的受管版本；若启动失败，会自动恢复当前版本和配置。回滚不会重新下载包体或运行安装脚本。'
        : 'The app will restart and trial the previous verified managed version. If startup fails, the current version and profile are restored. Rollback does not download artifacts again or run install scripts.',
      buttons: chinese ? ['取消', '回滚并重启'] : ['Cancel', 'Roll back and restart'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response.response === 1;
  }

  #schedulePluginProfileRestart(): void {
    if (this.#pluginRestartScheduled) return;
    this.#pluginRestartScheduled = true;
    this.#log?.write('plugin-profile.restart-scheduled');
    setTimeout(() => {
      if (this.#quitting) return;
      if (pluginProfileRestartKind(app.isPackaged) === 'application') {
        app.relaunch();
        void this.quit();
        return;
      }
      void this.#restartPluginProfileRuntime();
    }, 750);
  }

  async #restartPluginProfileRuntime(): Promise<void> {
    try {
      await this.#window?.showLoading();
      await this.#runtime?.stop('restart');
      const launchPlan = await this.#pluginProfileBootstrap?.prepareRuntimeLaunch();
      if (launchPlan === undefined || this.#runtime === undefined) {
        throw new Error('Plugin profile Runtime restart is unavailable');
      }
      this.#pluginTrialGeneration = launchPlan.trialGeneration ?? undefined;
      const command = createHarnessRuntimeCommand(
        this.#runtimeRoot,
        this.#carrierMode,
        [
          ...launchPlan.patchPaths,
          ...(await this.#externalPluginControl?.patchPaths() ?? []),
        ],
      );
      this.#runtime.configureLaunch(command.command, command.args);
      this.#log?.write(
        'plugin-profile.runtime-restart',
        `trial=${launchPlan.trialGeneration ?? 'none'} patches=${String(launchPlan.patchPaths.length)}`,
      );
      await this.#startRuntime();
    } catch (error) {
      const failure = failureFrom(error);
      this.#log?.write('plugin-profile.runtime-restart-failed', failure.message);
      await this.#window?.showFailure(failure);
    } finally {
      this.#pluginRestartScheduled = false;
    }
  }

  #copyDiagnostics(): void {
    const failure = this.#lastFailure;
    clipboard.writeText(
      [
        `Application: ${app.name} ${app.getVersion()}`,
        `Electron: ${process.versions.electron}`,
        `Harness: 0.1.1-rc.2`,
        `Architecture: ${process.arch}`,
        `Failure: ${failure?.code ?? 'none'}`,
        `Details: ${redact(failure?.message ?? 'No failure recorded')}`,
      ].join('\n'),
    );
  }

  async #recoverPreferences(runtimeHome: string): Promise<string | undefined> {
    try {
      const result = await recoverInvalidPreferences(join(runtimeHome, 'settings.yaml'));
      if (result.status === 'recovered') {
        this.#log?.write(
          'preferences.recovered',
          `backup=${result.backupPath} reason=${result.reason}`,
        );
        return result.backupPath;
      }
    } catch (error) {
      this.#log?.write(
        'preferences.recovery-failed',
        error instanceof Error ? error.message : String(error),
      );
    }
    return undefined;
  }

  #notifyPreferenceRecovery(backupPath: string): void {
    void dialog
      .showMessageBox({
        type: 'warning',
        title: '偏好设置已恢复',
        message: '检测到损坏的偏好设置，已恢复为默认值。',
        detail: `原文件已安全备份为 ${basename(backupPath)}。会话、凭据和工作区数据没有改动。`,
        buttons: ['继续', '在 Finder 中显示备份'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1) {
          shell.showItemInFolder(backupPath);
        }
      })
      .catch((error: unknown) => {
        this.#log?.write(
          'preferences.recovery-notification-failed',
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  async #exportDiagnostics(logDirectory: string): Promise<void> {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const result = await dialog.showSaveDialog({
      title: '导出诊断包',
      defaultPath: join(app.getPath('downloads'), `DeepSeek-YukiRyou-Diagnostics-${timestamp}.zip`),
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (result.canceled || result.filePath === undefined) {
      return;
    }

    try {
      this.#log?.write('diagnostics.export-requested');
      await this.#log?.flush();
      const failure = this.#lastFailure;
      await createDiagnosticArchive({
        destinationPath: result.filePath,
        logDirectory,
        metadata: {
          application: app.name,
          applicationVersion: app.getVersion(),
          electronVersion: process.versions.electron,
          harnessVersion: '0.1.1-rc.2',
          architecture: process.arch,
          operatingSystem: `${process.platform} ${release()}`,
          failureCode: failure?.code ?? 'none',
          failureDetails: failure?.message ?? 'No failure recorded',
          userHome: app.getPath('home'),
        },
      });
      this.#log?.write('diagnostics.exported');
      shell.showItemInFolder(result.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#log?.write('diagnostics.export-failed', message);
      dialog.showErrorBox('无法导出诊断包', '请打开日志查看详细信息。');
    }
  }

  async restartRuntime(): Promise<void> {
    this.#recovery.reset();
    await this.#window?.showLoading();
    await this.#runtime?.stop('restart');
    await this.#startRuntime();
  }

  async #retryStartup(): Promise<void> {
    const runtimeState = this.#runtime?.getState();
    if (
      this.#pluginTrialGeneration === undefined &&
      this.#runtime !== undefined &&
      runtimeState?.kind !== 'failed'
    ) {
      await this.restartRuntime();
      return;
    }
    if (pluginProfileRestartKind(app.isPackaged) === 'runtime') {
      const generation = this.#pluginTrialGeneration;
      if (generation !== undefined) {
        await this.#pluginProfileBootstrap?.recover(generation, 'runtime-unhealthy');
        this.#pluginTrialGeneration = undefined;
      }
      await this.#restartPluginProfileRuntime();
      return;
    }
    try {
      await this.#runtime?.stop('restart');
    } catch {
      // A full relaunch will rebuild endpoint and process state from disk.
    }
    this.#runtimeStderr.flush();
    this.#quitting = true;
    await this.#disposeWindowAndFlushState();
    await relaunchAfterStartupFailure({
      log: this.#log,
      relaunch: () => app.relaunch(),
      dispose: () => {
        this.#updater?.dispose();
      },
      quit: () => app.quit(),
    });
  }

  async #checkForUpdates(): Promise<void> {
    this.#log?.write('update.check-requested');
    try {
      const result = await this.#updater?.checkForUpdates();
      if (result === undefined) {
        return;
      }
      const messages = {
        disabled: {
          message: '开发版本不执行自动更新',
          detail: '自动更新仅在正式的 Apple Silicon macOS 或 Windows x64 发行版中启用。',
        },
        busy: {
          message: '正在检查更新',
          detail: '当前检查或下载尚未完成，请稍后再试。',
        },
        'not-available': {
          message: 'DeepSeek YukiRyou 已是最新版本',
          detail: `当前版本：${app.getVersion()}`,
        },
        available: {
          message: '发现新版本',
          detail: '更新正在后台下载，完成后会提示你重启安装。',
        },
      } as const;
      await dialog.showMessageBox({
        type: 'info',
        title: '软件更新',
        ...messages[result.status],
        buttons: ['好'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#log?.write('update.check-failed', message);
      await dialog.showMessageBox({
        type: 'error',
        title: '软件更新',
        message: '暂时无法检查更新',
        detail: '国内源与 GitHub 备用源均不可用，请检查网络连接后重试。',
        buttons: ['好'],
      });
    }
  }

  #handleUpdaterError(error: Error): void {
    this.#log?.write('update.error', error.message);
  }

  async #handleUpdateCommand(command: UpdateCommand): Promise<void> {
    if (command === 'download') {
      await shell.openExternal(
        this.#updater?.getDownloadUrl() ??
          releaseDownloadPageUrl(),
      );
      return;
    }
    if (command === 'install') {
      if (this.#updater?.getState().status === 'downloaded') {
        await this.#installDownloadedUpdate();
      }
      return;
    }
    this.#log?.write('update.check-requested', 'source=harness');
    await this.#updater?.checkForUpdates().catch((error: unknown) => {
      this.#handleUpdaterError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async #installDownloadedUpdate(): Promise<void> {
    if (this.#quitting) {
      return;
    }
    this.#window?.captureWindowState();
    this.#quitting = true;
    this.#log?.write('update.installing');
    const updater = this.#updater;
    try {
      await this.#runtime?.stop('update');
    } finally {
      this.#runtimeStderr.flush();
      await this.#disposeWindowAndFlushState();
      await finalizeApplicationExit({
        log: this.#log,
        dispose: () => {
          updater?.dispose();
        },
        exit: () => updater?.quitAndInstall(),
      });
    }
  }

  async #recoverRuntime(failure: RuntimeFailure): Promise<void> {
    if (this.#recovering || this.#quitting) {
      return;
    }
    const delayMs = this.#recovery.nextDelay();
    if (delayMs === undefined) {
      await this.#window?.showFailure(failure);
      return;
    }

    this.#recovering = true;
    this.#log?.write('runtime.recovering', `delayMs=${String(delayMs)}`);
    await this.#window?.showLoading();
    await delay(delayMs);
    try {
      await this.#startRuntime();
    } finally {
      this.#recovering = false;
    }
  }

  async #recoverPluginTrial(failure: RuntimeFailure): Promise<boolean> {
    const generation = this.#pluginTrialGeneration;
    if (generation === undefined) return this.#pluginTrialRecoveryActive;
    if (this.#recovering || this.#quitting) return true;
    this.#recovering = true;
    this.#pluginTrialRecoveryActive = true;
    this.#pluginTrialGeneration = undefined;
    try {
      await this.#pluginProfileBootstrap?.recover(generation, 'runtime-unhealthy');
      this.#log?.write(
        'plugin-profile.trial-recovered',
        `generation=${generation} failure=${failure.code}`,
      );
      const delayMs = this.#recovery.nextDelay();
      if (delayMs === undefined) {
        await this.#window?.showFailure(failure);
        return true;
      }
      await this.#window?.showLoading();
      await this.#runtime?.stop('restart').catch(() => undefined);
      await delay(delayMs);
      if (pluginProfileRestartKind(app.isPackaged) === 'runtime') {
        await this.#restartPluginProfileRuntime();
        return true;
      }
      this.#quitting = true;
      await this.#disposeWindowAndFlushState();
      await relaunchAfterStartupFailure({
        log: this.#log,
        relaunch: () => app.relaunch(),
        dispose: () => {
          this.#updater?.dispose();
        },
        quit: () => app.quit(),
      });
      return true;
    } catch (error) {
      this.#pluginTrialGeneration = generation;
      const recoveryFailure: RuntimeFailure = {
        code: 'upgrade-preparation-failed',
        message: `Plugin profile recovery failed (${startupPreparationFailureLogDetails(error)})`,
      };
      this.#lastFailure = recoveryFailure;
      this.#log?.write('plugin-profile.recovery-failed', recoveryFailure.message);
      await this.#window?.showFailure(recoveryFailure);
      return true;
    } finally {
      if (!this.#quitting) {
        this.#recovering = false;
        this.#pluginTrialRecoveryActive = false;
      }
    }
  }

  async quit(): Promise<void> {
    if (this.#quitting) {
      return;
    }
    this.#window?.captureWindowState();
    this.#quitting = true;
    this.#workspaceChangeMonitor?.close();
    this.#workspaceChangeMonitor = undefined;
    this.#clearWorkspaceAuthorityRetry();
    this.#log?.write('app.quit');
    try {
      await this.#runtime?.stop('quit');
    } finally {
      this.#runtimeStderr.flush();
      await this.#disposeWindowAndFlushState();
      await finalizeApplicationExit({
        log: this.#log,
        dispose: () => {
          this.#updater?.dispose();
        },
        exit: () => app.quit(),
      });
    }
  }

  async #disposeWindowAndFlushState(): Promise<void> {
    this.#window?.dispose();
    this.#window = undefined;
    await this.#windowState?.flush().catch((error: unknown) => {
      this.#log?.write(
        'desktop.window-state-flush-error',
        error instanceof Error ? error.message : String(error),
      );
    });
    await this.#featurePreferences?.flush().catch((error: unknown) => {
      this.#log?.write(
        'desktop.feature-preferences-flush-error',
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  async #startRuntime(): Promise<void> {
    try {
      const ready = await this.#runtime?.start();
      if (ready !== undefined) {
        const token = this.#companionToken;
        const bootstrap = this.#pluginProfileBootstrap;
        const client = token === '' ? undefined : createRuntimeMarketClient(token);
        const transaction =
          client === undefined || bootstrap === undefined
            ? undefined
            : createManagedInstallTransaction({
                installer: {
                  stage: async ({ previewId }) => {
                    const current = this.#runtime?.getState();
                    if (
                      current?.kind !== 'ready' ||
                      current.origin !== ready.origin ||
                      this.#companionToken !== token
                    ) {
                      throw new Error('Runtime identity changed before managed staging');
                    }
                    return client.stage(ready.origin, previewId);
                  },
                },
                bootstrap,
              });
        this.#managedInstallConfirmation =
          transaction === undefined
            ? undefined
            : createManagedInstallConfirmation({
                transaction,
                confirm: (summary, operation) =>
                  this.#confirmManagedPluginInstall(summary, operation),
                runtimeAvailable: () => {
                  const current = this.#runtime?.getState();
                  return (
                    current?.kind === 'ready' &&
                    current.origin === ready.origin &&
                    this.#companionToken === token
                  );
                },
                scheduleRestart: () => this.#schedulePluginProfileRestart(),
              });
        this.#managedPluginRemoval =
          bootstrap === undefined
            ? undefined
            : createManagedPluginRemoval({
                bootstrap,
                confirm: (summary) => this.#confirmManagedPluginRemoval(summary),
                runtimeAvailable: () => {
                  const current = this.#runtime?.getState();
                  return (
                    current?.kind === 'ready' &&
                    current.origin === ready.origin &&
                    this.#companionToken === token
                  );
                },
                scheduleRestart: () => this.#schedulePluginProfileRestart(),
              });
        this.#managedPluginActivation =
          bootstrap === undefined
            ? undefined
            : createManagedPluginActivation({
                bootstrap,
                confirm: (summary) => this.#confirmManagedPluginEnabled(summary),
                runtimeAvailable: () => {
                  const current = this.#runtime?.getState();
                  return (
                    current?.kind === 'ready' &&
                    current.origin === ready.origin &&
                    this.#companionToken === token
                  );
                },
                scheduleRestart: () => this.#schedulePluginProfileRestart(),
              });
        this.#managedPluginRollback =
          bootstrap === undefined
            ? undefined
            : createManagedPluginRollback({
                bootstrap,
                confirm: (summary) => this.#confirmManagedPluginRollback(summary),
                runtimeAvailable: () => {
                  const current = this.#runtime?.getState();
                  return (
                    current?.kind === 'ready' &&
                    current.origin === ready.origin &&
                    this.#companionToken === token
                  );
                },
                scheduleRestart: () => this.#schedulePluginProfileRestart(),
              });
        await this.#window?.showHarness(ready.origin);
        const generation = this.#pluginTrialGeneration;
        if (generation !== undefined) {
          await this.#pluginProfileBootstrap?.commit(generation);
          this.#pluginTrialGeneration = undefined;
          this.#log?.write('plugin-profile.trial-committed', `generation=${generation}`);
        }
      }
    } catch (error) {
      this.#runtimeStderr.flush();
      const state = this.#runtime?.getState();
      const failure = state?.kind === 'failed' ? state.failure : failureFrom(error);
      this.#log?.write('runtime.start-failed', failure.message);
      if (!(await this.#recoverPluginTrial(failure))) {
        await this.#window?.showFailure(failure);
      }
    }
  }

  #installMenu(logDirectory: string, locale: DesktopLocale): void {
    const menu = Menu.buildFromTemplate(createApplicationMenuTemplate({
      appName: app.name,
      locale,
      platform: process.platform,
      actions: {
        restartHarness: () => void this.restartRuntime(),
        reloadHarness: () => this.#window?.reload(),
        openLogs: () => void shell.openPath(logDirectory),
        exportDiagnostics: () => void this.#exportDiagnostics(logDirectory),
        checkForUpdates: () => void this.#checkForUpdates(),
      },
    }));
    Menu.setApplicationMenu(menu);
    ipcMain.removeAllListeners(WINDOW_MENU_CHANNEL);
    ipcMain.on(WINDOW_MENU_CHANNEL, (event, value: unknown) => {
      if (process.platform !== 'win32') return;
      const request = validatedWindowMenuRequest(value);
      const window = BrowserWindow.fromWebContents(event.sender);
      const submenu = request === undefined
        ? undefined
        : menu.getMenuItemById(request.id)?.submenu;
      if (request === undefined || window === null || submenu === undefined) return;
      submenu.popup({ window, x: request.x, y: request.y });
    });
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1_024;
  let index = 0;
  while (value >= 1_024 && index < units.length - 1) {
    value /= 1_024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function rendererLocation(): string {
  const packagedRendererUrl = pathToFileURL(
    join(moduleDirectory, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).toString();
  return resolveRendererLocation({
    isPackaged: app.isPackaged,
    developmentServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    packagedRendererUrl,
  }).value;
}

function failureFrom(error: unknown): RuntimeFailure {
  return {
    code: 'spawn-failed',
    message: error instanceof Error ? error.message : 'Unknown runtime failure',
  };
}
