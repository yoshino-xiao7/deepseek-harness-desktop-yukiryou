import { contextBridge, ipcRenderer } from 'electron';

import {
  HARNESS_REVIEW_INTENT_CHANNEL,
  validatedChangedFileReviewIntent,
} from '../shared/workspace-review.js';
import {
  HARNESS_CONTEXT_CHANNEL,
  validatedHarnessContext,
} from '../shared/desktop-companion.js';
import {
  ACCOUNT_BALANCE_REQUEST_CHANNEL,
  ACCOUNT_BALANCE_STATE_CHANNEL,
  type AccountBalanceSnapshot,
  validatedAccountBalanceSnapshot,
} from '../shared/account-balance.js';

import {
  DESKTOP_CHROME_CONTENT_TOKEN,
  DESKTOP_CHROME_SIDEBAR_TOKEN,
  HARNESS_APPEARANCE_CHANNEL,
  type DesktopAppearanceSnapshot,
} from '../shared/appearance-sync.js';
import {
  HARNESS_SIDEBAR_WIDTH_CHANNEL,
  validatedSidebarWidth,
} from '../shared/sidebar-width-sync.js';
import {
  UPDATE_COMMAND_CHANNEL,
  UPDATE_STATE_CHANNEL,
  type DesktopUpdateState,
  type UpdateCommand,
  shouldShowHeaderUpdate,
  validatedUpdateState,
} from '../shared/update-bridge.js';
import {
  DESKTOP_FRAME_HEALTH_CHANNEL,
  validatedDesktopFrameHealth,
} from '../shared/desktop-frame-health.js';
import {
  WORKSPACE_REFERENCE_TO_HARNESS_CHANNEL,
  type WorkspaceConversationInsertion,
  validatedWorkspaceConversationId,
  validatedWorkspaceConversationInsertion,
} from '../shared/workspace-conversation-reference.js';
import {
  MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL,
  MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL,
  MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL,
  MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL,
  type ManagedPluginExecuteResult,
  type ManagedPluginPreviewResult,
  validatedManagedPluginExecuteRequest,
  validatedManagedPluginExecuteResult,
  validatedManagedPluginPreviewRequest,
  validatedManagedPluginPreviewResult,
} from '../shared/managed-plugin-preview.js';
import {
  MANAGED_PLUGIN_INVENTORY_REQUEST_CHANNEL,
  MANAGED_PLUGIN_INVENTORY_RESULT_CHANNEL,
  MANAGED_PLUGIN_REMOVE_REQUEST_CHANNEL,
  MANAGED_PLUGIN_REMOVE_RESULT_CHANNEL,
  MANAGED_PLUGIN_SET_ENABLED_REQUEST_CHANNEL,
  MANAGED_PLUGIN_SET_ENABLED_RESULT_CHANNEL,
  MANAGED_PLUGIN_ROLLBACK_REQUEST_CHANNEL,
  MANAGED_PLUGIN_ROLLBACK_RESULT_CHANNEL,
  type ManagedPluginInventoryResult,
  type ManagedPluginRemoveResult,
  type ManagedPluginSetEnabledResult,
  type ManagedPluginRollbackResult,
  validatedManagedPluginInventoryResult,
  validatedManagedPluginRemoveRequest,
  validatedManagedPluginRemoveResult,
  validatedManagedPluginSetEnabledRequest,
  validatedManagedPluginSetEnabledResult,
  validatedManagedPluginRollbackRequest,
  validatedManagedPluginRollbackResult,
} from '../shared/managed-plugin-inventory.js';
import { runWhenDocumentReady } from './document-readiness.js';
import { resolvedHarnessAppearance } from './harness-appearance.js';
import { HARNESS_LOCALE_CHANNEL, validatedDesktopLocale } from '../shared/locale-sync.js';

let updateState: DesktopUpdateState = {
  status: 'disabled',
  currentVersion: '0.0.0',
};

contextBridge.exposeInMainWorld('deepSeekYukiRyouPlatform', Object.freeze({
  platform: process.platform,
  architecture: process.arch,
}));
const updateListeners = new Set<(state: DesktopUpdateState) => void>();
let balanceState: AccountBalanceSnapshot = { status: 'loading' };
const balanceListeners = new Set<(state: AccountBalanceSnapshot) => void>();
const workspaceReferenceListeners = new Map<
  string,
  Set<(reference: WorkspaceConversationInsertion) => void>
