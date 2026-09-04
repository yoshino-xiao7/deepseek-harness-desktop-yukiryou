import { BrowserWindow, shell } from 'electron';

import type { RuntimeFailure } from '../runtime/runtime-supervisor.js';
import type { DesktopUpdateState } from '../../shared/update-bridge.js';
import type { DesktopWindow, DesktopWindowOptions } from './desktop-window.js';
import type { DesktopFeaturePreferences } from '../../shared/desktop-feature-preferences.js';
import { createDesktopWindowOptions } from './desktop-window-options.js';
import { createHarnessProductBridge } from './harness-product-bridge.js';
import { createProductWindowReadiness, type ProductWindowState } from './product-window-readiness.js';
import { classifyLocalAction, createTrustedHarnessOrigin } from './trusted-navigation.js';
import { createWindowChromeAdapter } from './window-chrome-adapter.js';

const FRAME_HEALTH_TIMEOUT_MS = 15_000;

export function createIntegratedDesktopWindow(
  options: DesktopWindowOptions,
): DesktopWindow {
  return new IntegratedElectronDesktopWindow(options);
}

class IntegratedElectronDesktopWindow implements DesktopWindow {
  readonly #options: DesktopWindowOptions;
  readonly #recoveryWindow: BrowserWindow;
  readonly #productWindow: BrowserWindow;
  readonly #productBridge: ReturnType<typeof createHarnessProductBridge>;
  readonly #readiness = createProductWindowReadiness('integrated');
  #disposing = false;
  #showingProduct = false;
  #readyResolve: (() => void) | undefined;
  #readyReject: ((error: Error) => void) | undefined;
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
  #recoveryNavigationRevision = 0;

