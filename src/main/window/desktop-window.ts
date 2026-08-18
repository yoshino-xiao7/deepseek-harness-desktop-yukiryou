import { BrowserWindow, ipcMain, shell, WebContentsView } from 'electron';

import type { RuntimeFailure } from '../runtime/runtime-supervisor.js';
import {
  HARNESS_REVIEW_INTENT_CHANNEL,
  SHELL_REVIEW_TARGET_CHANNEL,
  WORKSPACE_REVIEW_REQUEST_CHANNEL,
  type ChangedFileReviewIntent,
  type WorkspaceReviewRequest,
  type WorkspaceReviewResponse,
  validatedWorkspaceReviewRequest,
  validatedChangedFileReviewIntent,
} from '../../shared/workspace-review.js';
import {
  COMPANION_COMMAND_CHANNEL,
  COMPANION_PANEL_WIDTH,
  COMPANION_PREVIEW_WIDTH,
  COMPANION_STATE_CHANNEL,
  COMPANION_WIDE_REVIEW_MIN_WIDTH,
  HARNESS_CONTEXT_CHANNEL,
  type CompanionWorkspaceSnapshot,
  type DesktopCompanionSnapshot,
  type HarnessContextSnapshot,
  validatedCompanionCommand,
  validatedHarnessContext,
  transitionCompanion,
  transitionCompanionWorkspace,
} from '../../shared/desktop-companion.js';
import {
  ACCOUNT_BALANCE_REQUEST_CHANNEL,
  ACCOUNT_BALANCE_STATE_CHANNEL,
  type AccountBalanceSnapshot,
} from '../../shared/account-balance.js';
import {
  HARNESS_APPEARANCE_CHANNEL,
  TOOLBAR_APPEARANCE_CHANNEL,
  validatedAppearanceSnapshot,
} from '../../shared/appearance-sync.js';
import {
  HARNESS_SIDEBAR_WIDTH_CHANNEL,
  TOOLBAR_SIDEBAR_WIDTH_CHANNEL,
  validatedSidebarWidth,
} from '../../shared/sidebar-width-sync.js';
import {
  UPDATE_COMMAND_CHANNEL,
  UPDATE_STATE_CHANNEL,
  type DesktopUpdateState,
  type UpdateCommand,
  validatedUpdateCommand,
} from '../../shared/update-bridge.js';
import { createDesktopWindowOptions } from './desktop-window-options.js';
import {
  animatedReservedWidth,
  COMPANION_LAYOUT_ANIMATION_MS,
  harnessContentBounds,
} from './desktop-window-layout.js';
import {
  createRendererRecoveryPolicy,
  type RendererTarget,
} from './renderer-recovery-policy.js';
import {
  classifyLocalAction,
  classifyNavigation,
  createTrustedHarnessOrigin,
  type TrustedHarnessOrigin,
} from './trusted-navigation.js';

export interface DesktopWindow {
  showLoading(): Promise<void>;
  showHarness(origin: string): Promise<void>;
  showFailure(failure: RuntimeFailure): Promise<void>;
  reload(): void;
  reveal(): void;
  setUpdateState(state: DesktopUpdateState): void;
  setCompanionWorkspace(state: CompanionWorkspaceSnapshot): void;
  dispose(): void;
}

export interface DesktopWindowOptions {
  readonly loadingUrl: string;
  readonly shellPreloadPath: string;
  readonly harnessPreloadPath: string;
  readonly onRetry: () => void;
  readonly onOpenLogs: () => void;
  readonly onCopyDiagnostics: () => void;
  readonly onExportDiagnostics: () => void;
  readonly onUpdateCommand: (command: UpdateCommand) => void;
  readonly onAccountBalanceRequest: (
    force: boolean,
  ) => Promise<AccountBalanceSnapshot>;
  readonly onHarnessContext: (snapshot: HarnessContextSnapshot) => void;
  readonly onWorkspaceReviewRequest: (
    request: WorkspaceReviewRequest,
  ) => Promise<WorkspaceReviewResponse>;
  readonly onHarnessReviewIntent: (intent: ChangedFileReviewIntent) => Promise<WorkspaceReviewResponse>;
  readonly onRendererCrash: (target: RendererTarget, reason: string) => void;
}

export function createDesktopWindow(
  options: DesktopWindowOptions,
): DesktopWindow {
  return new ElectronDesktopWindow(options);
}