>();
const pendingWorkspaceReferences = new Map<string, WorkspaceConversationInsertion[]>();
const pendingManagedPluginPreviews = new Map<
  string,
  { readonly resolve: (result: ManagedPluginPreviewResult) => void; readonly timer: ReturnType<typeof setTimeout> }
>();
const pendingManagedPluginExecutions = new Map<
  string,
  { readonly resolve: (result: ManagedPluginExecuteResult) => void; readonly timer: ReturnType<typeof setTimeout> }
>();
const pendingManagedPluginInventories = new Map<
  string,
  { readonly resolve: (result: ManagedPluginInventoryResult) => void; readonly timer: ReturnType<typeof setTimeout> }
>();
const pendingManagedPluginRemovals = new Map<
  string,
  { readonly resolve: (result: ManagedPluginRemoveResult) => void; readonly timer: ReturnType<typeof setTimeout> }
>();
const pendingManagedPluginEnabledChanges = new Map<
  string,
  { readonly resolve: (result: ManagedPluginSetEnabledResult) => void; readonly timer: ReturnType<typeof setTimeout> }
>();
const pendingManagedPluginRollbacks = new Map<
  string,
  { readonly resolve: (result: ManagedPluginRollbackResult) => void; readonly timer: ReturnType<typeof setTimeout> }
>();

