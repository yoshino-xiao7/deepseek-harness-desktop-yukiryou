/* global document, window */

window.__ModuleLoader__.load({
  id: '@dsh-desktop/settings',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');

    const namespace = 'settings.desktop';
    const dictionaries = {
      zh: {
        'features.balance.title': '显示账户余额',
        'features.balance.description': '在主侧栏显示账户余额与今日消耗；关闭后也停止桌面端余额查询，避免与插件提供的同类功能冲突。',
        'features.workspace.title': '启用 Workspace Review',
        'features.workspace.description': '显示右侧只读工作区、变更和文件预览；关闭后隐藏入口且不能再展开工作区。',
        'plugins.tab': '管理说明',
        'plugins.title': '插件管理',
        'plugins.description': '基于当前 Harness Loader 的真实快照，说明每个插件的来源、状态和为什么不能操作。',
        'plugins.readonlyTitle': '当前版本为只读清单',
        'plugins.readonlyDescription': 'Harness 0.1.1-rc.2 只提供插件状态查询，没有安全的启用、停用或卸载接口。这里不会显示无效按钮；后续受管安装能力会在具备事务和恢复机制后开放。',
        'plugins.securityNote': '插件与 Harness 运行在同一进程权限范围内；“系统”与“依赖”表示装配来源，不代表安全沙箱。',
        'plugins.loading': '正在读取插件…',
        'plugins.error': '暂时无法读取插件清单。',
        'plugins.retry': '重试',
        'plugins.search': '搜索名称、模块或条目 ID',
        'plugins.empty': '没有匹配的插件。',
        'plugins.filter.all': '全部',
        'plugins.filter.system': '系统',
        'plugins.filter.dependency': '依赖',
        'plugins.filter.external': '外部',
        'plugins.ownership.system': '系统插件',
        'plugins.ownership.dependency': '运行依赖',
        'plugins.ownership.external': '外部插件',
        'plugins.state.active': '已启用',
        'plugins.state.disabled': '已停用',
        'plugins.state.waiting': '等待依赖',
        'plugins.state.failed': '加载失败',
        'plugins.state.unavailable': '未挂载',
        'plugins.reason.app-bundled': '随桌面应用装配，由应用版本管理。',
        'plugins.reason.runtime-bundled': '随固定 Harness Runtime 装配，由 Runtime 配置管理。',
        'plugins.reason.dependency-only': '供其他插件使用的底层依赖，不提供独立启停操作。',
        'plugins.reason.external-readonly': '由当前 Loader 配置发现；只读接口无法安全修改或卸载它。',
        'plugins.entryId': 'Loader 条目',
        'plugins.module': '模块',
        'plugins.noActions': '当前没有可执行操作',
        'about.nav': '关于',
        'about.title': 'DeepSeek YukiRyou',
        'about.badge': 'Apple Silicon 原生应用',
        'about.description': '专为 Apple Silicon 打造的 DeepSeek Harness 桌面工作空间。',
        'about.version': '版本',
        'about.updateTitle': '软件更新',
        'about.updateIdle': '自动检查已开启，也可以立即检查。',
        'about.updateDisabled': '开发构建不连接更新服务，正式版将自动检查。',
        'about.updateChecking': '正在连接更新服务…',
        'about.updateLatest': '当前已是最新版本。',
        'about.updateDownloading': '发现新版本，正在后台下载。',
        'about.updateDownloaded': '新版本已准备好，重启即可完成安装。',
        'about.updateManual': 'macOS 无法验证自动更新，请改用已公证的 DMG 安装包。',
        'about.updateError': '暂时无法检查，请稍后重试。',
        'about.check': '检查更新',
        'about.checking': '检查中…',
        'about.install': '重启并更新',
        'about.downloading': '下载中…',
        'about.manualDownload': '下载 DMG',
        'about.retry': '重新检查',
        'about.details': '版本信息',
        'about.application': '桌面应用',
        'about.harness': 'DeepSeek Harness',
        'about.node': 'Node.js',
        'about.pnpm': 'pnpm',
        'about.architecture': '架构',
        'about.architectureValue': 'Apple Silicon（arm64）',
        'about.developer': '开发者 GitHub',
        'about.developerValue': 'yoshino-xiao7',
        'about.footer': 'Built with DeepSeek Harness · Designed by YukiRyou',
      },
      en: {
        'features.balance.title': 'Show account balance',
        'features.balance.description': 'Show balance and today’s spend in the main sidebar. Turning this off also stops desktop balance requests to avoid conflicts with similar plugins.',
        'features.workspace.title': 'Enable Workspace Review',
        'features.workspace.description': 'Show the read-only workspace, changes, and file preview panel. Turning this off hides and disables its entry point.',
        'plugins.tab': 'Management',
        'plugins.title': 'Plugin management',
        'plugins.description': 'A live Harness Loader snapshot that explains each plugin’s provenance, state, and available actions.',
        'plugins.readonlyTitle': 'This inventory is read-only',
        'plugins.readonlyDescription': 'Harness 0.1.1-rc.2 exposes plugin status but no safe enable, disable, or uninstall API. Invalid controls are not shown; managed installation will remain closed until transactions and recovery are available.',
        'plugins.securityNote': 'Plugins share process privileges with Harness. System and dependency labels describe deployment provenance, not a security sandbox.',
        'plugins.loading': 'Reading plugins…',
        'plugins.error': 'The plugin inventory is temporarily unavailable.',
        'plugins.retry': 'Retry',
        'plugins.search': 'Search name, module, or entry ID',
        'plugins.empty': 'No matching plugins.',
        'plugins.filter.all': 'All',
        'plugins.filter.system': 'System',
        'plugins.filter.dependency': 'Dependencies',
        'plugins.filter.external': 'External',
        'plugins.ownership.system': 'System plugin',
        'plugins.ownership.dependency': 'Runtime dependency',
        'plugins.ownership.external': 'External plugin',
        'plugins.state.active': 'Enabled',
        'plugins.state.disabled': 'Disabled',
        'plugins.state.waiting': 'Waiting',
        'plugins.state.failed': 'Failed',
        'plugins.state.unavailable': 'Not mounted',
        'plugins.reason.app-bundled': 'Bundled with the desktop app and managed by its release.',
        'plugins.reason.runtime-bundled': 'Bundled with the pinned Harness Runtime and managed by Runtime configuration.',
        'plugins.reason.dependency-only': 'A lower-level dependency used by other plugins; it has no independent toggle.',
        'plugins.reason.external-readonly': 'Discovered in the current Loader configuration; the read-only API cannot safely modify or remove it.',
        'plugins.entryId': 'Loader entry',
        'plugins.module': 'Module',
        'plugins.noActions': 'No actions are currently available',
        'about.nav': 'About',
        'about.title': 'DeepSeek YukiRyou',
        'about.badge': 'Native for Apple Silicon',
        'about.description':
          'A focused DeepSeek Harness workspace built for Apple Silicon.',
        'about.version': 'Version',
        'about.updateTitle': 'Software update',
        'about.updateIdle': 'Automatic checks are on, or check now.',
        'about.updateDisabled': 'Development builds do not connect to the update service.',
        'about.updateChecking': 'Contacting the update service…',
        'about.updateLatest': 'You are running the latest version.',
        'about.updateDownloading': 'A new version was found and is downloading.',
        'about.updateDownloaded': 'The new version is ready. Restart to install it.',
        'about.updateManual': 'macOS could not validate the automatic update. Use the notarized DMG instead.',
        'about.updateError': 'Unable to check right now. Please try again.',
        'about.check': 'Check for updates',
        'about.checking': 'Checking…',
        'about.install': 'Restart and update',
        'about.downloading': 'Downloading…',
        'about.manualDownload': 'Download DMG',
        'about.retry': 'Check again',
        'about.details': 'Version information',
        'about.application': 'Desktop application',
        'about.harness': 'DeepSeek Harness',
        'about.node': 'Node.js',
        'about.pnpm': 'pnpm',
        'about.architecture': 'Architecture',
        'about.architectureValue': 'Apple Silicon (arm64)',
        'about.developer': 'Developer GitHub',
        'about.developerValue': 'yoshino-xiao7',
        'about.footer': 'Built with DeepSeek Harness · Designed by YukiRyou',
      },
    };

    const desktopPlatform = window.deepSeekYukiRyouPlatform ?? {
      platform: 'darwin',
      architecture: 'arm64',
    };
    if (desktopPlatform.platform === 'win32') {
      Object.assign(dictionaries.zh, {
        'about.badge': 'Windows 桌面应用',
        'about.description': '面向 Windows 11 x64 的 DeepSeek Harness 桌面工作空间。',
        'about.updateManual': 'Windows 自动更新暂不可用，请改用发行页中的 Setup EXE 或便携版 ZIP。',
        'about.manualDownload': '下载 EXE',
        'about.architectureValue': `Windows ${desktopPlatform.architecture}`,
      });
      Object.assign(dictionaries.en, {
        'about.badge': 'Windows desktop app',
        'about.description': 'A focused DeepSeek Harness workspace for Windows 11 x64.',
        'about.updateManual': 'Automatic update is unavailable on Windows. Use the Setup EXE or portable ZIP from the release page.',
        'about.manualDownload': 'Download EXE',
        'about.architectureValue': `Windows ${desktopPlatform.architecture}`,
      });
    }

    const css = `
      :root {
        --dsh-desktop-chrome-sidebar-background: var(--dsw-specific-sidebar-fill);
        --dsh-desktop-chrome-content-background: var(--dsw-alias-bg-base);
      }
      .dsh-desktop-settings-page {
        box-sizing: border-box;
        width: min(720px, 100%);
        padding: 8px 4px 32px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-desktop-settings-page h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        line-height: 30px;
      }
      .dsh-desktop-feature-settings {
        width: 100%;
        border-bottom: 1px solid var(--dsw-alias-border-l2);
      }
      .dsh-desktop-feature-setting {
        display: flex;
        padding: 16px 0;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .dsh-desktop-feature-setting + .dsh-desktop-feature-setting {
        border-top: 1px solid var(--dsw-alias-border-l2);
      }
      .dsh-desktop-feature-copy {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 4px;
        padding-right: 48px;
      }
      .dsh-desktop-feature-title {
        display: block;
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        font-weight: 400;
        line-height: 22px;
      }
      .dsh-desktop-feature-description {
        display: block;
        max-width: 560px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        font-weight: 400;
        line-height: 18px;
      }
      .dsh-desktop-feature-switch {
        position: relative;
        width: 42px;
        height: 24px;
        flex: none;
        border: 0;
        border-radius: 999px;
        background: var(--dsw-alias-border-l3, rgb(127 127 127 / 28%));
        cursor: pointer;
      }
      .dsh-desktop-feature-switch::after {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgb(0 0 0 / 22%);
        content: '';
        transition: transform 150ms ease;
      }
      .dsh-desktop-feature-switch[aria-checked='true'] {
        background: var(--dsw-static-deepseek-500, #4d6bfe);
      }
      .dsh-desktop-feature-switch[aria-checked='true']::after {
        transform: translateX(18px);
      }
      .dsh-desktop-feature-switch:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--dsw-static-deepseek-500, #4d6bfe) 48%, transparent);
        outline-offset: 2px;
      }
      .dsh-desktop-settings-description {
        margin: 6px 0 24px;
        color: var(--dsw-alias-label-secondary);
        font-size: 14px;
        line-height: 22px;
      }
      .dsh-desktop-plugin-page {
        width: min(820px, 100%);
      }
      .dsh-desktop-plugin-notice {
        margin-bottom: 16px;
        padding: 14px 16px;
        border: 1px solid rgb(77 107 254 / 28%);
        border-radius: 12px;
        background: rgb(77 107 254 / 8%);
      }
      .dsh-desktop-plugin-notice strong {
        display: block;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
      }
      .dsh-desktop-plugin-notice p {
        margin: 4px 0 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 19px;
      }
      .dsh-desktop-plugin-security {
        border-top: 1px solid rgb(77 107 254 / 18%);
        padding-top: 8px;
      }
      .dsh-desktop-plugin-toolbar {
        display: flex;
        margin-bottom: 14px;
        align-items: center;
        gap: 10px;
      }
      .dsh-desktop-plugin-search {
        box-sizing: border-box;
        min-width: 180px;
        height: 36px;
        flex: 1;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 9px;
        outline: none;
        padding: 0 12px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        font: inherit;
        font-size: 13px;
      }
      .dsh-desktop-plugin-search:focus {
        border-color: var(--dsw-static-deepseek-500, #4d6bfe);
      }
      .dsh-desktop-plugin-filters {
        display: flex;
        gap: 5px;
      }
      .dsh-desktop-plugin-filter {
        height: 32px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        padding: 0 10px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        cursor: pointer;
        font: inherit;
        font-size: 12px;
      }
      .dsh-desktop-plugin-filter[aria-pressed='true'] {
        border-color: rgb(77 107 254 / 38%);
        color: var(--dsw-static-deepseek-500, #4d6bfe);
        background: rgb(77 107 254 / 10%);
      }
      .dsh-desktop-plugin-count {
        margin-left: 4px;
        color: var(--dsw-alias-label-tertiary);
        font-variant-numeric: tabular-nums;
      }
      .dsh-desktop-plugin-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
      }
      .dsh-desktop-plugin-card {
        min-width: 0;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 11px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-desktop-plugin-card summary {
        display: grid;
        min-height: 54px;
        list-style: none;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        cursor: pointer;
      }
      .dsh-desktop-plugin-card summary::-webkit-details-marker { display: none; }
      .dsh-desktop-plugin-main {
        display: flex;
        min-width: 0;
        overflow: hidden;
        flex-direction: column;
        gap: 1px;
      }
      .dsh-desktop-plugin-name {
        display: block;
        min-width: 0;
        overflow: hidden;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        font-weight: 600;
        line-height: 19px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-desktop-plugin-owner {
        display: block;
        overflow: hidden;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 17px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-desktop-plugin-state {
        flex: none;
        border-radius: 999px;
        padding: 2px 7px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-interactive-bg-hover);
        font-size: 11px;
        line-height: 17px;
      }
      .dsh-desktop-plugin-state[data-state='active'] {
        color: var(--dsw-alias-label-success, #168a4b);
        background: rgb(33 181 98 / 11%);
      }
      .dsh-desktop-plugin-state[data-state='failed'] {
        color: var(--dsw-alias-label-error, #d33b3b);
        background: rgb(218 61 61 / 10%);
      }
      .dsh-desktop-plugin-detail {
        margin: 0 12px;
        padding: 10px 0 12px;
        border-top: 1px solid var(--dsw-alias-border-l2);
      }
      .dsh-desktop-plugin-detail p {
        margin: 0 0 8px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .dsh-desktop-plugin-metadata {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 4px 9px;
        font-size: 11px;
        line-height: 17px;
      }
      .dsh-desktop-plugin-metadata dt { color: var(--dsw-alias-label-tertiary); }
      .dsh-desktop-plugin-metadata dd {
        min-width: 0;
        margin: 0;
        overflow-wrap: anywhere;
        color: var(--dsw-alias-label-secondary);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .dsh-desktop-plugin-no-actions {
        display: block;
        margin-top: 9px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
      }
      .dsh-desktop-plugin-message {
        padding: 32px 12px;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        text-align: center;
      }
      .dsh-desktop-about-page {
        width: min(760px, 100%);
        padding-top: 0;
      }
      .dsh-desktop-about-hero {
        display: flex;
        min-height: 132px;
        padding: 24px;
        align-items: center;
        gap: 20px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 20px;
        background:
          radial-gradient(circle at 12% 18%, rgb(77 107 254 / 16%), transparent 42%),
          linear-gradient(145deg, rgb(77 107 254 / 5%), transparent 58%),
          var(--dsw-alias-bg-layer-1);
      }
      .dsh-desktop-about-logo {
        box-sizing: border-box;
        width: 92px;
        height: 92px;
        flex: none;
        border: 1px solid rgb(77 107 254 / 20%);
        border-radius: 22px;
        box-shadow: 0 14px 34px rgb(38 70 180 / 18%);
        object-fit: cover;
      }
      .dsh-desktop-about-copy {
        min-width: 0;
      }
      .dsh-desktop-about-copy h2 {
        font-size: 25px;
        letter-spacing: -.3px;
        line-height: 34px;
      }
      .dsh-desktop-about-badge {
        display: inline-flex;
        margin-top: 7px;
        padding: 3px 9px;
        border-radius: 999px;
        color: var(--dsw-static-deepseek-500, #4d6bfe);
        background: rgb(77 107 254 / 10%);
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
      }
      .dsh-desktop-about-copy .dsh-desktop-settings-description {
        max-width: 480px;
        margin: 10px 0 0;
      }
      .dsh-desktop-update-card {
        display: grid;
        min-height: 76px;
        margin-top: 14px;
        padding: 15px 16px;
        grid-template-columns: 42px minmax(0, 1fr) auto;
        align-items: center;
        gap: 13px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-desktop-update-icon {
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border-radius: 13px;
        color: var(--dsw-static-deepseek-500, #4d6bfe);
        background: rgb(77 107 254 / 11%);
        font-size: 21px;
        font-weight: 500;
      }
      .dsh-desktop-update-copy { min-width: 0; }
      .dsh-desktop-update-title {
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        font-weight: 600;
        line-height: 21px;
      }
      .dsh-desktop-update-status {
        margin-top: 2px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .dsh-desktop-update-progress {
        position: relative;
        display: block;
        width: min(240px, 100%);
        height: 3px;
        margin-top: 7px;
        overflow: hidden;
        border-radius: 999px;
        background: rgb(77 107 254 / 13%);
      }
      .dsh-desktop-update-progress::after {
        position: absolute;
        inset: 0 auto 0 -42%;
        width: 42%;
        border-radius: inherit;
        background: var(--dsw-static-deepseek-500, #4d6bfe);
        animation: dsh-desktop-update-progress 1.1s ease-in-out infinite;
        content: '';
      }
      @keyframes dsh-desktop-update-progress {
        from { transform: translateX(0); }
        to { transform: translateX(340%); }
      }
      .dsh-desktop-update-button {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: 10px;
        color: #fff;
        background: var(--dsw-static-deepseek-500, #4d6bfe);
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 550;
        white-space: nowrap;
      }
      .dsh-desktop-update-button:hover:not(:disabled) { filter: brightness(.96); }
      .dsh-desktop-update-button:disabled {
        color: var(--dsw-alias-label-tertiary);
        background: var(--dsw-alias-interactive-bg-hover);
        cursor: default;
      }
      .dsh-desktop-about-card {
        display: grid;
        margin-top: 14px;
        overflow: hidden;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-desktop-about-card-title {
        margin: 0;
        padding: 13px 15px 3px;
        grid-column: 1 / -1;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        font-weight: 500;
      }
      .dsh-desktop-about-row {
        display: flex;
        min-height: 56px;
        padding: 10px 15px 14px;
        flex-direction: column;
        justify-content: center;
        gap: 3px;
        font-size: 13px;
      }
      .dsh-desktop-about-value {
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        font-weight: 550;
        font-variant-numeric: tabular-nums;
      }
      .dsh-desktop-about-row > span:first-child {
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-desktop-about-developer {
        display: flex;
        min-height: 62px;
        margin-top: 14px;
        padding: 0 16px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        font-size: 13px;
        text-decoration: none;
      }
      .dsh-desktop-about-developer:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-desktop-about-developer-label {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--dsw-alias-label-primary);
        font-weight: 550;
      }
      .dsh-desktop-about-developer-icon {
        display: grid;
        width: 32px;
        height: 32px;
        place-items: center;
        border-radius: 50%;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-interactive-bg-hover);
        font-size: 15px;
      }
      .dsh-desktop-about-developer-value {
        color: var(--dsw-static-deepseek-500, #4d6bfe);
        font-size: 14px;
        font-weight: 550;
      }
      .dsh-desktop-about-footer {
        margin: 18px 0 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        text-align: center;
      }
      @media (max-width: 760px) {
        .dsh-desktop-about-hero { align-items: flex-start; }
        .dsh-desktop-about-logo { width: 78px; height: 78px; border-radius: 19px; }
        .dsh-desktop-update-card { grid-template-columns: 38px minmax(0, 1fr); }
        .dsh-desktop-update-button { grid-column: 1 / -1; }
        .dsh-desktop-about-card { grid-template-columns: 1fr 1fr; }
        .dsh-desktop-plugin-toolbar { align-items: stretch; flex-direction: column; }
        .dsh-desktop-plugin-filters { overflow-x: auto; }
        .dsh-desktop-plugin-grid { grid-template-columns: 1fr; }
      }
    `;
    if (!document.querySelector('style[data-plugin-css="dsh-desktop-settings"]')) {
      const style = document.createElement('style');
      style.dataset.plugin = '@dsh-desktop/settings';
      style.dataset.pluginCss = 'dsh-desktop-settings';
      style.textContent = css;
      document.head.appendChild(style);
    }

    function pluginOwnership(moduleName) {
      if (
        moduleName.startsWith('cordis:') ||
        moduleName.startsWith('@deepseek-ai/cordis') ||
        moduleName.startsWith('cordis-plugin-')
      ) return 'dependency';
      if (
        moduleName.startsWith('@dsh-desktop/') ||
        moduleName.startsWith('@deepseek-ai/dsh-')
      ) return 'system';
      return 'external';
    }

    function DesktopFeatureSettingsRow({ t }) {
      const bridge = window.deepSeekYukiRyouFeatures;
      const [features, setFeatures] = React.useState(
        () => bridge?.getSnapshot() ?? { accountBalance: true, workspaceReview: true },
      );
      const featuresRef = React.useRef(features);
      React.useEffect(
        () => bridge?.subscribe((next) => {
          featuresRef.current = next;
          setFeatures(next);
        }),
        [bridge],
      );
      const setting = (key, title, description) => React.createElement(
        'div',
        { className: 'dsh-desktop-feature-setting', key },
        React.createElement(
          'span',
          { className: 'dsh-desktop-feature-copy' },
          React.createElement('div', { className: 'dsh-desktop-feature-title' }, t(title)),
          React.createElement('div', { className: 'dsh-desktop-feature-description' }, t(description)),
        ),
        React.createElement('button', {
          type: 'button',
          role: 'switch',
          className: 'dsh-desktop-feature-switch',
          'aria-label': t(title),
          'aria-checked': features[key],
          onClick: () => {
            const enabled = !featuresRef.current[key];
            const next = { ...featuresRef.current, [key]: enabled };
            featuresRef.current = next;
            setFeatures(next);
            bridge?.set({ key, enabled });
          },
        }),
      );
      return React.createElement(
        'div',
        { className: 'dsh-desktop-feature-settings' },
        setting('accountBalance', 'features.balance.title', 'features.balance.description'),
        setting('workspaceReview', 'features.workspace.title', 'features.workspace.description'),
      );
    }

    function explainPlugin(entry) {
      const ownership = pluginOwnership(entry.moduleName);
      const state = !entry.enabled
        ? 'disabled'
        : entry.fiberPhase === 'active'
          ? 'active'
          : entry.fiberPhase === 'failed'
            ? 'failed'
            : entry.fiberPhase === 'pending' || entry.fiberPhase === 'loading'
              ? 'waiting'
              : 'unavailable';
      const parts = entry.moduleName.split('/');
      return {
        ...entry,
        displayName: parts.at(-1) || entry.moduleName,
        ownership,
        state,
        reason: ownership === 'dependency'
          ? 'dependency-only'
          : ownership === 'system'
            ? entry.moduleName.startsWith('@dsh-desktop/')
              ? 'app-bundled'
              : 'runtime-bundled'
            : 'external-readonly',
      };
    }

    function PluginManagementTab({ t, list }) {
      const [snapshot, setSnapshot] = React.useState({ status: 'loading', entries: [] });
      const [query, setQuery] = React.useState('');
      const [filter, setFilter] = React.useState('all');
      const load = React.useCallback(() => {
        setSnapshot({ status: 'loading', entries: [] });
        list().then(
          (value) => setSnapshot({ status: 'ready', entries: value.entries.map(explainPlugin) }),
          () => setSnapshot({ status: 'error', entries: [] }),
        );
      }, [list]);
      React.useEffect(load, [load]);
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const visible = snapshot.entries.filter((entry) =>
        (filter === 'all' || entry.ownership === filter) &&
        (normalizedQuery === '' ||
          entry.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
          entry.moduleName.toLocaleLowerCase().includes(normalizedQuery) ||
          String(entry.entryId).toLocaleLowerCase().includes(normalizedQuery)),
      );
      const filters = ['all', 'system', 'dependency', 'external'];
      return React.createElement(
        'section',
        { className: 'dsh-desktop-settings-page dsh-desktop-plugin-page' },
        React.createElement('h2', null, t('plugins.title')),
        React.createElement('p', { className: 'dsh-desktop-settings-description' }, t('plugins.description')),
        React.createElement(
          'div',
          { className: 'dsh-desktop-plugin-notice' },
          React.createElement('strong', null, t('plugins.readonlyTitle')),
          React.createElement('p', null, t('plugins.readonlyDescription')),
          React.createElement('p', { className: 'dsh-desktop-plugin-security' }, t('plugins.securityNote')),
        ),
        snapshot.status === 'loading'
          ? React.createElement('div', { className: 'dsh-desktop-plugin-message', role: 'status' }, t('plugins.loading'))
          : snapshot.status === 'error'
            ? React.createElement(
                'div',
                { className: 'dsh-desktop-plugin-message', role: 'alert' },
                React.createElement('p', null, t('plugins.error')),
                React.createElement('button', { type: 'button', className: 'dsh-desktop-plugin-filter', onClick: load }, t('plugins.retry')),
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  'div',
                  { className: 'dsh-desktop-plugin-toolbar' },
                  React.createElement('input', {
                    className: 'dsh-desktop-plugin-search',
                    type: 'search',
                    value: query,
                    placeholder: t('plugins.search'),
                    'aria-label': t('plugins.search'),
                    onChange: (event) => setQuery(event.currentTarget.value),
                  }),
                  React.createElement(
                    'div',
                    { className: 'dsh-desktop-plugin-filters' },
                    ...filters.map((id) => React.createElement(
                      'button',
                      {
                        key: id,
                        type: 'button',
                        className: 'dsh-desktop-plugin-filter',
                        'aria-pressed': filter === id,
                        onClick: () => setFilter(id),
                      },
                      t(`plugins.filter.${id}`),
                      React.createElement(
                        'span',
                        { className: 'dsh-desktop-plugin-count' },
                        id === 'all'
                          ? snapshot.entries.length
                          : snapshot.entries.filter((entry) => entry.ownership === id).length,
                      ),
                    )),
                  ),
                ),
                visible.length === 0
                  ? React.createElement('div', { className: 'dsh-desktop-plugin-message' }, t('plugins.empty'))
                  : React.createElement(
                      'div',
                      { className: 'dsh-desktop-plugin-grid' },
                      ...visible.map((entry) => React.createElement(
                        'details',
                        { className: 'dsh-desktop-plugin-card', key: entry.entryId },
                        React.createElement(
                          'summary',
                          null,
                          React.createElement(
                            'span',
                            { className: 'dsh-desktop-plugin-main' },
                            React.createElement('span', {
                              className: 'dsh-desktop-plugin-name',
                              title: entry.displayName,
                            }, entry.displayName),
                            React.createElement('span', { className: 'dsh-desktop-plugin-owner' }, t(`plugins.ownership.${entry.ownership}`)),
                          ),
                          React.createElement('span', { className: 'dsh-desktop-plugin-state', 'data-state': entry.state }, t(`plugins.state.${entry.state}`)),
                        ),
                        React.createElement(
                          'div',
                          { className: 'dsh-desktop-plugin-detail' },
                          React.createElement('p', null, t(`plugins.reason.${entry.reason}`)),
                          React.createElement(
                            'dl',
                            { className: 'dsh-desktop-plugin-metadata' },
                            React.createElement('dt', null, t('plugins.module')),
                            React.createElement('dd', null, entry.moduleName),
                            React.createElement('dt', null, t('plugins.entryId')),
                            React.createElement('dd', null, String(entry.entryId)),
                          ),
                          React.createElement('span', { className: 'dsh-desktop-plugin-no-actions' }, t('plugins.noActions')),
                        ),
                      )),
                    ),
              ),
      );
    }

    const fallbackUpdateState = {
      status: 'disabled',
      currentVersion: '0.1.0',
    };

    function updateApi() {
      return window.deepSeekYukiRyouUpdates;
    }

    function useUpdateState() {
      const api = updateApi();
      const [state, setState] = React.useState(
        () => api?.getSnapshot() ?? fallbackUpdateState,
      );
      React.useEffect(() => api?.subscribe((nextState) => setState(nextState)), [api]);
      return state;
    }

    function updatePresentation(state, t) {
      const statusKeys = {
        disabled: 'about.updateDisabled',
        idle: 'about.updateIdle',
        checking: 'about.updateChecking',
        latest: 'about.updateLatest',
        downloading: 'about.updateDownloading',
        downloaded: 'about.updateDownloaded',
        manual: 'about.updateManual',
        error: 'about.updateError',
      };
      return {
        description: t(statusKeys[state.status] ?? 'about.updateIdle'),
        button:
          state.status === 'downloaded'
            ? t('about.install')
            : state.status === 'downloading'
              ? t('about.downloading')
              : state.status === 'checking'
              ? t('about.checking')
              : state.status === 'manual'
                ? t('about.manualDownload')
              : state.status === 'error'
                ? t('about.retry')
                : t('about.check'),
        disabled: state.status === 'checking' || state.status === 'downloading',
      };
    }

    function AboutSection({ t }) {
      const brandAsset = '/plugins/@dsh-desktop/settings/brand.png';
      const state = useUpdateState();
      const update = updatePresentation(state, t);
      const rows = [
        ['about.application', state.currentVersion],
        ['about.harness', '0.1.1-rc.2'],
        ['about.node', '24.19.0'],
        ['about.pnpm', '10.34.5'],
        ['about.architecture', t('about.architectureValue')],
      ];
      return React.createElement(
        'section',
        { className: 'dsh-desktop-settings-page dsh-desktop-about-page' },
        React.createElement(
          'div',
          { className: 'dsh-desktop-about-hero' },
          React.createElement('img', {
            className: 'dsh-desktop-about-logo',
            src: brandAsset,
            alt: '',
          }),
          React.createElement(
            'div',
            { className: 'dsh-desktop-about-copy' },
            React.createElement('h2', null, t('about.title')),
            React.createElement(
              'span',
              { className: 'dsh-desktop-about-badge' },
              `${t('about.badge')} · ${t('about.version')} ${state.currentVersion}`,
            ),
            React.createElement(
              'p',
              { className: 'dsh-desktop-settings-description' },
              t('about.description'),
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-desktop-update-card' },
          React.createElement(
            'span',
            { className: 'dsh-desktop-update-icon', 'aria-hidden': true },
            '↻',
          ),
          React.createElement(
            'div',
            { className: 'dsh-desktop-update-copy' },
            React.createElement(
              'div',
              { className: 'dsh-desktop-update-title' },
              state.releaseName
                ? `${t('about.updateTitle')} · ${state.releaseName}`
                : t('about.updateTitle'),
            ),
            React.createElement(
              'div',
              { className: 'dsh-desktop-update-status', role: 'status' },
              update.description,
            ),
            state.status === 'downloading'
              ? React.createElement('span', {
                  className: 'dsh-desktop-update-progress',
                  role: 'progressbar',
                  'aria-label': t('about.downloading'),
                })
              : null,
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-desktop-update-button',
              disabled: update.disabled,
              onClick: () => {
                if (state.status === 'downloaded') updateApi()?.install();
                else if (state.status === 'manual') updateApi()?.download();
                else updateApi()?.check();
              },
            },
            update.button,
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-desktop-about-card' },
          React.createElement(
            'h3',
            { className: 'dsh-desktop-about-card-title' },
            t('about.details'),
          ),
          ...rows.map(([label, value]) =>
            React.createElement(
              'div',
              { className: 'dsh-desktop-about-row', key: label },
              React.createElement('span', null, t(label)),
              React.createElement(
                'span',
                { className: 'dsh-desktop-about-value' },
                value,
              ),
            ),
          ),
        ),
        React.createElement(
          'a',
          {
            className: 'dsh-desktop-about-developer',
            href: 'https://github.com/yoshino-xiao7',
            target: '_blank',
            rel: 'noreferrer',
          },
          React.createElement(
            'span',
            { className: 'dsh-desktop-about-developer-label' },
            React.createElement(
              'span',
              { className: 'dsh-desktop-about-developer-icon', 'aria-hidden': true },
              '⌘',
            ),
            t('about.developer'),
          ),
          React.createElement(
            'span',
            { className: 'dsh-desktop-about-developer-value' },
            `${t('about.developerValue')} ↗`,
          ),
        ),
        React.createElement(
          'p',
          { className: 'dsh-desktop-about-footer' },
          t('about.footer'),
        ),
      );
    }

    const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory'];
    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(namespace, dictionaries),
        'dsh-desktop: settings dictionaries',
      );
      const t = ctx.locale.bind(namespace);
      const listPlugins = async () => {
        const result = await ctx.remote.pluginInventory.list();
        if (!result.ok) throw new Error('pluginInventory.list failed');
        return result.value;
      };
      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'desktop-management',
            order: 20,
            label: () => t('plugins.tab'),
            locale: namespace,
            inject: () => ({ list: listPlugins }),
          },
          PluginManagementTab,
        ),
      );
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          {
            name: 'settings.general.item',
            id: 'desktop-features',
            order: 80,
            locale: namespace,
          },
          DesktopFeatureSettingsRow,
        ),
      );
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'desktop-about',
            order: 100,
            label: () => t('about.nav'),
            locale: namespace,
          },
          AboutSection,
        ),
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
