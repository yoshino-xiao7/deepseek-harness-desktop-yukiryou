import { ipcRenderer } from 'electron';

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

const DEFAULT_SIDEBAR_WIDTH = 280;
let pendingToolbarWidth = DEFAULT_SIDEBAR_WIDTH;
let pendingAppearance: DesktopAppearanceSnapshot | undefined;

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

window.addEventListener('DOMContentLoaded', () => {
  applyToolbarWidth();
  applyToolbarAppearance();
  installHarnessSidebarObserver();
  installHarnessAppearanceObserver();
});