ipcRenderer.on(MANAGED_PLUGIN_PREVIEW_RESULT_CHANNEL, (_event, value: unknown) => {
  const result = validatedManagedPluginPreviewResult(value);
  if (result === undefined) return;
  const pending = pendingManagedPluginPreviews.get(result.requestId);
  if (pending === undefined) return;
  pendingManagedPluginPreviews.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

ipcRenderer.on(MANAGED_PLUGIN_EXECUTE_RESULT_CHANNEL, (_event, value: unknown) => {
  const result = validatedManagedPluginExecuteResult(value);
  if (result === undefined) return;
  const pending = pendingManagedPluginExecutions.get(result.requestId);
  if (pending === undefined) return;
  pendingManagedPluginExecutions.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

ipcRenderer.on(MANAGED_PLUGIN_INVENTORY_RESULT_CHANNEL, (_event, value: unknown) => {
  const result = validatedManagedPluginInventoryResult(value);
  if (result === undefined) return;
  const pending = pendingManagedPluginInventories.get(result.requestId);
  if (pending === undefined) return;
  pendingManagedPluginInventories.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

ipcRenderer.on(MANAGED_PLUGIN_REMOVE_RESULT_CHANNEL, (_event, value: unknown) => {
  const result = validatedManagedPluginRemoveResult(value);
  if (result === undefined) return;
  const pending = pendingManagedPluginRemovals.get(result.requestId);
  if (pending === undefined) return;
  pendingManagedPluginRemovals.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

ipcRenderer.on(MANAGED_PLUGIN_SET_ENABLED_RESULT_CHANNEL, (_event, value: unknown) => {
  const result = validatedManagedPluginSetEnabledResult(value);
  if (result === undefined) return;
  const pending = pendingManagedPluginEnabledChanges.get(result.requestId);
  if (pending === undefined) return;
  pendingManagedPluginEnabledChanges.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

ipcRenderer.on(MANAGED_PLUGIN_ROLLBACK_RESULT_CHANNEL, (_event, value: unknown) => {
  const result = validatedManagedPluginRollbackResult(value);
  if (result === undefined) return;
  const pending = pendingManagedPluginRollbacks.get(result.requestId);
  if (pending === undefined) return;
  pendingManagedPluginRollbacks.delete(result.requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouPlugins', {
  inventory: (): Promise<ManagedPluginInventoryResult> => {
    const requestId = `request-${globalThis.crypto.randomUUID()}`;
    if (pendingManagedPluginInventories.size >= 1) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'invalid-response' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingManagedPluginInventories.delete(requestId);
        resolve({ requestId, status: 'unavailable', reason: 'runtime-unavailable' });
      }, 10_000);
      pendingManagedPluginInventories.set(requestId, { resolve, timer });
      ipcRenderer.send(MANAGED_PLUGIN_INVENTORY_REQUEST_CHANNEL, { requestId });
    });
  },
  remove: (value: unknown): Promise<ManagedPluginRemoveResult> => {
    const requestId = `request-${globalThis.crypto.randomUUID()}`;
    const request = validatedManagedPluginRemoveRequest(
      typeof value === 'object' && value !== null ? { ...value, requestId } : value,
    );
    if (request === undefined) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'receipt-mismatch' });
    }
    if (pendingManagedPluginRemovals.size >= 1) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'busy' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingManagedPluginRemovals.delete(requestId);
        resolve({ requestId, status: 'unavailable', reason: 'runtime-unavailable' });
      }, 6 * 60 * 1_000);
      pendingManagedPluginRemovals.set(requestId, { resolve, timer });
      ipcRenderer.send(MANAGED_PLUGIN_REMOVE_REQUEST_CHANNEL, request);
    });
  },
  setEnabled: (value: unknown): Promise<ManagedPluginSetEnabledResult> => {
    const requestId = `request-${globalThis.crypto.randomUUID()}`;
    const request = validatedManagedPluginSetEnabledRequest(
      typeof value === 'object' && value !== null ? { ...value, requestId } : value,
    );
    if (request === undefined) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'receipt-mismatch' });
    }
    if (pendingManagedPluginEnabledChanges.size >= 1) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'busy' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingManagedPluginEnabledChanges.delete(requestId);
        resolve({ requestId, status: 'unavailable', reason: 'runtime-unavailable' });
      }, 6 * 60 * 1_000);
      pendingManagedPluginEnabledChanges.set(requestId, { resolve, timer });
      ipcRenderer.send(MANAGED_PLUGIN_SET_ENABLED_REQUEST_CHANNEL, request);
    });
  },
  rollback: (value: unknown): Promise<ManagedPluginRollbackResult> => {
    const requestId = `request-${globalThis.crypto.randomUUID()}`;
    const request = validatedManagedPluginRollbackRequest(
      typeof value === 'object' && value !== null ? { ...value, requestId } : value,
    );
    if (request === undefined) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'receipt-mismatch' });
    }
    if (pendingManagedPluginRollbacks.size >= 1) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'busy' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingManagedPluginRollbacks.delete(requestId);
        resolve({ requestId, status: 'unavailable', reason: 'runtime-unavailable' });
      }, 6 * 60 * 1_000);
      pendingManagedPluginRollbacks.set(requestId, { resolve, timer });
      ipcRenderer.send(MANAGED_PLUGIN_ROLLBACK_REQUEST_CHANNEL, request);
    });
  },
  preview: (value: unknown): Promise<ManagedPluginPreviewResult> => {
    const requestId = `request-${globalThis.crypto.randomUUID()}`;
    const request = validatedManagedPluginPreviewRequest(
      typeof value === 'object' && value !== null
        ? { ...value, requestId }
        : value,
    );
    if (request === undefined) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'invalid-response' });
    }
    if (pendingManagedPluginPreviews.size >= 4) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'busy' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingManagedPluginPreviews.delete(requestId);
        resolve({ requestId, status: 'unavailable', reason: 'runtime-unavailable' });
      }, 35_000);
      pendingManagedPluginPreviews.set(requestId, { resolve, timer });
      ipcRenderer.send(MANAGED_PLUGIN_PREVIEW_REQUEST_CHANNEL, request);
    });
  },
  execute: (value: unknown): Promise<ManagedPluginExecuteResult> => {
    const requestId = `request-${globalThis.crypto.randomUUID()}`;
    const request = validatedManagedPluginExecuteRequest(
      typeof value === 'object' && value !== null
        ? { ...value, requestId }
        : value,
    );
    if (request === undefined) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'preview-unavailable' });
    }
    if (pendingManagedPluginExecutions.size >= 1) {
      return Promise.resolve({ requestId, status: 'unavailable', reason: 'busy' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingManagedPluginExecutions.delete(requestId);
        resolve({ requestId, status: 'unavailable', reason: 'runtime-unavailable' });
      }, 6 * 60 * 1_000);
      pendingManagedPluginExecutions.set(requestId, { resolve, timer });
      ipcRenderer.send(MANAGED_PLUGIN_EXECUTE_REQUEST_CHANNEL, request);
    });
  },
});

