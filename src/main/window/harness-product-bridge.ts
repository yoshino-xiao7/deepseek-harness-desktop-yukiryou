import type { WebContents } from 'electron';

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

export interface HarnessProductBridgeOptions {
  readonly webContents: WebContents;
  readonly viewportWidth: () => number;
  readonly openExternal: (url: string) => void;
  readonly onSidebarWidth: (width: number) => void;
  readonly onAppearance: (appearance: DesktopAppearanceSnapshot) => void;
  readonly onUpdateCommand: (command: UpdateCommand) => void;
  readonly onAccountBalanceRequest: (
    force: boolean,
  ) => Promise<AccountBalanceSnapshot>;
  readonly onHarnessContext: (snapshot: HarnessContextSnapshot) => void;
  readonly onHarnessReviewIntent: (
    intent: ChangedFileReviewIntent,
  ) => Promise<WorkspaceReviewResponse>;
  readonly onHarnessReviewResponse: (response: WorkspaceReviewResponse) => void;
  readonly onFrameHealth: (health: DesktopFrameHealth) => void;
}

export interface HarnessProductBridge {
  setTrustedOrigin(origin: TrustedHarnessOrigin | undefined): void;
  setUpdateState(state: DesktopUpdateState): void;
  restoreAfterLoad(): void;
  dispose(): void;
}

export function createHarnessProductBridge(
  options: HarnessProductBridgeOptions,
): HarnessProductBridge {
  const { webContents } = options;
  let trustedOrigin: TrustedHarnessOrigin | undefined;
  let updateState: DesktopUpdateState | undefined;
  let balanceRequestRevision = 0;
  let lastHarnessContextRevision = -1;
  let contextRateWindowStartedAt = 0;
  let contextRateCount = 0;
  let disposed = false;

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
    if (channel === UPDATE_COMMAND_CHANNEL) {
      const command = validatedUpdateCommand(value);
      if (command !== undefined) options.onUpdateCommand(command);
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
    if (channel !== ACCOUNT_BALANCE_REQUEST_CHANNEL || typeof value !== 'boolean') {
      return;
    }
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

  webContents.on('will-navigate', onNavigate);
  webContents.on('ipc-message', onIpcMessage);
  webContents.setWindowOpenHandler(({ url }) => {
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
    },
    setUpdateState(state) {
      updateState = state;
      if (!webContents.isDestroyed()) webContents.send(UPDATE_STATE_CHANNEL, state);
    },
    restoreAfterLoad() {
      lastHarnessContextRevision = -1;
      if (updateState !== undefined && !webContents.isDestroyed()) {
        webContents.send(UPDATE_STATE_CHANNEL, updateState);
      }
    },
    dispose() {
      disposed = true;
      balanceRequestRevision += 1;
      webContents.removeListener('will-navigate', onNavigate);
      webContents.removeListener('ipc-message', onIpcMessage);
      webContents.session.removeListener('will-download', onDownload);
      webContents.session.setPermissionRequestHandler(null);
    },
  };
}
