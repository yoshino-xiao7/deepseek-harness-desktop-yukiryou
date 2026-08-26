import { BrowserWindow, clipboard, ipcMain, shell, WebContentsView } from 'electron';

import type { RuntimeFailure } from '../runtime/runtime-supervisor.js';
import {
  SHELL_REVIEW_TARGET_CHANNEL,
  WORKSPACE_REVIEW_REQUEST_CHANNEL,
  type ChangedFileReviewIntent,
  type WorkspaceReviewRequest,
  type WorkspaceReviewResponse,
  validatedWorkspaceReviewRequest,
} from '../../shared/workspace-review.js';
import {
  COMPANION_COMMAND_CHANNEL,
  COMPANION_STATE_CHANNEL,
  WORKSPACE_CHANGED_CHANNEL,
  createInitialDesktopCompanionSnapshot,
  type CompanionWorkspaceSnapshot,
  type HarnessContextSnapshot,
  validatedCompanionCommand,
  transitionCompanion,
  transitionCompanionWorkspace,
} from '../../shared/desktop-companion.js';
import {
  type AccountBalanceSnapshot,
} from '../../shared/account-balance.js';
import {
  TOOLBAR_APPEARANCE_CHANNEL,
  type DesktopAppearanceSnapshot,
} from '../../shared/appearance-sync.js';
import {
  TOOLBAR_SIDEBAR_WIDTH_CHANNEL,
} from '../../shared/sidebar-width-sync.js';
import {
  type DesktopUpdateState,
  type UpdateCommand,
} from '../../shared/update-bridge.js';
import { createDesktopWindowOptions } from './desktop-window-options.js';
import {
  animatedReservedWidth,
  companionLayout,
  companionLayoutStateChanged,
  COMPANION_LAYOUT_ANIMATION_MS,
  harnessContentBounds,
} from './desktop-window-layout.js';
import {
  createRendererRecoveryPolicy,
  type RendererTarget,
} from './renderer-recovery-policy.js';
import {
  classifyLocalAction,
  createTrustedHarnessOrigin,
  type TrustedHarnessOrigin,
} from './trusted-navigation.js';
import { createProductWindowReadiness } from './product-window-readiness.js';
import {
  loadProductDocument,
  navigateProductDocument,
  resetProductDocument,
} from './product-document-navigation.js';
import { createProductWebPreferences } from './product-web-preferences.js';
import {
  createHarnessProductBridge,
  type HarnessProductBridge,
} from './harness-product-bridge.js';
import type { DesktopCarrierMode } from './desktop-carrier-mode.js';
import { createIntegratedDesktopWindow } from './integrated-desktop-window.js';
import {
  WORKSPACE_REVIEW_SHORTCUT_CHANNEL,
  workspaceReviewShortcut,
} from '../../shared/workspace-review-shortcuts.js';
import {
  SHELL_CLIPBOARD_WRITE_CHANNEL,
  validatedShellClipboardText,
} from '../../shared/shell-clipboard.js';
import {
  WORKSPACE_REFERENCE_FROM_SHELL_CHANNEL,
  WORKSPACE_REFERENCE_TO_HARNESS_CHANNEL,
  validatedWorkspaceConversationReference,
  workspaceConversationInsertion,
} from '../../shared/workspace-conversation-reference.js';
import type {
  ManagedPluginPreviewRequest,
  ManagedPluginPreviewResult,
  ManagedPluginExecuteRequest,
  ManagedPluginExecuteResult,
} from '../../shared/managed-plugin-preview.js';
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
} from '../../shared/managed-plugin-inventory.js';
import { TOOLBAR_LOCALE_CHANNEL, type DesktopLocale } from '../../shared/locale-sync.js';
import type { DesktopWindowState } from './window-state.js';
import {
  DEFAULT_DESKTOP_FEATURE_PREFERENCES,
  type DesktopFeaturePreferences,
} from '../../shared/desktop-feature-preferences.js';

const PRODUCT_DOCUMENT_NAVIGATION_TIMEOUT_MS = 15_000;