class ElectronDesktopWindow implements DesktopWindow {
  readonly #window: BrowserWindow;
  readonly #harnessView: WebContentsView;
  readonly #loadingUrl: string;
  readonly #options: DesktopWindowOptions;
  #trustedOrigin: TrustedHarnessOrigin | undefined;
  #disposing = false;
  #showingHarness = false;
  #sidebarWidth: number | undefined;
  #appearance: ReturnType<typeof validatedAppearanceSnapshot>;
  #updateState: DesktopUpdateState | undefined;
  #balanceRequestRevision = 0;
  #companionState: DesktopCompanionSnapshot = {
    active: false,
    open: true,
    previewOpen: false,
    workspace: { status: 'none' },
  };
  #lastHarnessContextRevision = -1;
  #contextRateWindowStartedAt = 0;
  #contextRateCount = 0;
  #reservedRightWidth = 0;
  #layoutAnimationRevision = 0;
  #layoutAnimationTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #rendererRecovery = createRendererRecoveryPolicy(
    [250, 1_000],
    30_000,
  );
  readonly #recoveringRenderers = new Set<RendererTarget>();

  constructor(options: DesktopWindowOptions) {
    this.#options = options;
    this.#loadingUrl = options.loadingUrl;
    this.#window = new BrowserWindow(
      createDesktopWindowOptions(options.shellPreloadPath),
    );
    this.#harnessView = new WebContentsView({
      webPreferences: {
        preload: options.harnessPreloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.#window.contentView.addChildView(this.#harnessView);
    this.#harnessView.setVisible(false);
    this.#layoutHarnessView();

    this.#window.once('ready-to-show', () => this.#window.show());
    this.#window.on('resize', () => this.#layoutHarnessView());
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
      () => this.#restoreHarnessState(),
    );
    this.#harnessView.webContents.on(
      'render-process-gone',
      (_event, details) => {
        void this.#recoverRenderer('harness', details.reason);
      },
    );
    this.#installNavigationPolicy();
    this.#installSidebarWidthSync();
    this.#installAppearanceSync();
    this.#installUpdateBridge();
    this.#installAccountBalanceBridge();
    this.#installCompanionBridge();
    this.#installWorkspaceReviewBridge();
    this.#installHarnessReviewIntentBridge();
  }

  async showLoading(): Promise<void> {
    this.#rendererRecovery.reset('toolbar');
    this.#trustedOrigin = undefined;
    this.#showingHarness = false;
    this.#companionState = { ...this.#companionState, active: false, previewOpen: false, workspace: { status: 'none' } };
    this.#sendCompanionState();
    this.#harnessView.setVisible(false);
    await this.#window.loadURL(this.#loadingUrl);
  }

  async showHarness(origin: string): Promise<void> {
    const trustedOrigin = createTrustedHarnessOrigin(origin);
    this.#trustedOrigin = trustedOrigin;
    this.#rendererRecovery.reset('harness');
    await this.#harnessView.webContents.loadURL(trustedOrigin);
    this.#showingHarness = true;
    this.#companionState = { ...this.#companionState, active: true };
    this.#sendCompanionState();
    this.#layoutHarnessView();
    this.#harnessView.webContents.focus();
    this.reveal();
  }

  async showFailure(failure: RuntimeFailure): Promise<void> {
    this.#trustedOrigin = undefined;
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
    this.#updateState = state;
    if (!this.#harnessView.webContents.isDestroyed()) {
      this.#harnessView.webContents.send(UPDATE_STATE_CHANNEL, state);
    }
  }

  setCompanionWorkspace(state: CompanionWorkspaceSnapshot): void {
    this.#companionState = transitionCompanionWorkspace(this.#companionState, state);
    this.#sendCompanionState();
  }

  dispose(): void {
    this.#disposing = true;
    this.#cancelLayoutAnimation();
    ipcMain.removeHandler(WORKSPACE_REVIEW_REQUEST_CHANNEL);
    this.#window.contentView.removeChildView(this.#harnessView);
    this.#harnessView.webContents.close();
    this.#window.destroy();
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

  #installNavigationPolicy(): void {
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
    this.#harnessView.webContents.on('will-navigate', (event, target) => {
      const decision = this.#navigationDecision(target);
      if (decision === 'allow') {
        return;
      }
      event.preventDefault();
      if (decision === 'open-external') {
        void shell.openExternal(target);
      }
    });
    this.#harnessView.webContents.setWindowOpenHandler(({ url }) => {
      if (this.#navigationDecision(url) === 'open-external') {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    this.#harnessView.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    this.#harnessView.webContents.session.on('will-download', (event) => {
      event.preventDefault();
    });
  }

  #installSidebarWidthSync(): void {
    this.#harnessView.webContents.on(
      'ipc-message',
      (_event, channel, value: unknown) => {
        if (channel !== HARNESS_SIDEBAR_WIDTH_CHANNEL) {
          return;
        }
        const width = validatedSidebarWidth(
          value,
          this.#window.contentView.getBounds().width,
        );
        if (width !== undefined) {
          this.#sidebarWidth = width;
          this.#window.webContents.send(
            TOOLBAR_SIDEBAR_WIDTH_CHANNEL,
            width,
          );
        }
      },
    );
  }

  #installAppearanceSync(): void {
    this.#harnessView.webContents.on(
      'ipc-message',
      (_event, channel, value: unknown) => {
        if (channel !== HARNESS_APPEARANCE_CHANNEL) {
          return;
        }
        const appearance = validatedAppearanceSnapshot(value);
        if (appearance !== undefined) {
          this.#appearance = appearance;
          this.#window.webContents.send(
            TOOLBAR_APPEARANCE_CHANNEL,
            appearance,
          );
        }
      },
    );
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
    this.#sendCompanionState();
  }

  #installUpdateBridge(): void {
    this.#harnessView.webContents.on(
      'ipc-message',
      (_event, channel, value: unknown) => {
        if (channel !== UPDATE_COMMAND_CHANNEL) return;
        const command = validatedUpdateCommand(value);
        if (command !== undefined) this.#options.onUpdateCommand(command);
      },
    );
  }

  #restoreHarnessState(): void {
    this.#lastHarnessContextRevision = -1;
    if (this.#updateState !== undefined) {
      this.#harnessView.webContents.send(UPDATE_STATE_CHANNEL, this.#updateState);
    }
  }

  #installCompanionBridge(): void {
    this.#window.webContents.on('ipc-message', (_event, channel, value: unknown) => {
      if (channel !== COMPANION_COMMAND_CHANNEL) return;
      const command = validatedCompanionCommand(value);
      if (command === undefined) return;
      this.#companionState = transitionCompanion(this.#companionState, command);
      this.#sendCompanionState();
      this.#layoutHarnessView(command.kind === 'toggle');
    });
    this.#harnessView.webContents.on('ipc-message', (_event, channel, value: unknown) => {
      if (channel !== HARNESS_CONTEXT_CHANNEL) return;
      const snapshot = validatedHarnessContext(value);
      if (snapshot === undefined || snapshot.revision <= this.#lastHarnessContextRevision || !this.#acceptContextEvent()) return;
      this.#lastHarnessContextRevision = snapshot.revision;
      this.#options.onHarnessContext(snapshot);
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

  #installHarnessReviewIntentBridge(): void {
    this.#harnessView.webContents.on('ipc-message', (_event, channel, value: unknown) => {
      if (channel !== HARNESS_REVIEW_INTENT_CHANNEL) return;
      const intent = validatedChangedFileReviewIntent(value);
      if (intent === undefined) return;
      void this.#options.onHarnessReviewIntent(intent).then((response) => {
        if (response.kind !== 'preview' || this.#disposing || this.#window.webContents.isDestroyed()) return;
        this.#companionState = { ...this.#companionState, open: true, previewOpen: true };
        this.#sendCompanionState();
        this.#layoutHarnessView(true);
        this.#window.webContents.send(SHELL_REVIEW_TARGET_CHANNEL, response);
      });
    });
  }

  #acceptContextEvent(): boolean {
    const now = Date.now();
    if (now - this.#contextRateWindowStartedAt >= 1_000) {
      this.#contextRateWindowStartedAt = now;
      this.#contextRateCount = 0;
    }
    this.#contextRateCount += 1;
    return this.#contextRateCount <= 20;
  }

  #sendCompanionState(): void {
    if (!this.#window.webContents.isDestroyed()) {
      this.#window.webContents.send(COMPANION_STATE_CHANNEL, this.#companionState);
    }
  }

  #installAccountBalanceBridge(): void {
    this.#harnessView.webContents.on(
      'ipc-message',
      (_event, channel, value: unknown) => {
        if (channel !== ACCOUNT_BALANCE_REQUEST_CHANNEL || typeof value !== 'boolean') return;
        const revision = ++this.#balanceRequestRevision;
        this.#harnessView.webContents.send(ACCOUNT_BALANCE_STATE_CHANNEL, { status: 'loading' });
        void this.#options.onAccountBalanceRequest(value).then((snapshot) => {
          if (revision === this.#balanceRequestRevision && !this.#harnessView.webContents.isDestroyed()) {
            this.#harnessView.webContents.send(ACCOUNT_BALANCE_STATE_CHANNEL, snapshot);
          }
        });
      },
    );
  }

  #layoutHarnessView(animate = false): void {
    const { width, height } = this.#window.contentView.getBounds();
    const reviewFocus = this.#showingHarness && this.#companionState.open && this.#companionState.previewOpen && width < COMPANION_WIDE_REVIEW_MIN_WIDTH;
    const panel = this.#showingHarness && this.#companionState.open ? Math.min(COMPANION_PANEL_WIDTH, Math.max(0, width - 480)) : 0;
    const preview = this.#showingHarness && this.#companionState.open && this.#companionState.previewOpen && !reviewFocus ? COMPANION_PREVIEW_WIDTH : 0;
    const target = panel + preview;
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

  #navigationDecision(target: string): 'allow' | 'open-external' | 'deny' {
    if (this.#trustedOrigin !== undefined) {
      return classifyNavigation(this.#trustedOrigin, target);
    }
    return isLocalRendererNavigation(this.#loadingUrl, target) ? 'allow' : 'deny';
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