ipcRenderer.on(ACCOUNT_BALANCE_STATE_CHANNEL, (_event, value: unknown) => {
  const snapshot = validatedAccountBalanceSnapshot(value);
  if (snapshot === undefined) return;
  if (
    snapshot.status === 'loading' &&
    (balanceState.status === 'ready' || balanceState.status === 'unavailable' && balanceState.lastGood !== undefined)
  ) return;
  balanceState = snapshot;
  for (const listener of balanceListeners) listener(snapshot);
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouBalance', {
  getSnapshot: (): AccountBalanceSnapshot => balanceState,
  subscribe: (listener: (state: AccountBalanceSnapshot) => void): (() => void) => {
    balanceListeners.add(listener);
    return () => balanceListeners.delete(listener);
  },
  refresh: (force = false): void => {
    ipcRenderer.send(ACCOUNT_BALANCE_REQUEST_CHANNEL, force === true);
  },
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouContext', {
  publish: (value: unknown): void => {
    const snapshot = validatedHarnessContext(value);
    if (snapshot !== undefined) ipcRenderer.send(HARNESS_CONTEXT_CHANNEL, snapshot);
  },
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouReview', {
  openChangedFile: (value: unknown): void => {
    const intent = validatedChangedFileReviewIntent(value);
    if (intent !== undefined) ipcRenderer.send(HARNESS_REVIEW_INTENT_CHANNEL, intent);
  },
});

ipcRenderer.on(WORKSPACE_REFERENCE_TO_HARNESS_CHANNEL, (_event, value: unknown) => {
  const reference = validatedWorkspaceConversationInsertion(value);
  if (reference === undefined) return;
  const listeners = workspaceReferenceListeners.get(reference.sessionId);
  if (listeners === undefined || listeners.size === 0) {
    const pending = pendingWorkspaceReferences.get(reference.sessionId) ?? [];
    pending.push(reference);
    pendingWorkspaceReferences.set(reference.sessionId, pending.slice(-16));
    return;
  }
  for (const listener of listeners) listener(reference);
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouComposer', {
  subscribe: (
    sessionIdValue: unknown,
    listener: (reference: WorkspaceConversationInsertion) => void,
  ): (() => void) => {
    const sessionId = validatedWorkspaceConversationId(sessionIdValue);
    if (sessionId === undefined) return () => {};
    let listeners = workspaceReferenceListeners.get(sessionId);
    if (listeners === undefined) {
      listeners = new Set();
      workspaceReferenceListeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    const pending = pendingWorkspaceReferences.get(sessionId) ?? [];
    if (pending.length > 0) {
      pendingWorkspaceReferences.delete(sessionId);
      for (const reference of pending) listener(reference);
    }
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) workspaceReferenceListeners.delete(sessionId);
    };
  },
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouFrame', {
  reportHealth: (value: unknown): void => {
    const health = validatedDesktopFrameHealth(value);
    if (health !== undefined) {
      ipcRenderer.send(DESKTOP_FRAME_HEALTH_CHANNEL, health);
    }
  },
});

ipcRenderer.on(UPDATE_STATE_CHANNEL, (_event, value: unknown) => {
  const nextState = validatedUpdateState(value);
  if (nextState === undefined) return;
  updateState = nextState;
  for (const listener of updateListeners) listener(nextState);
  reconcileHarnessUpdateButton();
});

contextBridge.exposeInMainWorld('deepSeekYukiRyouUpdates', {
  getSnapshot: (): DesktopUpdateState => updateState,
  subscribe: (listener: (state: DesktopUpdateState) => void): (() => void) => {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
  },
  check: (): void => sendUpdateCommand('check'),
  install: (): void => sendUpdateCommand('install'),
  download: (): void => sendUpdateCommand('download'),
});

function sendUpdateCommand(command: UpdateCommand): void {
  ipcRenderer.send(UPDATE_COMMAND_CHANNEL, command);
}

function findHarnessFrame(): HTMLElement | undefined {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      '[style*="grid-template-columns"]',
    ),
  ];
  return candidates
    .filter((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return (
        window.getComputedStyle(candidate).display === 'grid' &&
        bounds.width >= window.innerWidth * 0.9 &&
        bounds.height >= window.innerHeight * 0.9
      );
    })
    .sort(
      (left, right) =>
        right.getBoundingClientRect().width *
          right.getBoundingClientRect().height -
        left.getBoundingClientRect().width * left.getBoundingClientRect().height,
    )[0];
}

function findHarnessSidebar(): HTMLElement | undefined {
  const sidebar = findHarnessFrame()?.firstElementChild;
  return sidebar instanceof HTMLElement ? sidebar : undefined;
}

