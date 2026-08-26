import type { BrowserWindow, WebContents } from 'electron';

import {
  ACCOUNT_BALANCE_REQUEST_CHANNEL,
  ACCOUNT_BALANCE_STATE_CHANNEL,
  type AccountBalanceSnapshot,
} from '../../shared/account-balance.js';
import {
  HARNESS_APPEARANCE_CHANNEL,
  type DesktopAppearanceSnapshot,
  validatedAppearanceSnapshot,
} from '../../shared/appearance-sync.js';
import {
  HARNESS_LOCALE_CHANNEL,
  type DesktopLocale,
  validatedDesktopLocale,
} from '../../shared/locale-sync.js';
import {
  HARNESS_CONTEXT_CHANNEL,
  type HarnessContextSnapshot,
  validatedHarnessContext,
} from '../../shared/desktop-companion.js';
import {
  DESKTOP_FRAME_HEALTH_CHANNEL,
  type DesktopFrameHealth,
  validatedDesktopFrameHealth,
} from '../../shared/desktop-frame-health.js';
import {
  HARNESS_REVIEW_INTENT_CHANNEL,
  type ChangedFileReviewIntent,
  type WorkspaceReviewResponse,
  validatedChangedFileReviewIntent,
} from '../../shared/workspace-review.js';
import {
  HARNESS_SIDEBAR_WIDTH_CHANNEL,
  validatedSidebarWidth,
} from '../../shared/sidebar-width-sync.js';
import {
  UPDATE_COMMAND_CHANNEL,
  UPDATE_STATE_CHANNEL,
  type DesktopUpdateState,
  type UpdateCommand,
  validatedUpdateCommand,
} from '../../shared/update-bridge.js';
import {
  classifyNavigation,
  type TrustedHarnessOrigin,
} from './trusted-navigation.js';
import {
  MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL,
  MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL,
  MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL,
  MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL,
  type ManagedPluginExecuteRequest,
  type ManagedPluginExecuteResult,
  type ManagedPluginPreviewRequest,
  type ManagedPluginPreviewResult,
  validatedManagedPluginPreviewRequest,
  validatedManagedPluginPreviewResult,
  validatedManagedPluginExecuteRequest,
  validatedManagedPluginExecuteResult,
} from '../../shared/managed-plugin-preview.js';
import {
  MANAGED_PLUGIN_INVENTORY_REQUEST_CHANNEL,
  MANAGED_PLUGIN_INVENTORY_RESULT_CHANNEL,
  MANAGED_PLUGIN_REMOVE_REQUEST_CHANNEL,
  MANAGED_PLUGIN_REMOVE_RESULT_CHANNEL,
  MANAGED_PLUGIN_SET_ENABLED_REQUEST_CHANNEL,
  MANAGED_PLUGIN_SET_ENABLED_RESULT_CHANNEL,
  MANAGED_PLUGIN_ROLLBACK_REQUEST_CHANNEL,
  MANAGED_PLUGIN_ROLLBACK_RESULT_CHANNEL,
  EXTERNAL_PLUGIN_CONTROL_REQUEST_CHANNEL,
  EXTERNAL_PLUGIN_CONTROL_RESULT_CHANNEL,
  type ManagedPluginInventoryRequest,
  type ManagedPluginInventoryResult,
  type ManagedPluginRemoveRequest,
  type ManagedPluginRemoveResult,
  type ManagedPluginSetEnabledRequest,
  type ManagedPluginSetEnabledResult,
  type ManagedPluginRollbackRequest,
  type ManagedPluginRollbackResult,
  type ExternalPluginControlRequest,
  type ExternalPluginControlResult,
  validatedManagedPluginInventoryRequest,
  validatedManagedPluginInventoryResult,
  validatedManagedPluginRemoveRequest,
  validatedManagedPluginRemoveResult,
  validatedManagedPluginSetEnabledRequest,
  validatedManagedPluginSetEnabledResult,
  validatedManagedPluginRollbackRequest,
  validatedManagedPluginRollbackResult,
  validatedExternalPluginControlRequest,
  validatedExternalPluginControlResult,
} from '../../shared/managed-plugin-inventory.js';
import {
  DEFAULT_DESKTOP_FEATURE_PREFERENCES,
  DESKTOP_FEATURE_PREFERENCES_COMMAND_CHANNEL,
  DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL,
  type DesktopFeaturePreferences,
  validatedDesktopFeaturePreferenceCommand,
} from '../../shared/desktop-feature-preferences.js';

