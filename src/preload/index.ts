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

let updateState: DesktopUpdateState = {
  status: 'disabled',
  currentVersion: '0.0.0',
};
const updateListeners = new Set<(state: DesktopUpdateState) => void>();
let balanceState: AccountBalanceSnapshot = { status: 'loading' };
const balanceListeners = new Set<(state: AccountBalanceSnapshot) => void>();

ipcRenderer.on(ACCOUNT_BALANCE_STATE_CHANNEL, (_event, value: unknown) => {
  const snapshot = validatedAccountBalanceSnapshot(value);
  if (snapshot === undefined) return;
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

function normalizedColor(value: string): string | undefined {
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.style.display = 'none';
  document.body.append(probe);
  const color = window.getComputedStyle(probe).color;
  probe.remove();
  return color === '' ? undefined : color;
}

function explicitChromeColor(token: string): string | undefined {
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
  if (sidebarBackground === undefined || contentBackground === undefined) {
    return undefined;
  }
  const rootScheme = window.getComputedStyle(document.documentElement).colorScheme;
  return {
    colorScheme:
      document.body.hasAttribute('data-ds-dark-theme') ||
      rootScheme.startsWith('dark')
        ? 'dark'
        : 'light',
    sidebarBackground,
    contentBackground,
  };
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
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-ds-dark-theme'],
    childList: true,
    subtree: true,
  });
  schedule();
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

window.addEventListener('DOMContentLoaded', () => {
  installHarnessSidebarObserver();
  installHarnessAppearanceObserver();
  installHarnessUpdateButton();
});
