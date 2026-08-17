import { BrowserWindow, shell, WebContentsView } from 'electron';

import type { RuntimeFailure } from '../runtime/runtime-supervisor.js';
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
import { createDesktopWindowOptions } from './desktop-window-options.js';
import { harnessContentBounds } from './desktop-window-layout.js';
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
  dispose(): void;
}

export interface DesktopWindowOptions {
  readonly loadingUrl: string;
  readonly preloadPath: string;
  readonly onRetry: () => void;
  readonly onOpenLogs: () => void;
  readonly onCopyDiagnostics: () => void;
  readonly onExportDiagnostics: () => void;
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

  constructor(options: DesktopWindowOptions) {
    this.#options = options;
    this.#loadingUrl = options.loadingUrl;
    this.#window = new BrowserWindow(
      createDesktopWindowOptions(options.preloadPath),
    );
    this.#harnessView = new WebContentsView({
      webPreferences: {
        preload: options.preloadPath,
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
    this.#installNavigationPolicy();
    this.#installSidebarWidthSync();
    this.#installAppearanceSync();
  }

  async showLoading(): Promise<void> {
    this.#trustedOrigin = undefined;
    this.#showingHarness = false;
    this.#harnessView.setVisible(false);
    await this.#window.loadURL(this.#loadingUrl);
  }

  async showHarness(origin: string): Promise<void> {
    const trustedOrigin = createTrustedHarnessOrigin(origin);
    this.#trustedOrigin = trustedOrigin;
    await this.#harnessView.webContents.loadURL(trustedOrigin);
    this.#showingHarness = true;
    this.#harnessView.setVisible(true);
    this.#harnessView.webContents.focus();
    this.reveal();
  }

  async showFailure(failure: RuntimeFailure): Promise<void> {
    this.#trustedOrigin = undefined;
    this.#showingHarness = false;
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

  dispose(): void {
    this.#disposing = true;
    this.#window.contentView.removeChildView(this.#harnessView);
    this.#harnessView.webContents.close();
    this.#window.destroy();
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
          this.#window.webContents.send(
            TOOLBAR_APPEARANCE_CHANNEL,
            appearance,
          );
        }
      },
    );
  }

  #layoutHarnessView(): void {
    const { width, height } = this.#window.contentView.getBounds();
    this.#harnessView.setBounds(harnessContentBounds({ width, height }));
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
