import { app, clipboard, dialog, Menu, shell } from 'electron';
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
import { ensureDesktopSettingsExtension } from './runtime/runtime-extension.js';
import {
  createDesktopWindow,
  type DesktopWindow,
} from './window/desktop-window.js';

const moduleDirectory = __dirname;

export class AppCoordinator {
  #window: DesktopWindow | undefined;
  #runtime: RuntimeSupervisor | undefined;
  #log: AppLog | undefined;
  #quitting = false;
  readonly #recovery = createRuntimeRecoveryPolicy([250, 1_000]);
  #recovering = false;
  #lastFailure: RuntimeFailure | undefined;

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

    const loadingLocation = rendererLocation();
    this.#window = createDesktopWindow({
      loadingUrl: loadingLocation,
      preloadPath: join(moduleDirectory, 'preload-entry.cjs'),
      onRetry: () => void this.restartRuntime(),
      onOpenLogs: () => void shell.openPath(logDirectory),
      onCopyDiagnostics: () => this.#copyDiagnostics(),
      onExportDiagnostics: () => void this.#exportDiagnostics(logDirectory),
    });
    await this.#window.showLoading();
    if (recoveredPreferences !== undefined) {
      this.#notifyPreferenceRecovery(recoveredPreferences);
    }

    const runtimeRoot = app.isPackaged
      ? join(process.resourcesPath, 'runtime')
      : join(app.getAppPath(), 'resources', 'runtime');
    await ensureDesktopSettingsExtension(runtimeHome, runtimeRoot);
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
      version: '0.1.0-rc.6',
      startupTimeoutMs: 20_000,
      shutdownTimeoutMs: 5_000,
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
  }

  #copyDiagnostics(): void {
    const failure = this.#lastFailure;
    clipboard.writeText(
      [
        `Application: ${app.name} ${app.getVersion()}`,
        `Electron: ${process.versions.electron}`,
        `Harness: 0.1.0-rc.6`,
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
          harnessVersion: '0.1.0-rc.6',
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