export interface DesktopWindow {
  showLoading(): Promise<void>;
  showHarness(origin: string): Promise<void>;
  showFailure(failure: RuntimeFailure): Promise<void>;
  reload(): void;
  reveal(): void;
  setUpdateState(state: DesktopUpdateState): void;
  setFeaturePreferences(preferences: DesktopFeaturePreferences): void;
  setCompanionWorkspace(state: CompanionWorkspaceSnapshot): void;
  notifyWorkspaceChanged(): void;
  captureWindowState(): void;
  dispose(): void;
}

export interface DesktopWindowOptions {
  readonly carrierMode: DesktopCarrierMode;
  readonly loadingUrl: string;
  readonly shellPreloadPath: string;
  readonly harnessPreloadPath: string;
  readonly initialWindowState?: DesktopWindowState | undefined;
  readonly initialFeaturePreferences?: DesktopFeaturePreferences | undefined;
  readonly onWindowStateChange?: (state: DesktopWindowState) => void;
  readonly onRetry: () => void;
  readonly onOpenLogs: () => void;
  readonly onCopyDiagnostics: () => void;
  readonly onExportDiagnostics: () => void;
  readonly onUpdateCommand: (command: UpdateCommand) => void;
  readonly onAccountBalanceRequest: (
    force: boolean,
  ) => Promise<AccountBalanceSnapshot>;
  readonly onFeaturePreferencesChange: (
    preferences: DesktopFeaturePreferences,
  ) => void;
  readonly onHarnessContext: (snapshot: HarnessContextSnapshot) => void;
  readonly onLocale: (locale: DesktopLocale) => void;
  readonly onWorkspaceReviewRequest: (
    request: WorkspaceReviewRequest,
  ) => Promise<WorkspaceReviewResponse>;
  readonly onHarnessReviewIntent: (intent: ChangedFileReviewIntent) => Promise<WorkspaceReviewResponse>;
  readonly onRendererCrash: (target: RendererTarget, reason: string) => void;
  readonly onManagedPluginPreview: (
    request: ManagedPluginPreviewRequest,
  ) => Promise<ManagedPluginPreviewResult>;
  readonly onManagedPluginExecute: (
    request: ManagedPluginExecuteRequest,
  ) => Promise<ManagedPluginExecuteResult>;
  readonly onManagedPluginInventory: (
    request: ManagedPluginInventoryRequest,
  ) => Promise<ManagedPluginInventoryResult>;
  readonly onManagedPluginRemove: (
    request: ManagedPluginRemoveRequest,
  ) => Promise<ManagedPluginRemoveResult>;
  readonly onManagedPluginSetEnabled: (
    request: ManagedPluginSetEnabledRequest,
  ) => Promise<ManagedPluginSetEnabledResult>;
  readonly onManagedPluginRollback: (
    request: ManagedPluginRollbackRequest,
  ) => Promise<ManagedPluginRollbackResult>;
  readonly onExternalPluginControl: (
    request: ExternalPluginControlRequest,
  ) => Promise<ExternalPluginControlResult>;
}

export function createDesktopWindow(
  options: DesktopWindowOptions,
): DesktopWindow {
  return options.carrierMode === 'integrated'
    ? createIntegratedDesktopWindow(options)
    : new ElectronDesktopWindow(options);
}

