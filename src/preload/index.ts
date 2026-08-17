import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_CHROME_CONTENT_TOKEN,
  DESKTOP_CHROME_SIDEBAR_TOKEN,
  HARNESS_APPEARANCE_CHANNEL,
  TOOLBAR_APPEARANCE_CHANNEL,
  type DesktopAppearanceSnapshot,
  validatedAppearanceSnapshot,
} from '../shared/appearance-sync.js';
import {
  HARNESS_SIDEBAR_WIDTH_CHANNEL,
  TOOLBAR_SIDEBAR_WIDTH_CHANNEL,
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

const DEFAULT_SIDEBAR_WIDTH = 280;
let pendingToolbarWidth = DEFAULT_SIDEBAR_WIDTH;
let pendingAppearance: DesktopAppearanceSnapshot | undefined;
let updateState: DesktopUpdateState = {
  status: 'disabled',
  currentVersion: '0.0.0',
};
const updateListeners = new Set<(state: DesktopUpdateState) => void>();

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
});

function sendUpdateCommand(command: UpdateCommand): void {
  ipcRenderer.send(UPDATE_COMMAND_CHANNEL, command);
}

function applyToolbarWidth(): void {
  document.documentElement?.style.setProperty(
    '--harness-sidebar-width',
    `${pendingToolbarWidth}px`,
  );
}

ipcRenderer.on(TOOLBAR_SIDEBAR_WIDTH_CHANNEL, (_event, value: unknown) => {
  const width = validatedSidebarWidth(value, window.innerWidth);
  if (width === undefined) {
    return;
  }
  pendingToolbarWidth = width;
  applyToolbarWidth();
});

ipcRenderer.on(TOOLBAR_APPEARANCE_CHANNEL, (_event, value: unknown) => {
  const appearance = validatedAppearanceSnapshot(value);
  if (appearance === undefined) {
    return;
  }
  pendingAppearance = appearance;
  applyToolbarAppearance();
});

function applyToolbarAppearance(): void {
  if (pendingAppearance === undefined || document.documentElement === null) {
    return;
  }
  document.documentElement.dataset.appearanceScheme =
    pendingAppearance.colorScheme;
  document.documentElement.style.colorScheme = pendingAppearance.colorScheme;
  document.documentElement.style.setProperty(
    '--toolbar-sidebar-background',
    pendingAppearance.sidebarBackground,
  );
  document.documentElement.style.setProperty(
    '--toolbar-content-background',
    pendingAppearance.contentBackground,
  );
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
  const logoRow = sidebar?.firstElementChild;
  const brand = logoRow?.querySelector('button');
  if (!(logoRow instanceof HTMLElement) || !(brand instanceof HTMLButtonElement)) {
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
  const ready = updateState.status === 'downloaded';
  const language = document.documentElement.lang.toLowerCase();
  const label = ready
    ? language.startsWith('en')
      ? 'Restart to update'
      : '重启更新'
    : language.startsWith('en')
      ? 'Downloading update'
      : '正在更新';
  const buttonText = ready ? label : '•••';
  if (button.textContent !== buttonText) button.textContent = buttonText;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.disabled = !ready;
  button.onclick = ready ? () => sendUpdateCommand('install') : null;
  if (button.parentElement !== logoRow) {
    logoRow.insertBefore(button, logoRow.lastElementChild);
  }
}

function installHarnessUpdateButton(): void {
  if (!document.querySelector('style[data-dsh-desktop-update-style]')) {
    const style = document.createElement('style');
    style.dataset.dshDesktopUpdateStyle = '';
    style.textContent = `
      .dsh-desktop-header-update {
        box-sizing: border-box;
        min-width: 30px;
        height: 26px;
        padding: 0 9px;
        border: 1px solid rgb(77 107 254 / 24%);
        border-radius: 999px;
        color: var(--dsw-static-deepseek-500, #4d6bfe);
        background: rgb(77 107 254 / 10%);
        cursor: pointer;
        flex: none;
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        line-height: 24px;
      }
      .dsh-desktop-header-update:hover:not(:disabled) {
        background: rgb(77 107 254 / 17%);
      }
      .dsh-desktop-header-update:disabled {
        cursor: default;
        letter-spacing: 1px;
      }
    `;
    document.head.append(style);
  }
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      reconcileHarnessUpdateButton();
    });
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  schedule();
}

window.addEventListener('DOMContentLoaded', () => {
  applyToolbarWidth();
  applyToolbarAppearance();
  installHarnessSidebarObserver();
  installHarnessAppearanceObserver();
  installHarnessUpdateButton();
});