  constructor(options: DesktopWindowOptions) {
    this.#options = options;
    this.#recoveryWindow = new BrowserWindow(
      createDesktopWindowOptions(options.shellPreloadPath),
    );
    const chrome = createWindowChromeAdapter(process.platform);
    this.#productWindow = new BrowserWindow(
      chrome.createOptions({
        width: 1440,
        height: 900,
        minWidth: 820,
        minHeight: 600,
        preloadPath: options.harnessPreloadPath,
      }),
    );
    chrome.refreshMaterial(this.#productWindow, 'dark');
    this.#productBridge = createHarnessProductBridge({
      webContents: this.#productWindow.webContents,
      viewportWidth: () => this.#productWindow.getContentBounds().width,
      openExternal: (url) => void shell.openExternal(url),
      onSidebarWidth: () => {},
      onAppearance: () => {},
      onLocale: options.onLocale,
      onUpdateCommand: options.onUpdateCommand,
      onFeaturePreferencesChange: options.onFeaturePreferencesChange,
      onHarnessContext: options.onHarnessContext,
      onHarnessReviewIntent: options.onHarnessReviewIntent,
      onHarnessReviewResponse: () => {},
      onFrameHealth: (health) => {
        this.#settleReadiness(this.#readiness.acceptFrameHealth(health));
      },
      onManagedPluginPreview: options.onManagedPluginPreview,
      onManagedPluginExecute: options.onManagedPluginExecute,
      onManagedPluginInventory: options.onManagedPluginInventory,
      onManagedPluginRemove: options.onManagedPluginRemove,
      onManagedPluginSetEnabled: options.onManagedPluginSetEnabled,
      onManagedPluginRollback: options.onManagedPluginRollback,
      onExternalPluginControl: options.onExternalPluginControl,
    });
    this.#productBridge.setFeaturePreferences(
      options.initialFeaturePreferences ?? { workspaceReview: true },
    );
    this.#productWindow.webContents.on('did-finish-load', () => {
      this.#productBridge.restoreAfterLoad();
    });
    this.#productWindow.webContents.on('render-process-gone', (_event, details) => {
      this.#options.onRendererCrash('harness', details.reason);
      this.#settleReadiness(this.#readiness.crash(details.reason));
      if (!this.#disposing) {
        void this.showFailure({
          code: 'renderer-crashed',
          message: `Integrated product renderer crashed: ${details.reason}`,
        });
      }
    });
    this.#productWindow.on('close', (event) => {
      if (!this.#disposing) {
        event.preventDefault();
        this.#productWindow.hide();
      }
    });
    this.#recoveryWindow.on('close', (event) => {
      if (!this.#disposing) {
        event.preventDefault();
        this.#recoveryWindow.hide();
      }
    });
    this.#installRecoveryNavigation();
  }

  async showLoading(): Promise<void> {
    this.#showingProduct = false;
    this.#readiness.hide();
    this.#productBridge.setTrustedOrigin(undefined);
    this.#productWindow.hide();
    await this.#showRecoveryLocation(this.#options.loadingUrl);
  }

  async showHarness(url: string): Promise<void> {
    const trustedOrigin = createTrustedHarnessOrigin(url);
    this.#readiness.begin(trustedOrigin);
    this.#productBridge.setTrustedOrigin(trustedOrigin);
    const ready = this.#waitForReadiness();
    try {
      await this.#productWindow.loadURL(url);
      this.#settleReadiness(this.#readiness.documentLoaded());
      await ready;
    } catch (error) {
      this.#cancelReadiness();
      throw error;
    }
    this.#showingProduct = true;
    this.#recoveryWindow.hide();
    this.#revealWindow(this.#productWindow);
  }

  async showFailure(failure: RuntimeFailure): Promise<void> {
    this.#showingProduct = false;
    this.#readiness.hide();
    this.#productBridge.setTrustedOrigin(undefined);
    this.#productWindow.hide();
    const location = new URL(this.#options.loadingUrl);
    location.searchParams.set('state', 'failure');
    location.searchParams.set('code', failure.code);
    await this.#showRecoveryLocation(location.toString());
  }

  reload(): void {
    if (this.#showingProduct) this.#productWindow.webContents.reload();
    else this.#recoveryWindow.webContents.reload();
  }

  reveal(): void {
    this.#revealWindow(
      this.#showingProduct ? this.#productWindow : this.#recoveryWindow,
    );
  }

  setUpdateState(state: DesktopUpdateState): void {
    this.#productBridge.setUpdateState(state);
  }

  setFeaturePreferences(preferences: DesktopFeaturePreferences): void {
    this.#productBridge.setFeaturePreferences(preferences);
  }

  setCompanionWorkspace(): void {}

  notifyWorkspaceChanged(): void {}

  captureWindowState(): void {}

  flushStorageData(): void {
    if (!this.#productWindow.webContents.isDestroyed()) {
      this.#productWindow.webContents.session.flushStorageData();
    }
  }

  permitApplicationExit(): () => void {
    this.#disposing = true;
    return () => {
      if (!this.#productWindow.isDestroyed() || !this.#recoveryWindow.isDestroyed()) {
        this.#disposing = false;
      }
    };
  }

  dispose(): void {
    this.#disposing = true;
    this.#cancelReadiness();
    this.#productBridge.dispose();
    this.#productWindow.webContents.once('will-prevent-unload', (event) => {
      event.preventDefault();
    });
    this.#productWindow.webContents.close({ waitForBeforeUnload: false });
    this.#productWindow.destroy();
    this.#recoveryWindow.destroy();
  }

  #waitForReadiness(): Promise<void> {
    this.#cancelReadiness();
    return new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
      this.#readyTimer = setTimeout(() => {
        this.#clearReadinessWait();
        reject(new Error('Integrated Desktop Frame health handshake timed out'));
      }, FRAME_HEALTH_TIMEOUT_MS);
    });
  }

  #settleReadiness(state: ProductWindowState): void {
    if (state.kind === 'ready') {
      const resolve = this.#readyResolve;
      this.#clearReadinessWait();
      resolve?.();
    } else if (state.kind === 'crashed') {
      const reject = this.#readyReject;
      this.#clearReadinessWait();
      reject?.(new Error(state.reason));
    }
  }

  #cancelReadiness(): void {
    this.#clearReadinessWait();
  }

  #clearReadinessWait(): void {
    if (this.#readyTimer !== undefined) clearTimeout(this.#readyTimer);
    this.#readyTimer = undefined;
    this.#readyResolve = undefined;
    this.#readyReject = undefined;
  }

  #installRecoveryNavigation(): void {
    this.#recoveryWindow.webContents.on('will-navigate', (event, target) => {
      const action = classifyLocalAction(target);
      if (action !== undefined) {
        event.preventDefault();
        const callbacks = {
          retry: this.#options.onRetry,
          'open-logs': this.#options.onOpenLogs,
          'copy-diagnostics': this.#options.onCopyDiagnostics,
          'export-diagnostics': this.#options.onExportDiagnostics,
        };
        callbacks[action]();
        return;
      }
      if (!isLocalRendererNavigation(this.#options.loadingUrl, target)) {
        event.preventDefault();
      }
    });
    this.#recoveryWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  async #showRecoveryLocation(location: string): Promise<void> {
    const revision = ++this.#recoveryNavigationRevision;
    try {
      await this.#recoveryWindow.loadURL(location);
    } catch (error) {
      if (revision !== this.#recoveryNavigationRevision && isAbortedNavigation(error)) return;
      throw error;
    }
    if (revision === this.#recoveryNavigationRevision) {
      this.#revealWindow(this.#recoveryWindow);
    }
  }

  #revealWindow(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}

function isAbortedNavigation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ERR_ABORTED');
}

function isLocalRendererNavigation(rendererUrl: string, target: string): boolean {
  try {
    const renderer = new URL(rendererUrl);
    const candidate = new URL(target);
    return candidate.protocol === renderer.protocol &&
      candidate.origin === renderer.origin &&
      candidate.pathname === renderer.pathname;
  } catch {
    return false;
  }
}
