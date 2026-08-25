import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createApplicationMenuTemplate } from './application-menu-template.js';

const actions = {
  restartHarness: vi.fn(),
  reloadHarness: vi.fn(),
  openLogs: vi.fn(),
  exportDiagnostics: vi.fn(),
  checkForUpdates: vi.fn(),
};

describe('application menu template', () => {
  it('fully localizes standard macOS menu items without development commands', () => {
    const template = createApplicationMenuTemplate({
      appName: 'DeepSeek YukiRyou',
      locale: 'zh-CN',
      platform: 'darwin',
      actions,
    });

    expect(labels(template)).toEqual(expect.arrayContaining([
      '关于 DeepSeek YukiRyou', '隐藏 DeepSeek YukiRyou', '退出 DeepSeek YukiRyou',
      '撤销', '重做', '剪切', '复制', '粘贴', '最小化', '缩放', '置于最前',
      '实际大小', '放大', '缩小', '进入全屏',
    ]));
    expect(roles(template)).not.toContain('toggleDevTools');
    expect(roles(template)).not.toContain('forceReload');
    expect(roles(template).filter((role) => role === 'togglefullscreen')).toHaveLength(1);
  });

  it('uses the same explicit production-safe structure on Windows', () => {
    const template = createApplicationMenuTemplate({
      appName: 'DeepSeek YukiRyou',
      locale: 'en-US',
      platform: 'win32',
      actions,
    });

    expect(labels(template)).toEqual(expect.arrayContaining([
      'Edit', 'View', 'Window', 'Help', 'Undo', 'Paste', 'Minimize', 'Close',
    ]));
    expect(roles(template)).not.toContain('toggleDevTools');
    expect(roles(template)).not.toContain('forceReload');
    expect(roles(template).filter((role) => role === 'togglefullscreen')).toHaveLength(1);
  });
});

function labels(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.label === undefined ? [] : [item.label]),
    ...(Array.isArray(item.submenu) ? labels(item.submenu) : []),
  ]);
}

function roles(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role === undefined ? [] : [item.role]),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ]);
}
