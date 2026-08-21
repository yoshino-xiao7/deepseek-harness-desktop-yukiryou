import { BrowserWindow, ipcMain, shell, WebContentsView } from 'electron';

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
  type CompanionWorkspaceSnapshot,
  type DesktopCompanionSnapshot,
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
  readonly carrierMode: DesktopCarrierMode;
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
  #companionState: DesktopCompanionSnapshot = {
    active: false,
    open: true,
    previewOpen: false,
    panelWidth: 340,
    workspace: { status: 'none' },
  };
  #reservedRightWidth = 0;
  #layoutAnimationRevision = 0;
  #layoutAnimationTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #rendererRecovery = createRendererRecoveryPolicy(
    [250, 1_000],
    30_000,
  );
  readonly #recoveringRenderers = new Set<RendererTarget>();
  readonly #productReadiness = createProductWindowReadiness('legacy');

  constructor(options: DesktopWindowOptions) {
    this.#options = options;
    this.#loadingUrl = options.loadingUrl;
    this.#window = new BrowserWindow(
      createDesktopWindowOptions(options.shellPreloadPath),
    );
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
      onUpdateCommand: options.onUpdateCommand,
      onAccountBalanceRequest: options.onAccountBalanceRequest,
      onHarnessContext: options.onHarnessContext,
      onHarnessReviewIntent: options.onHarnessReviewIntent,
      onHarnessReviewResponse: (response) => this.#handleHarnessReviewResponse(response),
      onFrameHealth: (health) => {
        this.#productReadiness.acceptFrameHealth(health);
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
      () => this.#productBridge.restoreAfterLoad(),
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
    this.#trustedOrigin = trustedOrigin;
    this.#productBridge.setTrustedOrigin(trustedOrigin);
    this.#productReadiness.begin(trustedOrigin);
    this.#rendererRecovery.reset('harness');
    await this.#harnessView.webContents.loadURL(trustedOrigin);
    const productState = this.#productReadiness.documentLoaded();
    if (productState.kind !== 'ready') {
      throw new Error('Legacy product window did not reach document readiness');
    }
    this.#showingHarness = true;
    this.#companionState = { ...this.#companionState, active: true };
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

  setCompanionWorkspace(state: CompanionWorkspaceSnapshot): void {
    const previous = this.#companionState;
    this.#companionState = transitionCompanionWorkspace(previous, state);
    this.#sendCompanionState();
    if (companionLayoutStateChanged(previous, this.#companionState)) {
      this.#layoutHarnessView(true);
    }
  }

  dispose(): void {
    this.#disposing = true;
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
    this.#sendCompanionState();
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
      if (input.type !== 'keyDown') return;
      const shortcut = workspaceReviewShortcut(input);
      if (shortcut === undefined || shortcut === 'close-preview') return;
      event.preventDefault();
      const deliver = (): void => {
        if (this.#window.webContents.isDestroyed()) return;
        this.#window.webContents.send(WORKSPACE_REVIEW_SHORTCUT_CHANNEL, shortcut);
      };
      if (shortcut === 'file-search' && !this.#window.webContents.isFocused()) {
        this.#window.webContents.once('focus', deliver);
        this.#window.webContents.focus();
      } else {
        deliver();
      }
    });
  }

  #handleHarnessReviewResponse(response: WorkspaceReviewResponse): void {
    if (
      response.kind !== 'preview' ||
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