function installHarnessSidebarObserver(): void {
  let observedSidebar: HTMLElement | undefined;
  let lastReportedWidth: number | undefined;
  const resizeObserver = new ResizeObserver(() => {
    if (observedSidebar === undefined) {
      return;
    }
    const width = validatedSidebarWidth(
      observedSidebar.getBoundingClientRect().width,
      window.innerWidth,
    );
    if (width !== undefined && width !== lastReportedWidth) {
      lastReportedWidth = width;
      ipcRenderer.send(HARNESS_SIDEBAR_WIDTH_CHANNEL, width);
    }
  });

  const bindSidebar = (): void => {
    const sidebar = findHarnessSidebar();
    if (sidebar === undefined || sidebar === observedSidebar) {
      return;
    }
    resizeObserver.disconnect();
    observedSidebar = sidebar;
    resizeObserver.observe(sidebar);
  };

  bindSidebar();
  new MutationObserver(bindSidebar).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

let appearanceColorProbe: HTMLSpanElement | undefined;

function normalizedColor(value: string): string | undefined {
  const probe = appearanceColorProbe ?? document.createElement('span');
  if (appearanceColorProbe === undefined) {
    appearanceColorProbe = probe;
    probe.dataset.desktopAppearanceProbe = 'true';
    probe.style.display = 'none';
    document.body.append(probe);
  }
  probe.style.color = value;
  const color = window.getComputedStyle(probe).color;
  return color === '' ? undefined : color;
}

function explicitChromeColor(token: string): string | undefined {
  const value = window.getComputedStyle(document.body).getPropertyValue(token);
  return value.trim() === '' ? undefined : normalizedColor(value);
}

function harnessTokenColor(token: string): string | undefined {
  const value = window.getComputedStyle(document.body).getPropertyValue(token);
  return value.trim() === '' ? undefined : normalizedColor(value);
}

function opaqueBackground(element: Element | null): string | undefined {
  let current = element;
  while (current !== null) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
      return normalizedColor(color);
    }
    current = current.parentElement;
  }
  return undefined;
}

function readHarnessAppearance(): DesktopAppearanceSnapshot | undefined {
  const frame = findHarnessFrame();
  const sidebar = frame?.firstElementChild ?? null;
  const content = frame?.children.item(1) ?? null;
  const sidebarBackground =
    explicitChromeColor(DESKTOP_CHROME_SIDEBAR_TOKEN) ??
    opaqueBackground(sidebar);
  const contentBackground =
    explicitChromeColor(DESKTOP_CHROME_CONTENT_TOKEN) ??
    opaqueBackground(content) ??
    opaqueBackground(document.body);
  const rootScheme = window.getComputedStyle(document.documentElement).colorScheme;
  const colorScheme =
      document.body.hasAttribute('data-ds-dark-theme') ||
      rootScheme.startsWith('dark')
        ? 'dark'
        : 'light';
  return resolvedHarnessAppearance({
    colorScheme,
    sidebarBackground,
    contentBackground,
    bodyBackground: opaqueBackground(document.body),
    foreground: harnessTokenColor('--dsw-alias-label-primary') ??
      normalizedColor(window.getComputedStyle(content ?? document.body).color),
    mutedForeground: harnessTokenColor('--dsw-alias-label-secondary'),
    borderColor: harnessTokenColor('--dsw-alias-border-l1'),
    accentColor: harnessTokenColor('--dsw-alias-brand-primary'),
    accentForeground: harnessTokenColor('--dsw-alias-brand-text'),
    surfaceBackground: harnessTokenColor('--dsw-alias-bg-layer-1'),
    subtleBackground: harnessTokenColor('--dsw-alias-bg-layer-2'),
    hoverBackground: harnessTokenColor('--dsw-alias-interactive-bg-hover'),
    selectedBackground: harnessTokenColor('--dsw-alias-interactive-bg-active'),
    overlayBackground: harnessTokenColor('--dsw-alias-bg-overlay'),
  });
}

function installHarnessAppearanceObserver(): void {
  let scheduled = false;
  let lastPayload: string | undefined;
  const report = (): void => {
    scheduled = false;
    const appearance = readHarnessAppearance();
    if (appearance === undefined) {
      return;
    }
    const payload = JSON.stringify(appearance);
    if (payload !== lastPayload) {
      lastPayload = payload;
      ipcRenderer.send(HARNESS_APPEARANCE_CHANNEL, appearance);
    }
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      window.requestAnimationFrame(report);
    }
  };
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.target !== appearanceColorProbe)) {
      schedule();
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-ds-dark-theme'],
    childList: true,
    subtree: true,
  });
  schedule();
}

function installHarnessLocaleObserver(): void {
  let previous: string | undefined;
  const report = (): void => {
    const locale = validatedDesktopLocale(document.documentElement.lang);
    if (locale !== undefined && locale !== previous) {
      previous = locale;
      ipcRenderer.send(HARNESS_LOCALE_CHANNEL, locale);
    }
  };
  new MutationObserver(report).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  });
  report();
}