class ElectronDesktopWindow implements DesktopWindow {
  readonly #window: BrowserWindow;
  readonly #harnessView: WebContentsView;
  readonly #productBridge: HarnessProductBridge;
  readonly #loadingUrl: string;
  readonly #options: DesktopWindowOptions;
  #trustedOrigin: TrustedHarnessOrigin | undefined;
  #disposing = false;
  #showingHarness = false;
  #sidebarWidth: number | undefined;
  #appearance: DesktopAppearanceSnapshot | undefined;
  #locale: DesktopLocale | undefined;
  #companionState = createInitialDesktopCompanionSnapshot();
  #featurePreferences = DEFAULT_DESKTOP_FEATURE_PREFERENCES;
  #reservedRightWidth = 0;
  #layoutAnimationRevision = 0;
  #layoutAnimationTimer: ReturnType<typeof setTimeout> | undefined;
  #windowStatePublishTimer: ReturnType<typeof setTimeout> | undefined;
  #lastWindowState: DesktopWindowState | undefined;
  readonly #rendererRecovery = createRendererRecoveryPolicy(
    [250, 1_000],
    30_000,
  );
  readonly #recoveringRenderers = new Set<RendererTarget>();
  readonly #productReadiness = createProductWindowReadiness('legacy');

  constructor(options: DesktopWindowOptions) {
    this.#options = options;
    this.#loadingUrl = options.loadingUrl;
    this.#lastWindowState = options.initialWindowState;
    this.#featurePreferences = options.initialFeaturePreferences ??
      DEFAULT_DESKTOP_FEATURE_PREFERENCES;
    this.#window = new BrowserWindow(
      createDesktopWindowOptions(
        options.shellPreloadPath,
        process.platform,
        options.initialWindowState,
      ),
    );
    if (options.initialWindowState?.maximized === true) {
      this.#window.maximize();
    }
    this.#harnessView = new WebContentsView({
      webPreferences: createProductWebPreferences(options.harnessPreloadPath),
    });
    this.#productBridge = createHarnessProductBridge({
      webContents: this.#harnessView.webContents,
      viewportWidth: () => this.#window.contentView.getBounds().width,
      openExternal: (url) => void shell.openExternal(url),
      onSidebarWidth: (width) => {
        this.#sidebarWidth = width;
        this.#window.webContents.send(TOOLBAR_SIDEBAR_WIDTH_CHANNEL, width);
      },
      onAppearance: (appearance) => {
        this.#appearance = appearance;
        this.#window.webContents.send(TOOLBAR_APPEARANCE_CHANNEL, appearance);
      },
      onLocale: (locale) => {
        this.#locale = locale;
        this.#window.webContents.send(TOOLBAR_LOCALE_CHANNEL, locale);
        options.onLocale(locale);
      },
      onUpdateCommand: options.onUpdateCommand,
      onAccountBalanceRequest: options.onAccountBalanceRequest,
      onFeaturePreferencesChange: (preferences) => {
        options.onFeaturePreferencesChange(preferences);
        this.setFeaturePreferences(preferences);
      },
      onHarnessContext: options.onHarnessContext,
      onHarnessReviewIntent: options.onHarnessReviewIntent,
      onHarnessReviewResponse: (response) => this.#handleHarnessReviewResponse(response),
      onFrameHealth: (health) => {
        this.#productReadiness.acceptFrameHealth(health);
      },
      onManagedPluginPreview: options.onManagedPluginPreview,
      onManagedPluginExecute: options.onManagedPluginExecute,
      onManagedPluginInventory: options.onManagedPluginInventory,
      onManagedPluginRemove: options.onManagedPluginRemove,
      onManagedPluginSetEnabled: options.onManagedPluginSetEnabled,
      onManagedPluginRollback: options.onManagedPluginRollback,
      onExternalPluginControl: options.onExternalPluginControl,
    });
    this.#productBridge.setFeaturePreferences(this.#featurePreferences);
    this.#window.contentView.addChildView(this.#harnessView);
    this.#harnessView.setVisible(false);
    this.#layoutHarnessView();

    this.#window.once('ready-to-show', () => {
      this.#window.show();
      this.#scheduleWindowStatePublish();
    });
    this.#window.on('resize', () => {
      this.#layoutHarnessView();
      this.#scheduleWindowStatePublish();
    });
    this.#window.on('move', () => this.#scheduleWindowStatePublish());
    this.#window.on('maximize', () => this.#scheduleWindowStatePublish());
    this.#window.on('unmaximize', () => this.#scheduleWindowStatePublish());
    this.#window.on('close', (event) => {
      if (!this.#disposing) {
        event.preventDefault();
        this.#window.hide();
      }
    });
    this.#window.webContents.on('did-finish-load', () =>
      this.#restoreToolbarState(),
    );
    this.#window.webContents.on('render-process-gone', (_event, details) => {
      void this.#recoverRenderer('toolbar', details.reason);
    });
    this.#harnessView.webContents.on(
      'did-finish-load',
      () => {
        this.#productBridge.restoreAfterLoad();
      },
    );
    this.#harnessView.webContents.on(
      'render-process-gone',
      (_event, details) => {
        void this.#recoverRenderer('harness', details.reason);
      },
    );
    this.#installLocalNavigationPolicy();
    this.#installCompanionBridge();
    this.#installWorkspaceReviewBridge();
    this.#installWorkspaceReviewShortcuts();
  }

  async showLoading(): Promise<void> {
    this.#rendererRecovery.reset('toolbar');
    this.#trustedOrigin = undefined;
    this.#productBridge.setTrustedOrigin(undefined);
    this.#productReadiness.hide();
    this.#showingHarness = false;
    this.#companionState = { ...this.#companionState, active: false, previewOpen: false, workspace: { status: 'none' } };
    this.#sendCompanionState();
    this.#harnessView.setVisible(false);
    await this.#window.loadURL(this.#loadingUrl);
  }

  async showHarness(origin: string): Promise<void> {
    const trustedOrigin = createTrustedHarnessOrigin(origin);
    const currentProductUrl = this.#harnessView.webContents.getURL();
    this.#trustedOrigin = trustedOrigin;
    this.#productBridge.setTrustedOrigin(trustedOrigin);
    this.#productReadiness.begin(trustedOrigin);
    this.#rendererRecovery.reset('harness');
    await loadProductDocument(
      () => navigateProductDocument(this.#harnessView.webContents, trustedOrigin),
      PRODUCT_DOCUMENT_NAVIGATION_TIMEOUT_MS,
      () => resetProductDocument(this.#harnessView.webContents),
      currentProductUrl !== '' && currentProductUrl !== 'about:blank',
    );
    const productState = this.#productReadiness.documentLoaded();
    if (productState.kind !== 'ready') {
      throw new Error('Legacy product window did not reach document readiness');
    }
    this.#showingHarness = true;
    this.#companionState = {
      ...this.#companionState,
      active: this.#featurePreferences.workspaceReview,
    };
    this.#sendCompanionState();
    this.#layoutHarnessView();
    this.#harnessView.webContents.focus();
    this.reveal();
  }

  async showFailure(failure: RuntimeFailure): Promise<void> {
    this.#trustedOrigin = undefined;
    this.#productBridge.setTrustedOrigin(undefined);
    this.#productReadiness.hide();
    this.#showingHarness = false;
    this.#companionState = { ...this.#companionState, active: false, previewOpen: false, workspace: { status: 'none' } };
    this.#sendCompanionState();
    this.#harnessView.setVisible(false);
    const location = new URL(this.#loadingUrl);
    location.searchParams.set('state', 'failure');
    location.searchParams.set('code', failure.code);
    await this.#window.loadURL(location.toString());
    this.reveal();
  }

  reload(): void {
    if (this.#showingHarness) {
      this.#harnessView.webContents.reload();
    } else {
      this.#window.webContents.reload();
    }
  }

  reveal(): void {
    if (this.#window.isMinimized()) {
      this.#window.restore();
    }
    this.#window.show();
    this.#window.focus();
  }

  setUpdateState(state: DesktopUpdateState): void {
    this.#productBridge.setUpdateState(state);
  }

  setFeaturePreferences(preferences: DesktopFeaturePreferences): void {
    const workspaceChanged =
      preferences.workspaceReview !== this.#featurePreferences.workspaceReview;
    this.#featurePreferences = preferences;
    this.#productBridge.setFeaturePreferences(preferences);
    if (!workspaceChanged) return;
    this.#companionState = {
      ...this.#companionState,
      active: this.#showingHarness && preferences.workspaceReview,
      ...(!preferences.workspaceReview
        ? { open: false, previewOpen: false, workspace: { status: 'none' as const } }
        : {}),
    };
    this.#sendCompanionState();
    this.#layoutHarnessView(true);
  }

  setCompanionWorkspace(state: CompanionWorkspaceSnapshot): void {
    const previous = this.#companionState;
    this.#companionState = transitionCompanionWorkspace(previous, state);
    this.#sendCompanionState();
    if (companionLayoutStateChanged(previous, this.#companionState)) {
      this.#layoutHarnessView(true);
    }
  }

  notifyWorkspaceChanged(): void {
    if (!this.#window.webContents.isDestroyed()) {
      this.#window.webContents.send(WORKSPACE_CHANGED_CHANNEL);
    }
  }

  captureWindowState(): void {
    this.#cancelWindowStatePublish();
    if (this.#lastWindowState !== undefined) {
      this.#options.onWindowStateChange?.(this.#lastWindowState);
    }
  }

  dispose(): void {
    this.#disposing = true;
    this.#cancelWindowStatePublish();
    this.#cancelLayoutAnimation();
    this.#productBridge.dispose();
    ipcMain.removeHandler(WORKSPACE_REVIEW_REQUEST_CHANNEL);
    this.#window.contentView.removeChildView(this.#harnessView);
    // Harness may install beforeunload guards for drafts. Application shutdown
    // has already stopped the owned Runtime, so a renderer prompt cannot save
    // anything and would strand the hidden Electron main process in a native
    // modal loop.
    this.#harnessView.webContents.once('will-prevent-unload', (event) => {
      event.preventDefault();
    });
    this.#harnessView.webContents.close({ waitForBeforeUnload: false });
    this.#window.destroy();
  }

  #publishWindowState(): void {
    if (
      this.#window.isDestroyed() ||
      this.#window.isMinimized() ||
      this.#window.isFullScreen()
    ) return;
    this.#lastWindowState = {
      bounds: this.#window.getNormalBounds(),
      maximized: this.#window.isMaximized(),
    };
    this.#options.onWindowStateChange?.(this.#lastWindowState);
  }

  #scheduleWindowStatePublish(): void {
    this.#cancelWindowStatePublish();
    this.#windowStatePublishTimer = setTimeout(() => {
      this.#windowStatePublishTimer = undefined;
      this.#publishWindowState();
    }, 0);
    this.#windowStatePublishTimer.unref();
  }

  #cancelWindowStatePublish(): void {
    if (this.#windowStatePublishTimer !== undefined) {
      clearTimeout(this.#windowStatePublishTimer);
      this.#windowStatePublishTimer = undefined;
    }
  }

  async #recoverRenderer(target: RendererTarget, reason: string): Promise<void> {
    if (this.#disposing || this.#recoveringRenderers.has(target)) {
      return;
    }
    this.#recoveringRenderers.add(target);
    this.#options.onRendererCrash(target, reason);
    try {
      while (!this.#disposing) {
        const delayMs = this.#rendererRecovery.nextDelay(target);
        if (delayMs === undefined) {
          await this.showFailure({
            code: 'renderer-crashed',
            message: `${target} renderer repeatedly crashed: ${reason}`,
          });
          return;
        }
        await delay(delayMs);
        try {
          if (target === 'toolbar') {
            const currentUrl = this.#window.webContents.getURL();
            await this.#window.loadURL(
              isLocalRendererNavigation(this.#loadingUrl, currentUrl)
                ? currentUrl
                : this.#loadingUrl,
            );
          } else {
            const trustedOrigin = this.#trustedOrigin;
            if (!this.#showingHarness || trustedOrigin === undefined) {
              return;
            }
            this.#harnessView.setVisible(false);
            await this.#harnessView.webContents.loadURL(trustedOrigin);
            this.#layoutHarnessView();
            if (this.#harnessView.getVisible()) this.#harnessView.webContents.focus();
          }
          return;
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
          this.#options.onRendererCrash(target, reason);
        }
      }
    } finally {
      this.#recoveringRenderers.delete(target);
    }
  }

  #installLocalNavigationPolicy(): void {
    this.#window.webContents.on('will-navigate', (event, target) => {
      const localAction = classifyLocalAction(target);
      if (localAction !== undefined) {
        event.preventDefault();
        this.#performLocalAction(localAction);
        return;
      }
      if (isLocalRendererNavigation(this.#loadingUrl, target)) {
        return;
      }
      event.preventDefault();
    });
    this.#window.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
  }

  #restoreToolbarState(): void {
    if (this.#sidebarWidth !== undefined) {
      this.#window.webContents.send(
        TOOLBAR_SIDEBAR_WIDTH_CHANNEL,
        this.#sidebarWidth,
      );
    }
    if (this.#appearance !== undefined) {
      this.#window.webContents.send(
        TOOLBAR_APPEARANCE_CHANNEL,
        this.#appearance,
      );
    }
    if (this.#locale !== undefined) {
      this.#window.webContents.send(TOOLBAR_LOCALE_CHANNEL, this.#locale);
    }
    this.#sendCompanionState();
  }

  #installCompanionBridge(): void {
    this.#window.webContents.on('ipc-message', (_event, channel, value: unknown) => {
      if (channel === SHELL_CLIPBOARD_WRITE_CHANNEL) {
        const text = validatedShellClipboardText(value);
        if (text !== undefined) clipboard.writeText(text);
        return;
      }
      if (channel === WORKSPACE_REFERENCE_FROM_SHELL_CHANNEL) {
        const reference = validatedWorkspaceConversationReference(value);
        const workspace = this.#companionState.workspace;
        if (
          reference === undefined ||
          workspace.status !== 'ready' ||
          reference.sessionId !== workspace.sessionId ||
          reference.workspaceId !== workspace.workspaceId ||
          this.#harnessView.webContents.isDestroyed()
        ) return;
        this.#harnessView.webContents.send(
          WORKSPACE_REFERENCE_TO_HARNESS_CHANNEL,
          workspaceConversationInsertion(reference),
        );
        if (this.#companionState.previewOpen) {
          this.#companionState = { ...this.#companionState, previewOpen: false };
          this.#sendCompanionState();
          this.#layoutHarnessView(true);
        }
        this.#harnessView.webContents.focus();
        return;
      }
      if (channel !== COMPANION_COMMAND_CHANNEL) return;
      if (!this.#featurePreferences.workspaceReview) return;
      const command = validatedCompanionCommand(value);
      if (command === undefined) return;
      this.#companionState = transitionCompanion(this.#companionState, command);
      this.#sendCompanionState();
      this.#layoutHarnessView(command.kind === 'toggle');
    });
  }

  #installWorkspaceReviewBridge(): void {
    ipcMain.removeHandler(WORKSPACE_REVIEW_REQUEST_CHANNEL);
    ipcMain.handle(WORKSPACE_REVIEW_REQUEST_CHANNEL, async (event, value: unknown) => {
      if (
        event.sender !== this.#window.webContents ||
        event.senderFrame !== this.#window.webContents.mainFrame
      ) return { kind: 'unavailable', reason: 'no-workspace' };
      const request = validatedWorkspaceReviewRequest(value);
      if (request === undefined) return { kind: 'unavailable', reason: 'invalid-node' };
      return this.#options.onWorkspaceReviewRequest(request);
    });
  }

  #installWorkspaceReviewShortcuts(): void {
    this.#harnessView.webContents.on('before-input-event', (event, input) => {
      if (!this.#featurePreferences.workspaceReview) return;
      if (input.type !== 'keyDown') return;
      const shortcut = workspaceReviewShortcut(input);
      if (shortcut === undefined || shortcut === 'close-preview') return;
      if (shortcut === 'preview-find' && !this.#companionState.previewOpen) return;
      event.preventDefault();
      const deliver = (): void => {
        if (this.#window.webContents.isDestroyed()) return;
        this.#window.webContents.send(WORKSPACE_REVIEW_SHORTCUT_CHANNEL, shortcut);
      };
      if (
        (shortcut === 'file-search' || shortcut === 'preview-find') &&
        !this.#window.webContents.isFocused()
      ) {
        // WebContentsView -> BrowserWindow focus transitions do not always emit
        // a later `focus` event. Waiting for that event can silently discard the
        // shortcut, so request focus and deliver immediately; the renderer then
        // focuses the actual search control.
        this.#window.webContents.focus();
      }
      deliver();
    });
  }

  #handleHarnessReviewResponse(response: WorkspaceReviewResponse): void {
    if (
      response.kind !== 'preview' ||
      !this.#featurePreferences.workspaceReview ||
      this.#disposing ||
      this.#window.webContents.isDestroyed()
    ) return;
    this.#companionState = { ...this.#companionState, open: true, previewOpen: true };
    this.#sendCompanionState();
    this.#layoutHarnessView(true);
    this.#window.webContents.send(SHELL_REVIEW_TARGET_CHANNEL, response);
  }

  #sendCompanionState(): void {
    if (!this.#window.webContents.isDestroyed()) {
      this.#window.webContents.send(COMPANION_STATE_CHANNEL, this.#companionState);
    }
  }

  #layoutHarnessView(animate = false): void {
    const { width, height } = this.#window.contentView.getBounds();
    const layout = companionLayout(
      width,
      this.#showingHarness && this.#companionState.open,
      this.#showingHarness && this.#companionState.previewOpen,
      this.#companionState.panelWidth,
    );
    const { reviewFocus, reservedWidth: target } = layout;
    if (!animate || reviewFocus || !this.#showingHarness) {
      this.#cancelLayoutAnimation();
      this.#applyHarnessLayout(target, reviewFocus, width, height);
      return;
    }
    this.#animateHarnessLayout(target, width, height);
  }

  #animateHarnessLayout(target: number, width: number, height: number): void {
    this.#cancelLayoutAnimation();
    const revision = ++this.#layoutAnimationRevision;
    const startedAt = Date.now();
    const from = this.#reservedRightWidth;
    this.#harnessView.setVisible(this.#showingHarness);
    const frame = (): void => {
      if (this.#disposing || revision !== this.#layoutAnimationRevision) return;
      const progress = Math.min(1, (Date.now() - startedAt) / COMPANION_LAYOUT_ANIMATION_MS);
      this.#applyHarnessLayout(animatedReservedWidth(from, target, progress), false, width, height);
      if (progress < 1) this.#layoutAnimationTimer = setTimeout(frame, 16);
      else this.#layoutAnimationTimer = undefined;
    };
    frame();
  }

  #applyHarnessLayout(reserved: number, reviewFocus: boolean, width: number, height: number): void {
    this.#reservedRightWidth = reserved;
    this.#harnessView.setVisible(this.#showingHarness && !reviewFocus);
    this.#harnessView.setBounds(harnessContentBounds({ width, height }, reserved));
  }

  #cancelLayoutAnimation(): void {
    this.#layoutAnimationRevision += 1;
    if (this.#layoutAnimationTimer !== undefined) clearTimeout(this.#layoutAnimationTimer);
    this.#layoutAnimationTimer = undefined;
  }

  #performLocalAction(
    action: 'retry' | 'open-logs' | 'copy-diagnostics' | 'export-diagnostics',
  ): void {
    const callbacks = {
      retry: this.#options.onRetry,
      'open-logs': this.#options.onOpenLogs,
      'copy-diagnostics': this.#options.onCopyDiagnostics,
      'export-diagnostics': this.#options.onExportDiagnostics,
    };
    callbacks[action]();
  }

}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isLocalRendererNavigation(rendererUrl: string, target: string): boolean {
  try {
    const renderer = new URL(rendererUrl);
    const candidate = new URL(target);
    return (
      candidate.protocol === renderer.protocol &&
      candidate.origin === renderer.origin &&
      candidate.pathname === renderer.pathname
    );
  } catch {
    return false;
  }
}
