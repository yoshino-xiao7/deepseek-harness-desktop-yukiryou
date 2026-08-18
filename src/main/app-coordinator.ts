import { app, clipboard, dialog, Menu, shell } from 'electron';
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
  createRuntimeSupervisor,
  type RuntimeFailure,
  type RuntimeSupervisor,
} from './runtime/runtime-supervisor.js';
import { createRuntimeRecoveryPolicy } from './runtime/runtime-recovery-policy.js';
import { createHarnessRuntimeCommand } from './runtime/runtime-command.js';
import { createRuntimeCompanionClient } from './runtime/runtime-companion-client.js';
import {
  createWorkspaceInspector,
  type WorkspaceInspector,
} from './workspace/workspace-inspector.js';
import { ensureBundledRuntimeExtensions } from './runtime/runtime-extension.js';
import {
  createAppUpdater,
  type AppUpdater,
} from './update/app-updater.js';
import { isUpdaterSupported } from './update/update-config.js';
import {
  createDesktopWindow,
  type DesktopWindow,
} from './window/desktop-window.js';
import type { UpdateCommand } from '../shared/update-bridge.js';
import type { AccountBalanceSnapshot } from '../shared/account-balance.js';
import type { HarnessContextSnapshot } from '../shared/desktop-companion.js';
import type { WorkspaceReviewRequest, WorkspaceReviewResponse } from '../shared/workspace-review.js';

const moduleDirectory = __dirname;
const RELEASE_DOWNLOAD_URL =
  'https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest';

export class AppCoordinator {
  #window: DesktopWindow | undefined;
  #runtime: RuntimeSupervisor | undefined;
  #log: AppLog | undefined;
  #updater: AppUpdater | undefined;
  #quitting = false;
  readonly #recovery = createRuntimeRecoveryPolicy([250, 1_000]);
  #recovering = false;
  #lastFailure: RuntimeFailure | undefined;
  #companionToken = '';
  #workspaceAuthorityRevision = 0;
  #workspaceInspector: WorkspaceInspector | undefined;

