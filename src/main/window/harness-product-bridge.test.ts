import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents } from 'electron';

import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_BALANCE_REQUEST_CHANNEL,
  ACCOUNT_BALANCE_STATE_CHANNEL,
  type AccountBalanceSnapshot,
} from '../../shared/account-balance.js';
import { HARNESS_CONTEXT_CHANNEL } from '../../shared/desktop-companion.js';
import { DESKTOP_FRAME_HEALTH_CHANNEL } from '../../shared/desktop-frame-health.js';
import { HARNESS_REVIEW_INTENT_CHANNEL } from '../../shared/workspace-review.js';
import { HARNESS_SIDEBAR_WIDTH_CHANNEL } from '../../shared/sidebar-width-sync.js';
import { UPDATE_COMMAND_CHANNEL, UPDATE_STATE_CHANNEL } from '../../shared/update-bridge.js';
import { HARNESS_LOCALE_CHANNEL } from '../../shared/locale-sync.js';
import {
  MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL,
  MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL,
  MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL,
  MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL,
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
} from '../../shared/managed-plugin-inventory.js';
import {
  DESKTOP_FEATURE_PREFERENCES_COMMAND_CHANNEL,
  DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL,
} from '../../shared/desktop-feature-preferences.js';
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
  windowOpenHandler: ((details: { url: string }) => {
    action: 'allow' | 'deny';
    overrideBrowserWindowOptions?: {
      show?: boolean;
      webPreferences?: {
        nodeIntegration?: boolean;
        contextIsolation?: boolean;
        sandbox?: boolean;
        webSecurity?: boolean;
      };
    };
  }) | undefined;

  send(channel: string, value: unknown): void {
    this.sent.push({ channel, value });
  }

  isDestroyed(): boolean {
    return false;
  }

  setWindowOpenHandler(
    handler: NonNullable<FakeWebContents['windowOpenHandler']>,
  ): void {
    this.windowOpenHandler = handler;
  }
}

class FakePopupWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  readonly close = vi.fn(() => this.emit('closed'));

  isDestroyed(): boolean {
    return false;
  }
}