export interface HarnessProductBridgeOptions {
  readonly webContents: WebContents;
  readonly viewportWidth: () => number;
  readonly openExternal: (url: string) => void;
  readonly onSidebarWidth: (width: number) => void;
  readonly onAppearance: (appearance: DesktopAppearanceSnapshot) => void;
  readonly onLocale: (locale: DesktopLocale) => void;
  readonly onUpdateCommand: (command: UpdateCommand) => void;
  readonly onAccountBalanceRequest: (
    force: boolean,
  ) => Promise<AccountBalanceSnapshot>;
  readonly onFeaturePreferencesChange: (
    preferences: DesktopFeaturePreferences,
  ) => void;
  readonly onHarnessContext: (snapshot: HarnessContextSnapshot) => void;
  readonly onHarnessReviewIntent: (
    intent: ChangedFileReviewIntent,
  ) => Promise<WorkspaceReviewResponse>;
  readonly onHarnessReviewResponse: (response: WorkspaceReviewResponse) => void;
  readonly onFrameHealth: (health: DesktopFrameHealth) => void;
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

export interface HarnessProductBridge {
  setTrustedOrigin(origin: TrustedHarnessOrigin | undefined): void;
  setUpdateState(state: DesktopUpdateState): void;
  setFeaturePreferences(preferences: DesktopFeaturePreferences): void;
  restoreAfterLoad(): void;
  dispose(): void;
}

const OAUTH_PLACEHOLDER_URL = 'about:blank';
const OAUTH_PLACEHOLDER_TIMEOUT_MS = 30_000;

const oauthPlaceholderWindowOptions = {
  show: false,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  },
} as const;