  async run(): Promise<void> {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on('second-instance', () => this.#window?.reveal());
    app.on('activate', () => this.#window?.reveal());
    app.on('before-quit', (event) => {
      if (!this.#quitting) {
        event.preventDefault();
        void this.quit();
      }
    });

    await app.whenReady();
    const userData = app.getPath('userData');
    const runtimeHome = join(userData, 'runtime');
    const logDirectory = join(userData, 'logs');
    await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
    this.#log = await createAppLog(logDirectory);
    const recoveredPreferences = await this.#recoverPreferences(runtimeHome);
    this.#updater = createAppUpdater({
      enabled: process.env.DSH_DESKTOP_E2E !== '1' &&
        isUpdaterSupported({
          isPackaged: app.isPackaged,
          platform: process.platform,
          architecture: process.arch,
        }),
      currentVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      onError: (error) => this.#handleUpdaterError(error),
    });

    const loadingLocation = rendererLocation();
    this.#window = createDesktopWindow({
      loadingUrl: loadingLocation,
      shellPreloadPath: join(moduleDirectory, 'shell-preload-entry.cjs'),
      harnessPreloadPath: join(moduleDirectory, 'harness-preload-entry.cjs'),
      onRetry: () => void this.restartRuntime(),
      onOpenLogs: () => void shell.openPath(logDirectory),
      onCopyDiagnostics: () => this.#copyDiagnostics(),
      onExportDiagnostics: () => void this.#exportDiagnostics(logDirectory),
      onUpdateCommand: (command) => void this.#handleUpdateCommand(command),
      onAccountBalanceRequest: (force) => this.#readAccountBalance(force),
      onHarnessContext: (snapshot) => void this.#handleHarnessContext(snapshot),
      onWorkspaceReviewRequest: (request) => this.#handleWorkspaceReviewRequest(request),
      onHarnessReviewIntent: (intent) => this.#workspaceInspector?.previewChangedPath(intent.path, intent.historicalDiff)
        ?? Promise.resolve({ kind: 'unavailable', reason: 'no-workspace' }),
      onRendererCrash: (target, reason) =>
        this.#log?.write('renderer.crashed', `target=${target} reason=${reason}`),
    });
    this.#updater.subscribe((state) => {
      this.#log?.write('update.state', JSON.stringify(state));
      this.#window?.setUpdateState(state);
    });
    await this.#window.showLoading();
    if (recoveredPreferences !== undefined) {
      this.#notifyPreferenceRecovery(recoveredPreferences);
    }

    const runtimeRoot = app.isPackaged
      ? join(process.resourcesPath, 'runtime')
      : join(app.getAppPath(), 'resources', 'runtime');
    await ensureBundledRuntimeExtensions(runtimeHome, runtimeRoot);
    const runtimeCommand = createHarnessRuntimeCommand(runtimeRoot);
    this.#runtime = createRuntimeSupervisor({
      command: runtimeCommand.command,
      args: runtimeCommand.args,
      runtimeHome,
      runtimeBinDirectories: [
        join(runtimeRoot, 'dsh', 'node_modules', '.bin'),
        join(runtimeRoot, 'node', 'bin'),
      ],
      workspaceRoot: app.getPath('documents'),
      version: '0.1.0-rc.7',
      startupTimeoutMs: 20_000,
      shutdownTimeoutMs: 5_000,
      createCompanionToken: () => {
        this.#companionToken = randomBytes(32).toString('base64url');
        return this.#companionToken;
      },
      onOutput: (stream, chunk) => {
        if (stream === 'stderr') {
          this.#log?.write('runtime.stderr', chunk);
        }
      },
    });
    this.#runtime.subscribe((state) => {
      this.#log?.write('runtime.state', JSON.stringify(state));
      if (state.kind === 'failed') {
        this.#lastFailure = state.failure;
        if (state.failure.code === 'unexpected-exit') {
          void this.#recoverRuntime(state.failure);
        } else {
          void this.#window?.showFailure(state.failure);
        }
      }
    });
    this.#installMenu(logDirectory);
    await this.#startRuntime();
    this.#updater.startAutomaticChecks();
  }

  async #readAccountBalance(force: boolean): Promise<AccountBalanceSnapshot> {
    const state = this.#runtime?.getState();
    if (state?.kind !== 'ready' || this.#companionToken === '') {
      return { status: 'unavailable', reason: 'network' };
    }
    return createRuntimeCompanionClient(this.#companionToken).readAccountBalance(
      state.origin,
      force,
    );
  }

  async #handleHarnessContext(snapshot: HarnessContextSnapshot): Promise<void> {
    const requestRevision = ++this.#workspaceAuthorityRevision;
    if (snapshot.sessionId === undefined) {
      this.#workspaceInspector = undefined;
      this.#window?.setCompanionWorkspace({ status: 'none' });
      return;
    }
    this.#window?.setCompanionWorkspace({ status: 'authorizing', running: snapshot.running });
    const state = this.#runtime?.getState();
    if (state?.kind !== 'ready' || this.#companionToken === '') {
      this.#window?.setCompanionWorkspace({ status: 'unavailable', running: snapshot.running });
      return;
    }
    const authority = await createRuntimeCompanionClient(this.#companionToken).authorizeWorkspace(
      state.origin,
      {
        sessionId: snapshot.sessionId,
        ...(snapshot.workspaceId === undefined ? {} : { workspaceId: snapshot.workspaceId }),
      },
    );
    if (requestRevision !== this.#workspaceAuthorityRevision) return;
    if (authority === undefined || (snapshot.workspaceId !== undefined && authority.workspaceId !== snapshot.workspaceId)) {
      this.#workspaceInspector = undefined;
      this.#window?.setCompanionWorkspace({ status: 'unavailable', running: snapshot.running });
      return;
    }
    this.#workspaceInspector = createWorkspaceInspector(authority.root);
    this.#window?.setCompanionWorkspace({
      status: 'ready',
      workspaceId: authority.workspaceId,
      title: authority.title,
      running: snapshot.running,
    });
  }

  async #handleWorkspaceReviewRequest(
    request: WorkspaceReviewRequest,
  ): Promise<WorkspaceReviewResponse> {
    const inspector = this.#workspaceInspector;
    if (inspector === undefined) return { kind: 'unavailable', reason: 'no-workspace' };
    if (request.kind === 'overview') return inspector.overview();
    if (request.kind === 'directory.list') return inspector.listDirectory(request.nodeId);
    if (request.kind === 'change.diff') return inspector.diff(request.nodeId);
    return inspector.preview(request.nodeId);
  }

  #copyDiagnostics(): void {
    const failure = this.#lastFailure;
    clipboard.writeText(
      [
        `Application: ${app.name} ${app.getVersion()}`,
        `Electron: ${process.versions.electron}`,
        `Harness: 0.1.0-rc.7`,
        `Architecture: ${process.arch}`,
        `Failure: ${failure?.code ?? 'none'}`,
        `Details: ${redact(failure?.message ?? 'No failure recorded')}`,
      ].join('\n'),
    );
  }

  async #recoverPreferences(runtimeHome: string): Promise<string | undefined> {
    try {
      const result = await recoverInvalidPreferences(
        join(runtimeHome, 'settings.yaml'),
      );
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
      defaultPath: join(
        app.getPath('downloads'),
        `DeepSeek-YukiRyou-Diagnostics-${timestamp}.zip`,
      ),
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
          harnessVersion: '0.1.0-rc.7',
          architecture: process.arch,
          macOSVersion: release(),
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
          detail: '自动更新仅在经过 Developer ID 签名的正式 Apple Silicon 版本中启用。',
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
        detail: '请检查网络连接，或稍后通过 GitHub Releases 手动下载。',
        buttons: ['好'],
      });
    }
  }

  #handleUpdaterError(error: Error): void {
    this.#log?.write('update.error', error.message);
  }

  async #handleUpdateCommand(command: UpdateCommand): Promise<void> {
    if (command === 'download') {
      await shell.openExternal(RELEASE_DOWNLOAD_URL);
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
      this.#handleUpdaterError(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  }

  async #installDownloadedUpdate(): Promise<void> {
    if (this.#quitting) {
      return;
    }
    this.#quitting = true;
    this.#log?.write('update.installing');
    await this.#runtime?.stop('update');
    this.#window?.dispose();
    this.#updater?.dispose();
    await this.#log?.close();
    this.#updater?.quitAndInstall();
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

  async quit(): Promise<void> {
    if (this.#quitting) {
      return;
    }
    this.#quitting = true;
    this.#log?.write('app.quit');
    await this.#runtime?.stop('quit');
    this.#window?.dispose();
    this.#updater?.dispose();
    await this.#log?.close();
    app.quit();
  }

  async #startRuntime(): Promise<void> {
    try {
      const ready = await this.#runtime?.start();
      if (ready !== undefined) {
        await this.#window?.showHarness(ready.origin);
      }
    } catch (error) {
      const state = this.#runtime?.getState();
      const failure =
        state?.kind === 'failed' ? state.failure : failureFrom(error);
      this.#log?.write('runtime.start-failed', failure.message);
      await this.#window?.showFailure(failure);
    }
  }

  #installMenu(logDirectory: string): void {
    const menu = Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Restart Harness',
            click: () => void this.restartRuntime(),
          },
          {
            label: 'Reload Harness UI',
            accelerator: 'CmdOrCtrl+R',
            click: () => this.#window?.reload(),
          },
          {
            label: 'Open Logs',
            click: () => void shell.openPath(logDirectory),
          },
          {
            label: 'Export Diagnostics…',
            click: () => void this.#exportDiagnostics(logDirectory),
          },
          {
            label: 'Check for Updates…',
            click: () => void this.#checkForUpdates(),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]);
    Menu.setApplicationMenu(menu);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rendererLocation(): string {
  const packagedRendererUrl = pathToFileURL(
    join(
      moduleDirectory,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    ),
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
