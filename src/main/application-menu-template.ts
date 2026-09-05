import type { MenuItemConstructorOptions } from 'electron';

import type { DesktopLocale } from '../shared/locale-sync.js';

export interface ApplicationMenuActions {
  readonly manageStartupRecovery?: () => void;
  readonly restartHarness: () => void;
  readonly reloadHarness: () => void;
  readonly openLogs: () => void;
  readonly exportDiagnostics: () => void;
  readonly checkForUpdates: () => void;
}

export interface ApplicationMenuTemplateOptions {
  readonly appName: string;
  readonly locale: DesktopLocale;
  readonly platform: NodeJS.Platform;
  readonly actions: ApplicationMenuActions;
}

export function createApplicationMenuTemplate(
  options: ApplicationMenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const chinese = options.locale !== 'en-US';
  const text = chinese ? chineseLabels(options.appName) : englishLabels(options.appName);
  const appItems: MenuItemConstructorOptions[] = [
    { role: 'about', label: text.about },
    { type: 'separator' },
    { label: text.restart, click: options.actions.restartHarness },
    { label: chinese ? '安全启动与恢复…' : 'Safe startup and recovery…', click: options.actions.manageStartupRecovery ?? (() => undefined), enabled: options.actions.manageStartupRecovery !== undefined },
    {
      label: text.reload,
      accelerator: 'CmdOrCtrl+R',
      click: options.actions.reloadHarness,
    },
    { label: text.logs, click: options.actions.openLogs },
    { label: text.diagnostics, click: options.actions.exportDiagnostics },
    { label: text.updates, click: options.actions.checkForUpdates },
    { type: 'separator' },
  ];
  if (options.platform === 'darwin') {
    appItems.push(
      { role: 'hide', label: text.hide },
      { role: 'hideOthers', label: text.hideOthers },
      { role: 'unhide', label: text.showAll },
      { type: 'separator' },
    );
  }
  appItems.push({ role: 'quit', label: text.quit });

  const windowItems: MenuItemConstructorOptions[] = [
    { role: 'minimize', label: text.minimize },
    ...(options.platform === 'darwin'
      ? [
          { role: 'zoom', label: text.zoom } as MenuItemConstructorOptions,
          { type: 'separator' } as MenuItemConstructorOptions,
          { role: 'front', label: text.front } as MenuItemConstructorOptions,
        ]
      : [
          { role: 'close', label: text.close } as MenuItemConstructorOptions,
        ]),
  ];

  return [
    { id: 'file', label: options.appName, submenu: appItems },
    {
      id: 'edit',
      label: text.edit,
      submenu: [
        { role: 'undo', label: text.undo },
        { role: 'redo', label: text.redo },
        { type: 'separator' },
        { role: 'cut', label: text.cut },
        { role: 'copy', label: text.copy },
        { role: 'paste', label: text.paste },
        { role: 'pasteAndMatchStyle', label: text.pasteAndMatchStyle },
        { role: 'delete', label: text.delete },
        { role: 'selectAll', label: text.selectAll },
      ],
    },
    {
      id: 'view',
      label: text.view,
      submenu: [
        { role: 'resetZoom', label: text.actualSize },
        { role: 'zoomIn', label: text.zoomIn },
        { role: 'zoomOut', label: text.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: text.fullScreen },
      ],
    },
    { id: 'window', label: text.window, submenu: windowItems },
    {
      id: 'help',
      label: text.help,
      submenu: [
        { label: text.updates, click: options.actions.checkForUpdates },
        { label: text.logs, click: options.actions.openLogs },
      ],
    },
  ];
}

function chineseLabels(appName: string) {
  return {
    about: `关于 ${appName}`, restart: '重启 Harness', reload: '重新加载 Harness 界面',
    logs: '打开日志', diagnostics: '导出诊断信息…', updates: '检查更新…',
    hide: `隐藏 ${appName}`, hideOthers: '隐藏其他应用', showAll: '全部显示',
    quit: `退出 ${appName}`, edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切',
    copy: '复制', paste: '粘贴', pasteAndMatchStyle: '粘贴并匹配样式', delete: '删除',
    selectAll: '全选', view: '视图', actualSize: '实际大小', zoomIn: '放大',
    zoomOut: '缩小', fullScreen: '进入全屏', window: '窗口', minimize: '最小化',
    zoom: '缩放', front: '置于最前', close: '关闭窗口', help: '帮助',
  } as const;
}

function englishLabels(appName: string) {
  return {
    about: `About ${appName}`, restart: 'Restart Harness', reload: 'Reload Harness UI',
    logs: 'Open Logs', diagnostics: 'Export Diagnostics…', updates: 'Check for Updates…',
    hide: `Hide ${appName}`, hideOthers: 'Hide Others', showAll: 'Show All',
    quit: `Quit ${appName}`, edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut',
    copy: 'Copy', paste: 'Paste', pasteAndMatchStyle: 'Paste and Match Style', delete: 'Delete',
    selectAll: 'Select All', view: 'View', actualSize: 'Actual Size', zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out', fullScreen: 'Toggle Full Screen', window: 'Window',
    minimize: 'Minimize', zoom: 'Zoom', front: 'Bring All to Front', close: 'Close', help: 'Help',
  } as const;
}