export function createHarnessProductBridge(
  options: HarnessProductBridgeOptions,
): HarnessProductBridge {
  const { webContents } = options;
  let trustedOrigin: TrustedHarnessOrigin | undefined;
  let trustedOriginRevision = 0;
  let updateState: DesktopUpdateState | undefined;
  let featurePreferences = DEFAULT_DESKTOP_FEATURE_PREFERENCES;
  let balanceRequestRevision = 0;
  let lastHarnessContextRevision = -1;
  let contextRateWindowStartedAt = 0;
  let contextRateCount = 0;
  let disposed = false;
  const managedPreviewRequests = new Set<string>();
  let managedPreviewRateWindowStartedAt = 0;
  let managedPreviewRateCount = 0;
  let managedMutationActive = false;
  let managedExecuteRateWindowStartedAt = 0;
  let managedExecuteRateCount = 0;
  const managedInventoryRequests = new Set<string>();
  const oauthPlaceholderWindows = new Set<BrowserWindow>();

  const acceptContextEvent = (): boolean => {
    const now = Date.now();
    if (now - contextRateWindowStartedAt >= 1_000) {
      contextRateWindowStartedAt = now;
      contextRateCount = 0;
    }
    contextRateCount += 1;
    return contextRateCount <= 20;
  };

  const navigationDecision = (target: string) =>
    trustedOrigin === undefined
      ? 'deny' as const
      : classifyNavigation(trustedOrigin, target);

  const acceptManagedPreview = (): boolean => {
    const now = Date.now();
    if (now - managedPreviewRateWindowStartedAt >= 60_000) {
      managedPreviewRateWindowStartedAt = now;
      managedPreviewRateCount = 0;
    }
    managedPreviewRateCount += 1;
    return managedPreviewRateCount <= 4;
  };

  const sendManagedPreviewResult = (result: ManagedPluginPreviewResult): void => {
    const validated = validatedManagedPluginPreviewResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL, validated);
    }
  };

  const acceptManagedExecute = (): boolean => {
    const now = Date.now();
    if (now - managedExecuteRateWindowStartedAt >= 60_000) {
      managedExecuteRateWindowStartedAt = now;
      managedExecuteRateCount = 0;
    }
    managedExecuteRateCount += 1;
    return managedExecuteRateCount <= 3;
  };

  const sendManagedExecuteResult = (result: ManagedPluginExecuteResult): void => {
    const validated = validatedManagedPluginExecuteResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL, validated);
    }
  };

  const sendManagedInventoryResult = (result: ManagedPluginInventoryResult): void => {
    const validated = validatedManagedPluginInventoryResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(MANAGED_PLUGIN_INVENTORY_RESULT_CHANNEL, validated);
    }
  };

  const sendManagedRemoveResult = (result: ManagedPluginRemoveResult): void => {
    const validated = validatedManagedPluginRemoveResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(MANAGED_PLUGIN_REMOVE_RESULT_CHANNEL, validated);
    }
  };

  const sendManagedSetEnabledResult = (result: ManagedPluginSetEnabledResult): void => {
    const validated = validatedManagedPluginSetEnabledResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(MANAGED_PLUGIN_SET_ENABLED_RESULT_CHANNEL, validated);
    }
  };

  const sendManagedRollbackResult = (result: ManagedPluginRollbackResult): void => {
    const validated = validatedManagedPluginRollbackResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(MANAGED_PLUGIN_ROLLBACK_RESULT_CHANNEL, validated);
    }
  };

  const sendExternalControlResult = (result: ExternalPluginControlResult): void => {
    const validated = validatedExternalPluginControlResult(result);
    if (!disposed && validated !== undefined && !webContents.isDestroyed()) {
      webContents.send(EXTERNAL_PLUGIN_CONTROL_RESULT_CHANNEL, validated);
    }
  };

  const onNavigate = (event: Electron.Event, target: string): void => {
    const decision = navigationDecision(target);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'open-external') options.openExternal(target);
  };
  const onIpcMessage = (
    _event: Electron.Event,
    channel: string,
    value: unknown,
  ): void => {
    if (channel === HARNESS_SIDEBAR_WIDTH_CHANNEL) {
      const width = validatedSidebarWidth(value, options.viewportWidth());
      if (width !== undefined) options.onSidebarWidth(width);
      return;
    }
    if (channel === HARNESS_APPEARANCE_CHANNEL) {
      const appearance = validatedAppearanceSnapshot(value);
      if (appearance !== undefined) options.onAppearance(appearance);
      return;
    }
    if (channel === HARNESS_LOCALE_CHANNEL) {
      const locale = validatedDesktopLocale(value);
      if (locale !== undefined) options.onLocale(locale);
      return;
    }
    if (channel === UPDATE_COMMAND_CHANNEL) {
      const command = validatedUpdateCommand(value);
      if (command !== undefined) options.onUpdateCommand(command);
      return;
    }
    if (channel === DESKTOP_FEATURE_PREFERENCES_COMMAND_CHANNEL) {
      const command = validatedDesktopFeaturePreferenceCommand(value);
      if (command === undefined) return;
      featurePreferences = { ...featurePreferences, [command.key]: command.enabled };
      if (command.key === 'accountBalance' && !command.enabled) {
        balanceRequestRevision += 1;
      }
      options.onFeaturePreferencesChange(featurePreferences);
      if (!webContents.isDestroyed()) {
        webContents.send(DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL, featurePreferences);
      }
      return;
    }
    if (channel === HARNESS_CONTEXT_CHANNEL) {
      const snapshot = validatedHarnessContext(value);
      if (
        snapshot !== undefined &&
        snapshot.revision > lastHarnessContextRevision &&
        acceptContextEvent()
      ) {
        lastHarnessContextRevision = snapshot.revision;
        options.onHarnessContext(snapshot);
      }
      return;
    }
    if (channel === HARNESS_REVIEW_INTENT_CHANNEL) {
      const intent = validatedChangedFileReviewIntent(value);
      if (intent !== undefined) {
        void options.onHarnessReviewIntent(intent).then((response) => {
          if (!disposed) options.onHarnessReviewResponse(response);
        });
      }
      return;
    }
    if (channel === DESKTOP_FRAME_HEALTH_CHANNEL) {
      const health = validatedDesktopFrameHealth(value);
      if (health !== undefined) options.onFrameHealth(health);
      return;
    }
    if (channel === MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL) {
      const request = validatedManagedPluginPreviewRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined) {
        sendManagedPreviewResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'runtime-unavailable',
        });
        return;
      }
      if (!acceptManagedPreview() || managedPreviewRequests.size >= 1 ||
        managedPreviewRequests.has(request.requestId)) {
        sendManagedPreviewResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'busy',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedPreviewRequests.add(request.requestId);
      void options.onManagedPluginPreview(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedPreviewResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'invalid-response' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedPreviewResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'invalid-response',
          });
        })
        .finally(() => managedPreviewRequests.delete(request.requestId));
      return;
    }
    if (channel === MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL) {
      const request = validatedManagedPluginExecuteRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined) {
        sendManagedExecuteResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'runtime-unavailable',
        });
        return;
      }
      if (!acceptManagedExecute() || managedMutationActive) {
        sendManagedExecuteResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'busy',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedMutationActive = true;
      void options.onManagedPluginExecute(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedExecuteResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'failed' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedExecuteResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'failed',
          });
        })
        .finally(() => { managedMutationActive = false; });
      return;
    }
    if (channel === MANAGED_PLUGIN_INVENTORY_REQUEST_CHANNEL) {
      const request = validatedManagedPluginInventoryRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined || managedInventoryRequests.size >= 1 ||
        managedInventoryRequests.has(request.requestId)) {
        sendManagedInventoryResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: trustedOrigin === undefined ? 'runtime-unavailable' : 'invalid-response',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedInventoryRequests.add(request.requestId);
      void options.onManagedPluginInventory(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedInventoryResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'invalid-response' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedInventoryResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'invalid-response',
          });
        })
        .finally(() => managedInventoryRequests.delete(request.requestId));
      return;
    }
    if (channel === MANAGED_PLUGIN_REMOVE_REQUEST_CHANNEL) {
      const request = validatedManagedPluginRemoveRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined) {
        sendManagedRemoveResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'runtime-unavailable',
        });
        return;
      }
      if (!acceptManagedExecute() || managedMutationActive) {
        sendManagedRemoveResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'busy',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedMutationActive = true;
      void options.onManagedPluginRemove(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedRemoveResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'failed' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedRemoveResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'failed',
          });
        })
        .finally(() => { managedMutationActive = false; });
      return;
    }
    if (channel === MANAGED_PLUGIN_SET_ENABLED_REQUEST_CHANNEL) {
      const request = validatedManagedPluginSetEnabledRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined) {
        sendManagedSetEnabledResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'runtime-unavailable',
        });
        return;
      }
      if (!acceptManagedExecute() || managedMutationActive) {
        sendManagedSetEnabledResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'busy',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedMutationActive = true;
      void options.onManagedPluginSetEnabled(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedSetEnabledResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'failed' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedSetEnabledResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'failed',
          });
        })
        .finally(() => { managedMutationActive = false; });
      return;
    }
    if (channel === MANAGED_PLUGIN_ROLLBACK_REQUEST_CHANNEL) {
      const request = validatedManagedPluginRollbackRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined) {
        sendManagedRollbackResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'runtime-unavailable',
        });
        return;
      }
      if (!acceptManagedExecute() || managedMutationActive) {
        sendManagedRollbackResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'busy',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedMutationActive = true;
      void options.onManagedPluginRollback(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedRollbackResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'failed' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendManagedRollbackResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'failed',
          });
        })
        .finally(() => { managedMutationActive = false; });
      return;
    }
    if (channel === EXTERNAL_PLUGIN_CONTROL_REQUEST_CHANNEL) {
      const request = validatedExternalPluginControlRequest(value);
      if (request === undefined) return;
      if (trustedOrigin === undefined) {
        sendExternalControlResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'runtime-unavailable',
        });
        return;
      }
      if (!acceptManagedExecute() || managedMutationActive) {
        sendExternalControlResult({
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'busy',
        });
        return;
      }
      const originRevision = trustedOriginRevision;
      managedMutationActive = true;
      void options.onExternalPluginControl(request)
        .then((result) => {
          if (originRevision !== trustedOriginRevision) return;
          sendExternalControlResult(
            result.requestId === request.requestId
              ? result
              : { requestId: request.requestId, status: 'unavailable', reason: 'failed' },
          );
        })
        .catch(() => {
          if (originRevision !== trustedOriginRevision) return;
          sendExternalControlResult({
            requestId: request.requestId,
            status: 'unavailable',
            reason: 'failed',
          });
        })
        .finally(() => { managedMutationActive = false; });
      return;
    }
    if (channel !== ACCOUNT_BALANCE_REQUEST_CHANNEL || typeof value !== 'boolean') {
      return;
    }
    if (!featurePreferences.accountBalance) return;
    const revision = ++balanceRequestRevision;
    webContents.send(ACCOUNT_BALANCE_STATE_CHANNEL, { status: 'loading' });
    void options.onAccountBalanceRequest(value).then((snapshot) => {
      if (
        !disposed &&
        revision === balanceRequestRevision &&
        !webContents.isDestroyed()
      ) {
        webContents.send(ACCOUNT_BALANCE_STATE_CHANNEL, snapshot);
      }
    });
  };
  const onDownload = (event: Electron.Event): void => event.preventDefault();

  const onDidCreateWindow = (
    popup: BrowserWindow,
    details: Electron.DidCreateWindowDetails,
  ): void => {
    if (details.url !== OAUTH_PLACEHOLDER_URL) {
      popup.close();
      return;
    }
    oauthPlaceholderWindows.add(popup);
    const timeout = setTimeout(() => {
      oauthPlaceholderWindows.delete(popup);
      if (!popup.isDestroyed()) popup.close();
    }, OAUTH_PLACEHOLDER_TIMEOUT_MS);
    timeout.unref();
    const cleanup = (): void => {
      clearTimeout(timeout);
      oauthPlaceholderWindows.delete(popup);
    };
    popup.once('closed', cleanup);
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event, target) => {
      if (target === OAUTH_PLACEHOLDER_URL) return;
      event.preventDefault();
      if (navigationDecision(target) === 'open-external') {
        options.openExternal(target);
      }
      if (!popup.isDestroyed()) popup.close();
    });
  };

  webContents.on('will-navigate', onNavigate);
  webContents.on('ipc-message', onIpcMessage);
  webContents.on('did-create-window', onDidCreateWindow);
  webContents.setWindowOpenHandler(({ url }) => {
    if (trustedOrigin !== undefined && url === OAUTH_PLACEHOLDER_URL) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: oauthPlaceholderWindowOptions,
      };
    }
    if (navigationDecision(url) === 'open-external') options.openExternal(url);
    return { action: 'deny' };
  });
  webContents.session.setPermissionRequestHandler(
    (_sender, _permission, callback) => callback(false),
  );
  webContents.session.on('will-download', onDownload);

  return {
    setTrustedOrigin(origin) {
      trustedOrigin = origin;
      trustedOriginRevision += 1;
    },
    setUpdateState(state) {
      updateState = state;
      if (!webContents.isDestroyed()) webContents.send(UPDATE_STATE_CHANNEL, state);
    },
    setFeaturePreferences(preferences) {
      featurePreferences = preferences;
      if (!webContents.isDestroyed()) {
        webContents.send(DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL, preferences);
      }
    },
    restoreAfterLoad() {
      lastHarnessContextRevision = -1;
      if (updateState !== undefined && !webContents.isDestroyed()) {
        webContents.send(UPDATE_STATE_CHANNEL, updateState);
      }
      if (!webContents.isDestroyed()) {
        webContents.send(DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL, featurePreferences);
      }
    },
    dispose() {
      disposed = true;
      managedPreviewRequests.clear();
      balanceRequestRevision += 1;
      webContents.removeListener('will-navigate', onNavigate);
      webContents.removeListener('ipc-message', onIpcMessage);
      webContents.removeListener('did-create-window', onDidCreateWindow);
      webContents.session.removeListener('will-download', onDownload);
      webContents.session.setPermissionRequestHandler(null);
      for (const popup of oauthPlaceholderWindows) {
        if (!popup.isDestroyed()) popup.close();
      }
      oauthPlaceholderWindows.clear();
    },
  };
}
