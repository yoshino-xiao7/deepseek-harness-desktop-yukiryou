import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';

import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_BALANCE_REQUEST_CHANNEL,
  ACCOUNT_BALANCE_STATE_CHANNEL,
} from '../../shared/account-balance.js';
import { HARNESS_CONTEXT_CHANNEL } from '../../shared/desktop-companion.js';
import { DESKTOP_FRAME_HEALTH_CHANNEL } from '../../shared/desktop-frame-health.js';
import { HARNESS_REVIEW_INTENT_CHANNEL } from '../../shared/workspace-review.js';
import { HARNESS_SIDEBAR_WIDTH_CHANNEL } from '../../shared/sidebar-width-sync.js';
import { UPDATE_COMMAND_CHANNEL, UPDATE_STATE_CHANNEL } from '../../shared/update-bridge.js';
import { createHarnessProductBridge } from './harness-product-bridge.js';
import { createTrustedHarnessOrigin } from './trusted-navigation.js';

class FakeSession extends EventEmitter {
  permissionHandler: ((
    sender: WebContents,
    permission: string,
    callback: (allowed: boolean) => void,
  ) => void) | null = null;

  setPermissionRequestHandler(handler: typeof this.permissionHandler): void {
    this.permissionHandler = handler;
  }
}

class FakeWebContents extends EventEmitter {
  readonly session = new FakeSession();
  readonly sent: Array<{ channel: string; value: unknown }> = [];
  windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;

  send(channel: string, value: unknown): void {
    this.sent.push({ channel, value });
  }

  isDestroyed(): boolean {
    return false;
  }

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' },
  ): void {
    this.windowOpenHandler = handler;
  }
}

describe('Harness product bridge', () => {
  it('centralizes trusted navigation, permissions and downloads', () => {
    const webContents = new FakeWebContents();
    const openExternal = vi.fn();
    const bridge = createBridge(webContents, { openExternal });
    bridge.setTrustedOrigin(
      createTrustedHarnessOrigin('http://127.0.0.1:51234'),
    );
    const sameOrigin = { preventDefault: vi.fn() };
    const external = { preventDefault: vi.fn() };

    webContents.emit('will-navigate', sameOrigin, 'http://127.0.0.1:51234/chat');
    webContents.emit('will-navigate', external, 'https://example.com/docs');
    webContents.windowOpenHandler?.({ url: 'https://example.com/popup' });

    expect(sameOrigin.preventDefault).not.toHaveBeenCalled();
    expect(external.preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledTimes(2);
    const permission = vi.fn();
    webContents.session.permissionHandler?.(
      webContents as unknown as WebContents,
      'camera',
      permission,
    );
    expect(permission).toHaveBeenCalledWith(false);
    const download = { preventDefault: vi.fn() };
    webContents.session.emit('will-download', download);
    expect(download.preventDefault).toHaveBeenCalledOnce();
  });

  it('validates and routes product messages through one interface', async () => {
    const webContents = new FakeWebContents();
    const onSidebarWidth = vi.fn();
    const onUpdateCommand = vi.fn();
    const onHarnessContext = vi.fn();
    const onFrameHealth = vi.fn();
    const onHarnessReviewResponse = vi.fn();
    const bridge = createBridge(webContents, {
      onSidebarWidth,
      onUpdateCommand,
      onHarnessContext,
      onFrameHealth,
      onHarnessReviewIntent: async () => ({ kind: 'unavailable', reason: 'no-workspace' }),
      onHarnessReviewResponse,
    });

    webContents.emit('ipc-message', {}, HARNESS_SIDEBAR_WIDTH_CHANNEL, 280);
    webContents.emit('ipc-message', {}, UPDATE_COMMAND_CHANNEL, 'check');
    webContents.emit('ipc-message', {}, HARNESS_CONTEXT_CHANNEL, {
      revision: 1,
      running: false,
    });
    webContents.emit('ipc-message', {}, HARNESS_CONTEXT_CHANNEL, {
      revision: 1,
      running: true,
    });
    webContents.emit('ipc-message', {}, DESKTOP_FRAME_HEALTH_CHANNEL, {
      protocolVersion: 1,
      status: 'ready',
      capabilities: {
        integratedChrome: true,
        resizablePanels: false,
        shellOverlay: true,
      },
    });
    webContents.emit('ipc-message', {}, HARNESS_REVIEW_INTENT_CHANNEL, 'src/app.ts');
    await Promise.resolve();

    expect(onSidebarWidth).toHaveBeenCalledWith(280);
    expect(onUpdateCommand).toHaveBeenCalledWith('check');
    expect(onHarnessContext).toHaveBeenCalledTimes(1);
    expect(onFrameHealth).toHaveBeenCalledOnce();
    expect(onHarnessReviewResponse).toHaveBeenCalledWith({
      kind: 'unavailable',
      reason: 'no-workspace',
    });

    bridge.dispose();
  });

  it('replays update state and suppresses stale async balance results after disposal', async () => {
    const webContents = new FakeWebContents();
    let resolveBalance: ((value: { status: 'unavailable'; reason: 'network' }) => void) | undefined;
    const bridge = createBridge(webContents, {
      onAccountBalanceRequest: () => new Promise((resolve) => {
        resolveBalance = resolve;
      }),
    });
    const update = { status: 'idle' as const, currentVersion: '0.2.2-beta.1' };

    bridge.setUpdateState(update);
    bridge.restoreAfterLoad();
    webContents.emit('ipc-message', {}, ACCOUNT_BALANCE_REQUEST_CHANNEL, true);
    bridge.dispose();
    resolveBalance?.({ status: 'unavailable', reason: 'network' });
    await Promise.resolve();

    expect(
      webContents.sent.filter((message) => message.channel === UPDATE_STATE_CHANNEL),
    ).toHaveLength(2);
    expect(webContents.sent.at(-1)).toEqual({
      channel: ACCOUNT_BALANCE_STATE_CHANNEL,
      value: { status: 'loading' },
    });
    expect(webContents.listenerCount('ipc-message')).toBe(0);
    expect(webContents.session.permissionHandler).toBeNull();
  });
});

function createBridge(
  webContents: FakeWebContents,
  overrides: Partial<Parameters<typeof createHarnessProductBridge>[0]> = {},
) {
  return createHarnessProductBridge({
    webContents: webContents as unknown as WebContents,
    viewportWidth: () => 1440,
    openExternal: vi.fn(),
    onSidebarWidth: vi.fn(),
    onAppearance: vi.fn(),
    onUpdateCommand: vi.fn(),
    onAccountBalanceRequest: async () => ({ status: 'unavailable', reason: 'network' }),
    onHarnessContext: vi.fn(),
    onHarnessReviewIntent: async () => ({ kind: 'unavailable', reason: 'no-workspace' }),
    onHarnessReviewResponse: vi.fn(),
    onFrameHealth: vi.fn(),
    ...overrides,
  });
}