describe('Harness product bridge', () => {
  it('synchronizes only supported Harness locale changes to the desktop menu', () => {
    const webContents = new FakeWebContents();
    const onLocale = vi.fn();
    const bridge = createBridge(webContents, { onLocale });

    webContents.emit('ipc-message', {}, HARNESS_LOCALE_CHANNEL, 'en-GB');
    webContents.emit('ipc-message', {}, HARNESS_LOCALE_CHANNEL, 'ja-JP');

    expect(onLocale).toHaveBeenCalledTimes(1);
    expect(onLocale).toHaveBeenCalledWith('en-US');
    bridge.dispose();
  });

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

  it('permits only a sandboxed hidden placeholder for browser OAuth popups', () => {
    const webContents = new FakeWebContents();
    const openExternal = vi.fn();
    const bridge = createBridge(webContents, { openExternal });
    bridge.setTrustedOrigin(
      createTrustedHarnessOrigin('http://127.0.0.1:51234'),
    );

    expect(webContents.windowOpenHandler?.({ url: 'about:blank' })).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      },
    });
    expect(webContents.windowOpenHandler?.({ url: 'data:text/html,unsafe' })).toEqual({
      action: 'deny',
    });
    const popup = new FakePopupWindow();
    webContents.emit(
      'did-create-window',
      popup as unknown as BrowserWindow,
      { url: 'about:blank' },
    );
    const navigation = { preventDefault: vi.fn() };
    popup.webContents.emit(
      'will-navigate',
      navigation,
      'https://auth.openai.com/oauth/authorize',
    );

    expect(navigation.preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/authorize',
    );
    expect(popup.close).toHaveBeenCalledOnce();
    bridge.dispose();
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
    let resolveBalance: ((value: AccountBalanceSnapshot) => void) | undefined;
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
    resolveBalance?.({ status: 'unavailable', reason: 'network', today: { status: 'unavailable' } });
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

  it('persists feature commands and stops balance work when its switch is off', async () => {
    const webContents = new FakeWebContents();
    const onFeaturePreferencesChange = vi.fn();
    const onAccountBalanceRequest = vi.fn(async () => ({
      status: 'unavailable' as const,
      reason: 'network' as const,
      today: { status: 'unavailable' as const },
    }));
    const bridge = createBridge(webContents, {
      onFeaturePreferencesChange,
      onAccountBalanceRequest,
    });

    webContents.emit('ipc-message', {}, DESKTOP_FEATURE_PREFERENCES_COMMAND_CHANNEL, {
      key: 'accountBalance',
      enabled: false,
    });
    webContents.emit('ipc-message', {}, ACCOUNT_BALANCE_REQUEST_CHANNEL, true);

    expect(onFeaturePreferencesChange).toHaveBeenCalledWith({
      accountBalance: false,
      workspaceReview: true,
    });
    expect(onAccountBalanceRequest).not.toHaveBeenCalled();
    expect(webContents.sent).toContainEqual({
      channel: DESKTOP_FEATURE_PREFERENCES_STATE_CHANNEL,
      value: { accountBalance: false, workspaceReview: true },
    });
    bridge.dispose();
  });

  it('discards an in-flight balance result when balance is disabled', async () => {
    const webContents = new FakeWebContents();
    let resolveBalance: ((value: AccountBalanceSnapshot) => void) | undefined;
    const bridge = createBridge(webContents, {
      onAccountBalanceRequest: () => new Promise((resolve) => {
        resolveBalance = resolve;
      }),
    });

    webContents.emit('ipc-message', {}, ACCOUNT_BALANCE_REQUEST_CHANNEL, true);
    webContents.emit('ipc-message', {}, DESKTOP_FEATURE_PREFERENCES_COMMAND_CHANNEL, {
      key: 'accountBalance',
      enabled: false,
    });
    resolveBalance?.({
      status: 'ready',
      isAvailable: true,
      balances: [{ currency: 'CNY', total: '100', granted: '100', toppedUp: '0' }],
      today: {
        status: 'ready', currency: 'CNY', amount: '1', requestCount: 1,
        unpricedRequestCount: 0, partial: false, since: '2026-08-26T00:00:00.000Z',
      },
      fetchedAt: '2026-08-26T00:00:01.000Z',
      stale: false,
    });
    await Promise.resolve();

    expect(webContents.sent).not.toContainEqual({
      channel: ACCOUNT_BALANCE_STATE_CHANNEL,
      value: {
        status: 'ready',
        isAvailable: true,
        balances: [{ currency: 'CNY', total: '100', granted: '100', toppedUp: '0' }],
        today: {
          status: 'ready', currency: 'CNY', amount: '1', requestCount: 1,
          unpricedRequestCount: 0, partial: false, since: '2026-08-26T00:00:00.000Z',
        },
        fetchedAt: '2026-08-26T00:00:01.000Z',
        stale: false,
      },
    });
    bridge.dispose();
  });

  it('routes bounded managed previews and sends only validated results', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-11111111-1111-4111-8111-111111111111';
    const onManagedPluginPreview = vi.fn(async () => ({
      requestId,
      status: 'unavailable' as const,
      reason: 'not-installable' as const,
    }));
    const bridge = createBridge(webContents, { onManagedPluginPreview });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));

    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL, {
      requestId, sourceRecordId: 'dshfind', itemId: 'example', versionPreference: 'latest', ignored: 'field',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onManagedPluginPreview).toHaveBeenCalledWith({
      requestId, sourceRecordId: 'dshfind', itemId: 'example', versionPreference: 'latest',
    });
    expect(webContents.sent).toContainEqual({
      channel: MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL,
      value: { requestId, status: 'unavailable', reason: 'not-installable' },
    });
    bridge.dispose();
  });

  it('rejects excess managed preview work before calling the host', async () => {
    const webContents = new FakeWebContents();
    const onManagedPluginPreview = vi.fn(() => new Promise<never>(() => undefined));
    const bridge = createBridge(webContents, { onManagedPluginPreview });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));
    for (const suffix of ['1', '2', '3']) {
      webContents.emit('ipc-message', {}, MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL, {
        requestId: `request-00000000-0000-4000-8000-00000000000${suffix}`,
        sourceRecordId: 'dshfind', itemId: suffix, versionPreference: 'latest',
      });
    }

    expect(onManagedPluginPreview).toHaveBeenCalledTimes(1);
    expect(webContents.sent.at(-1)?.value).toMatchObject({ status: 'unavailable', reason: 'busy' });
    bridge.dispose();
  });

  it('drops a managed preview result after the trusted origin changes', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-99999999-9999-4999-8999-999999999999';
    let resolvePreview: ((value: {
      requestId: string;
      status: 'unavailable';
      reason: 'not-installable';
    }) => void) | undefined;
    const bridge = createBridge(webContents, {
      onManagedPluginPreview: () => new Promise((resolve) => { resolvePreview = resolve; }),
    });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));
    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL, {
      requestId, sourceRecordId: 'dshfind', itemId: 'example', versionPreference: 'latest',
    });
    bridge.setTrustedOrigin(undefined);
    resolvePreview?.({ requestId, status: 'unavailable', reason: 'not-installable' });
    await Promise.resolve();
    await Promise.resolve();

    expect(webContents.sent).not.toContainEqual(expect.objectContaining({
      channel: MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL,
    }));
    bridge.dispose();
  });

  it('routes one managed execution at a time through the main confirmation seam', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-77777777-7777-4777-8777-777777777777';
    const previewId = 'preview-88888888-8888-4888-8888-888888888888';
    let resolveExecution: ((value: {
      requestId: string;
      status: 'cancelled';
    }) => void) | undefined;
    const onManagedPluginExecute = vi.fn(() => new Promise<{ requestId: string; status: 'cancelled' }>((resolve) => {
      resolveExecution = resolve;
    }));
    const bridge = createBridge(webContents, { onManagedPluginExecute });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));
    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL, {
      requestId, previewId,
    });
    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL, {
      requestId: 'request-99999999-9999-4999-8999-999999999999', previewId,
    });

    expect(onManagedPluginExecute).toHaveBeenCalledOnce();
    expect(webContents.sent.at(-1)?.value).toMatchObject({ status: 'unavailable', reason: 'busy' });
    resolveExecution?.({ requestId, status: 'cancelled' });
    await Promise.resolve();
    await Promise.resolve();
    expect(webContents.sent).toContainEqual({
      channel: MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL,
      value: { requestId, status: 'cancelled' },
    });
    bridge.dispose();
  });

  it('routes a validated managed inventory snapshot without exposing profile files', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-66666666-6666-4666-8666-666666666666';
    const generation = `gen-${'a'.repeat(64)}`;
    const onManagedPluginInventory = vi.fn(async () => ({
      requestId,
      status: 'ready' as const,
      currentGeneration: generation,
      entries: [{
        packageName: '@example/dsh-tool',
        sourceId: 'dshfind',
        version: '1.2.3',
        generation,
        installedAt: '2026-08-21T12:41:40.475Z',
        enabled: true,
        rollbackTarget: null,
        lastBlockedAttempt: null,
      }],
      externalEntries: [],
    }));
    const bridge = createBridge(webContents, { onManagedPluginInventory });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));

    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_INVENTORY_REQUEST_CHANNEL, { requestId });
    await Promise.resolve();
    await Promise.resolve();

    expect(onManagedPluginInventory).toHaveBeenCalledWith({ requestId });
    expect(webContents.sent).toContainEqual({
      channel: MANAGED_PLUGIN_INVENTORY_RESULT_CHANNEL,
      value: expect.objectContaining({ requestId, status: 'ready' }),
    });
    bridge.dispose();
  });

  it('routes an exact external package action through the trusted mutation gate', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-77777777-7777-4777-8777-777777777777';
    const onExternalPluginControl = vi.fn(async () => ({
      requestId,
      status: 'prepared' as const,
      restartScheduled: true as const,
    }));
    const bridge = createBridge(webContents, { onExternalPluginControl });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));

    webContents.emit('ipc-message', {}, EXTERNAL_PLUGIN_CONTROL_REQUEST_CHANNEL, {
      requestId,
      packageName: 'dsh-grok-provider',
      version: '0.1.1',
      entryId: 'llm-grok',
      action: 'disable',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onExternalPluginControl).toHaveBeenCalledWith(expect.objectContaining({
      packageName: 'dsh-grok-provider', action: 'disable',
    }));
    expect(webContents.sent).toContainEqual({
      channel: EXTERNAL_PLUGIN_CONTROL_RESULT_CHANNEL,
      value: { requestId, status: 'prepared', restartScheduled: true },
    });
    bridge.dispose();
  });

  it('routes exact managed removal identities through the shared mutation gate', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-55555555-5555-4555-8555-555555555555';
    const onManagedPluginRemove = vi.fn(async () => ({
      requestId,
      status: 'cancelled' as const,
    }));
    const bridge = createBridge(webContents, { onManagedPluginRemove });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));

    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_REMOVE_REQUEST_CHANNEL, {
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation: `gen-${'a'.repeat(64)}`,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onManagedPluginRemove).toHaveBeenCalledWith({
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation: `gen-${'a'.repeat(64)}`,
    });
    expect(webContents.sent).toContainEqual({
      channel: MANAGED_PLUGIN_REMOVE_RESULT_CHANNEL,
      value: { requestId, status: 'cancelled' },
    });
    bridge.dispose();
  });

  it('routes exact managed enabled-state requests through the shared mutation gate', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-12345678-1234-1234-1234-123456789abc';
    const onManagedPluginSetEnabled = vi.fn(async () => ({
      requestId,
      status: 'prepared' as const,
      restartScheduled: true as const,
    }));
    const bridge = createBridge(webContents, { onManagedPluginSetEnabled });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));

    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_SET_ENABLED_REQUEST_CHANNEL, {
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation: `gen-${'a'.repeat(64)}`,
      enabled: false,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onManagedPluginSetEnabled).toHaveBeenCalledWith({
      requestId,
      packageName: '@example/dsh-tool',
      version: '1.2.3',
      generation: `gen-${'a'.repeat(64)}`,
      enabled: false,
    });
    expect(webContents.sent).toContainEqual({
      channel: MANAGED_PLUGIN_SET_ENABLED_RESULT_CHANNEL,
      value: { requestId, status: 'prepared', restartScheduled: true },
    });
    bridge.dispose();
  });

  it('routes exact managed rollback requests through the shared mutation gate', async () => {
    const webContents = new FakeWebContents();
    const requestId = 'request-22222222-2222-4222-8222-222222222222';
    const onManagedPluginRollback = vi.fn(async () => ({
      requestId,
      status: 'prepared' as const,
      restartScheduled: true as const,
    }));
    const bridge = createBridge(webContents, { onManagedPluginRollback });
    bridge.setTrustedOrigin(createTrustedHarnessOrigin('http://127.0.0.1:51234'));
    const identity = {
      requestId,
      packageName: '@example/dsh-tool',
      version: '2.0.0',
      generation: `gen-${'a'.repeat(64)}`,
    };

    webContents.emit('ipc-message', {}, MANAGED_PLUGIN_ROLLBACK_REQUEST_CHANNEL, identity);
    await Promise.resolve();
    await Promise.resolve();

    expect(onManagedPluginRollback).toHaveBeenCalledWith(identity);
    expect(webContents.sent).toContainEqual({
      channel: MANAGED_PLUGIN_ROLLBACK_RESULT_CHANNEL,
      value: { requestId, status: 'prepared', restartScheduled: true },
    });
    bridge.dispose();
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
    onLocale: vi.fn(),
    onUpdateCommand: vi.fn(),
    onAccountBalanceRequest: async () => ({
      status: 'unavailable', reason: 'network', today: { status: 'unavailable' },
    }),
    onFeaturePreferencesChange: vi.fn(),
    onHarnessContext: vi.fn(),
    onHarnessReviewIntent: async () => ({ kind: 'unavailable', reason: 'no-workspace' }),
    onHarnessReviewResponse: vi.fn(),
    onFrameHealth: vi.fn(),
    onManagedPluginPreview: async (request) => ({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'runtime-unavailable',
    }),
    onManagedPluginExecute: async (request) => ({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'runtime-unavailable',
    }),
    onManagedPluginInventory: async (request) => ({
      requestId: request.requestId,
      status: 'ready',
      currentGeneration: null,
      entries: [],
      externalEntries: [],
    }),
    onManagedPluginRemove: async (request) => ({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'runtime-unavailable',
    }),
    onManagedPluginSetEnabled: async (request) => ({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'runtime-unavailable',
    }),
    onManagedPluginRollback: async (request) => ({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'runtime-unavailable',
    }),
    onExternalPluginControl: async (request) => ({
      requestId: request.requestId,
      status: 'unavailable',
      reason: 'runtime-unavailable',
    }),
    ...overrides,
  });
}