function reconcileHarnessUpdateButton(): void {
  const existing = document.querySelector<HTMLElement>(
    '[data-dsh-desktop-update-button]',
  );
  if (!shouldShowHeaderUpdate(updateState)) {
    existing?.remove();
    return;
  }
  const sidebar = findHarnessSidebar();
  if (sidebar === undefined) {
    existing?.remove();
    return;
  }
  const button =
    existing instanceof HTMLButtonElement
      ? existing
      : document.createElement('button');
  button.dataset.dshDesktopUpdateButton = '';
  button.type = 'button';
  button.className = 'dsh-desktop-header-update';
  button.dataset.updateStatus = updateState.status;
  positionHarnessUpdateButton(button, sidebar);
  const downloaded = updateState.status === 'downloaded';
  const manual = updateState.status === 'manual';
  const language = document.documentElement.lang.toLowerCase();
  const label = downloaded
    ? language.startsWith('en')
      ? 'Restart to update'
      : '重启更新'
    : manual
      ? language.startsWith('en')
        ? 'Download update manually'
        : '手动下载更新'
    : language.startsWith('en')
      ? 'Downloading update'
      : '正在更新';
  if (button.childElementCount === 0) {
    button.append(createUpdateIcon());
  }
  button.title = label;
  button.setAttribute('aria-label', label);
  button.disabled = !downloaded && !manual;
  button.onclick = downloaded
    ? () => sendUpdateCommand('install')
    : manual
      ? () => sendUpdateCommand('download')
      : null;
  if (button.parentElement !== sidebar) {
    sidebar.append(button);
  }
}

function positionHarnessUpdateButton(
  button: HTMLButtonElement,
  sidebar: HTMLElement,
): void {
  const bounds = sidebar.getBoundingClientRect();
  button.style.left = `${String(Math.round(bounds.right - 46))}px`;
  button.style.top = `${String(Math.round(bounds.bottom - 46))}px`;
}

function createUpdateIcon(): SVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 20 20');
  icon.setAttribute('fill', 'none');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute(
    'd',
    'M10 3.25v8.5m0 0 3-3m-3 3-3-3M4.25 13.25v1.5c0 1.1.9 2 2 2h7.5c1.1 0 2-.9 2-2v-1.5',
  );
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.7');
  icon.append(path);
  return icon;
}

function installHarnessUpdateButton(): void {
  if (!document.querySelector('style[data-dsh-desktop-update-style]')) {
    const style = document.createElement('style');
    style.dataset.dshDesktopUpdateStyle = '';
    style.textContent = `
      .dsh-desktop-header-update {
        position: fixed;
        z-index: 20;
        box-sizing: border-box;
        display: grid;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 10px;
        place-items: center;
        color: #fff;
        background: var(--dsw-static-deepseek-500, #4d6bfe);
        box-shadow: 0 4px 12px rgb(38 70 180 / 22%);
        cursor: pointer;
        flex: none;
      }
      .dsh-desktop-header-update svg { width: 20px; height: 20px; }
      .dsh-desktop-header-update:hover:not(:disabled) {
        filter: brightness(.96);
        transform: translateY(-1px);
      }
      .dsh-desktop-header-update:disabled {
        cursor: default;
      }
      .dsh-desktop-header-update:focus-visible {
        outline: 2px solid rgb(77 107 254 / 38%);
        outline-offset: 2px;
      }
      .dsh-desktop-header-update[data-update-status="downloading"] {
        animation: dsh-desktop-header-update-pulse 1.1s ease-in-out infinite;
      }
      @keyframes dsh-desktop-header-update-pulse {
        0%, 100% { opacity: .5; }
        50% { opacity: 1; }
      }
    `;
    document.head.append(style);
  }
  let scheduled = false;
  let observedSidebar: HTMLElement | undefined;
  const resizeObserver = new ResizeObserver(() => schedule());
  const bindSidebar = (): void => {
    const sidebar = findHarnessSidebar();
    if (sidebar === observedSidebar) return;
    resizeObserver.disconnect();
    observedSidebar = sidebar;
    if (sidebar !== undefined) resizeObserver.observe(sidebar);
  };
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      bindSidebar();
      reconcileHarnessUpdateButton();
    });
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('resize', schedule);
  schedule();
}

runWhenDocumentReady(document, () => {
  installHarnessAppearanceObserver();
  installHarnessLocaleObserver();
  installHarnessSidebarObserver();
  installHarnessUpdateButton();
});
