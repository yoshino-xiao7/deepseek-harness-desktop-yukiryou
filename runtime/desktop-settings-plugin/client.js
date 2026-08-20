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
        'appearance.nav': '外观',
        'appearance.title': '外观',
        'appearance.description': '选择 DeepSeek YukiRyou 与 DeepSeek Harness 的显示方式。',
        'appearance.light': '浅色',
        'appearance.dark': '深色',
        'appearance.system': '跟随系统',
        'pet.nav': '宠物',
        'pet.title': '宠物资产',
        'pet.description': '管理应用提供的宠物与本地导入资产。动画运行时冻结前，导入包只会进入隔离开发验证区。',
        'pet.enabled': '显示宠物活动区',
        'pet.import': '导入宠物包',
        'pet.importing': '正在验证…',
        'pet.builtIn': '内置',
        'pet.imported': '已导入',
        'pet.ready': '可用',
        'pet.incompatible': '开发中',
        'pet.damaged': '不可用',
        'pet.empty': '当前没有宠物资产。',
        'pet.inboxTitle': '开发验证区',
        'pet.inboxStatus': '等待动画运行时深层验证',
        'pet.inboxCompatible': '运行时验证通过，等待格式冻结',
        'pet.inboxRejected': '未通过动画运行时验证',
        'pet.cancelled': '已取消导入。',
        'pet.rejected': '宠物包未通过安全检查。',
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
        'appearance.nav': 'Appearance',
        'appearance.title': 'Appearance',
        'appearance.description':
          'Choose how DeepSeek YukiRyou and DeepSeek Harness are displayed.',
        'appearance.light': 'Light',
        'appearance.dark': 'Dark',
        'appearance.system': 'System',
        'pet.nav': 'Pets',
        'pet.title': 'Pet assets',
        'pet.description': 'Manage bundled pets and locally imported assets. Until the animation runtime is frozen, imports remain in an isolated development validation area.',
        'pet.enabled': 'Show the pet activity area',
        'pet.import': 'Import pet package',
        'pet.importing': 'Validating…',
        'pet.builtIn': 'Built in',
        'pet.imported': 'Imported',
        'pet.ready': 'Ready',
        'pet.incompatible': 'In development',
        'pet.damaged': 'Unavailable',
        'pet.empty': 'No pet assets are available.',
        'pet.inboxTitle': 'Development validation',
        'pet.inboxStatus': 'Awaiting deep animation-runtime validation',
        'pet.inboxCompatible': 'Runtime validation passed; awaiting format freeze',
        'pet.inboxRejected': 'Animation runtime validation failed',
        'pet.cancelled': 'Import cancelled.',
        'pet.rejected': 'The pet package did not pass safety checks.',
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
      .dsh-desktop-settings-description {
        margin: 6px 0 24px;
        color: var(--dsw-alias-label-secondary);
        font-size: 14px;
        line-height: 22px;
      }
      .dsh-desktop-theme-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .dsh-desktop-theme-option {
        appearance: none;
        box-sizing: border-box;
        display: flex;
        min-height: 132px;
        padding: 14px;
        flex-direction: column;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .dsh-desktop-theme-option:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-desktop-theme-option[aria-pressed='true'] {
        border-color: var(--dsw-static-deepseek-500, #4d6bfe);
        box-shadow: 0 0 0 1px var(--dsw-static-deepseek-500, #4d6bfe);
      }
      .dsh-desktop-theme-preview {
        display: grid;
        height: 72px;
        overflow: hidden;
        grid-template-columns: 30% 70%;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 9px;
        background: #fff;
      }
      .dsh-desktop-theme-preview::before {
        content: '';
        background: #f4f5f7;
        border-right: 1px solid #e4e6ea;
      }
      .dsh-desktop-theme-preview-dark {
        background: #15171c;
      }
      .dsh-desktop-theme-preview-dark::before {
        background: #20232a;
        border-right-color: #30343d;
      }
      .dsh-desktop-theme-preview-system {
        position: relative;
        background: linear-gradient(135deg, #fff 0 50%, #15171c 50% 100%);
      }
      .dsh-desktop-theme-preview-system::before {
        background: linear-gradient(135deg, #f4f5f7 0 50%, #20232a 50% 100%);
      }
      .dsh-desktop-theme-label {
        font-size: 14px;
        font-weight: 500;
        text-align: center;
      }
      .dsh-desktop-pet-toolbar,
      .dsh-desktop-pet-enable {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .dsh-desktop-pet-enable {
        min-height: 48px;
        margin-bottom: 16px;
        padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        font-size: 14px;
        font-weight: 500;
      }
      .dsh-desktop-pet-enable input { width: 16px; height: 16px; accent-color: var(--dsw-static-deepseek-500, #4d6bfe); }
      .dsh-desktop-pet-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
      .dsh-desktop-pet-card {
        appearance: none;
        display: grid;
        min-height: 82px;
        padding: 14px;
        grid-template-columns: 42px minmax(0, 1fr);
        align-items: center;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 13px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        font: inherit;
        text-align: left;
      }
      button.dsh-desktop-pet-card { cursor: pointer; }
      button.dsh-desktop-pet-card:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-desktop-pet-card[aria-pressed='true'] { border-color: var(--dsw-static-deepseek-500, #4d6bfe); box-shadow: 0 0 0 1px var(--dsw-static-deepseek-500, #4d6bfe); }
      .dsh-desktop-pet-card:disabled { cursor: default; opacity: .72; }
      .dsh-desktop-pet-avatar { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 11px; background: var(--dsw-alias-interactive-bg-hover); font-size: 18px; font-weight: 650; }
      .dsh-desktop-pet-thumbnail { width: 42px; height: 42px; border-radius: 11px; background: var(--dsw-alias-interactive-bg-hover); object-fit: contain; }
      .dsh-desktop-pet-copy { min-width: 0; }
      .dsh-desktop-pet-name { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .dsh-desktop-pet-meta { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dsh-desktop-pet-button {
        appearance: none;
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 10px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 550;
      }
      .dsh-desktop-pet-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-desktop-pet-button:disabled { cursor: default; opacity: .55; }
      .dsh-desktop-pet-inbox { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
      .dsh-desktop-pet-inbox h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
      .dsh-desktop-pet-message { margin: 10px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
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
        .dsh-desktop-theme-grid { grid-template-columns: 1fr; }
        .dsh-desktop-about-hero { align-items: flex-start; }
        .dsh-desktop-about-logo { width: 78px; height: 78px; border-radius: 19px; }
        .dsh-desktop-update-card { grid-template-columns: 38px minmax(0, 1fr); }
        .dsh-desktop-update-button { grid-column: 1 / -1; }
        .dsh-desktop-about-card { grid-template-columns: 1fr 1fr; }
        .dsh-desktop-pet-grid { grid-template-columns: 1fr; }
      }
    `;
    if (!document.querySelector('style[data-plugin-css="dsh-desktop-settings"]')) {
      const style = document.createElement('style');
      style.dataset.plugin = '@dsh-desktop/settings';
      style.dataset.pluginCss = 'dsh-desktop-settings';
      style.textContent = css;
      document.head.appendChild(style);
    }

    function AppearanceSection({ t, themeStore, setTheme }) {
      const snapshot = React.useSyncExternalStore(
        themeStore.subscribe,
        themeStore.getSnapshot,
        themeStore.getSnapshot,
      );
      const choices = [
        ['light', 'appearance.light'],
        ['dark', 'appearance.dark'],
        ['system', 'appearance.system'],
      ];
      return React.createElement(
        'section',
        { className: 'dsh-desktop-settings-page' },
        React.createElement('h2', null, t('appearance.title')),
        React.createElement(
          'p',
          { className: 'dsh-desktop-settings-description' },
          t('appearance.description'),
        ),
        React.createElement(
          'div',
          { className: 'dsh-desktop-theme-grid' },
          ...choices.map(([id, label]) =>
            React.createElement(
              'button',
              {
                key: id,
                type: 'button',
                className: 'dsh-desktop-theme-option',
                'aria-pressed': snapshot.preference === id,
                onClick: () => setTheme(id),
              },
              React.createElement('span', {
                className: `dsh-desktop-theme-preview dsh-desktop-theme-preview-${id}`,
                'aria-hidden': true,
              }),
              React.createElement(
                'span',
                { className: 'dsh-desktop-theme-label' },
                t(label),
              ),
            ),
          ),
        ),
      );
    }

    function PetSection({ t, petStore }) {
      const snapshot = React.useSyncExternalStore(
        petStore.subscribe,
        petStore.getSnapshot,
        petStore.getSnapshot,
      );
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const preferChinese = document.documentElement.lang.toLowerCase().startsWith('zh');
      const request = async (command) => {
        setBusy(true);
        setMessage('');
        try {
          const result = await petStore.request({ ...command, expectedRevision: snapshot.revision });
          if (result.status === 'cancelled') setMessage(t('pet.cancelled'));
          else if (result.status === 'rejected') setMessage(t('pet.rejected'));
        } finally {
          setBusy(false);
        }
      };
      const statusKey = { ready: 'pet.ready', incompatible: 'pet.incompatible', damaged: 'pet.damaged' };
      const inboxStatusKey = {
        'awaiting-runtime-validation': 'pet.inboxStatus',
        'runtime-compatible': 'pet.inboxCompatible',
        'runtime-rejected': 'pet.inboxRejected',
      };
      return React.createElement(
        'section',
        { className: 'dsh-desktop-settings-page dsh-desktop-pet-page' },
        React.createElement('h2', null, t('pet.title')),
        React.createElement('p', { className: 'dsh-desktop-settings-description' }, t('pet.description')),
        React.createElement(
          'label',
          { className: 'dsh-desktop-pet-enable' },
          React.createElement('span', null, t('pet.enabled')),
          React.createElement('input', {
            type: 'checkbox',
            checked: snapshot.enabled,
            disabled: busy,
            onChange: (event) => void request({ kind: 'set-enabled', enabled: event.target.checked }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-desktop-pet-toolbar' },
          React.createElement('strong', null, t('pet.title')),
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-desktop-pet-button', disabled: busy || !snapshot.canImport, onClick: () => void request({ kind: 'import' }) },
            busy ? t('pet.importing') : t('pet.import'),
          ),
        ),
        snapshot.assets.length === 0
          ? React.createElement('p', { className: 'dsh-desktop-pet-message' }, t('pet.empty'))
          : React.createElement(
              'div',
              { className: 'dsh-desktop-pet-grid' },
              ...snapshot.assets.map((asset) => React.createElement(
                'button',
                {
                  key: asset.id,
                  type: 'button',
                  className: 'dsh-desktop-pet-card',
                  disabled: busy || asset.status !== 'ready',
                  'aria-pressed': snapshot.activePetId === asset.id,
                  onClick: () => void request({ kind: 'select', petId: asset.id }),
                },
                React.createElement('img', { className: 'dsh-desktop-pet-thumbnail', src: asset.thumbnailUrl, alt: '' }),
                React.createElement(
                  'span',
                  { className: 'dsh-desktop-pet-copy' },
                  React.createElement('span', { className: 'dsh-desktop-pet-name' }, asset.name),
                  React.createElement(
                    'span',
                    { className: 'dsh-desktop-pet-meta' },
                    `${t(asset.origin === 'built-in' ? 'pet.builtIn' : 'pet.imported')} · ${t(statusKey[asset.status])}`,
                  ),
                ),
              )),
            ),
        snapshot.inbox.length === 0
          ? null
          : React.createElement(
              'div',
              { className: 'dsh-desktop-pet-inbox' },
              React.createElement('h3', null, t('pet.inboxTitle')),
              ...snapshot.inbox.map((item) => React.createElement(
                'div',
                { className: 'dsh-desktop-pet-card', key: item.id },
                React.createElement('span', { className: 'dsh-desktop-pet-avatar', 'aria-hidden': true }, (preferChinese ? item.name['zh-CN'] : item.name.en).slice(0, 1)),
                React.createElement(
                  'span',
                  { className: 'dsh-desktop-pet-copy' },
                  React.createElement('span', { className: 'dsh-desktop-pet-name' }, preferChinese ? item.name['zh-CN'] : item.name.en),
                  React.createElement('span', { className: 'dsh-desktop-pet-meta' }, t(inboxStatusKey[item.status])),
                ),
              )),
            ),
        message ? React.createElement('p', { className: 'dsh-desktop-pet-message', role: 'status' }, message) : null,
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
        ['about.harness', '0.1.0-rc.7'],
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

    const inject = ['slots', 'locale', 'theme'];
    function createPetStore(api) {
      let snapshot = api.getSnapshot();
      const listeners = new Set();
      const unsubscribe = api.subscribe((next) => {
        snapshot = next;
        for (const listener of listeners) listener();
      });
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        request: (command) => api.request(command),
        dispose: unsubscribe,
      };
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(namespace, dictionaries),
        'dsh-desktop: settings dictionaries',
      );
      const t = ctx.locale.bind(namespace);
      const themeStore = {
        getSnapshot: () => ctx.theme.getTheme(),
        subscribe: (listener) =>
          ctx.on('theme/change', () => listener()),
      };
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'desktop-appearance',
            order: 30,
            label: () => t('appearance.nav'),
            locale: namespace,
            inject: () => ({
              themeStore,
              setTheme: (id) => ctx.theme.setTheme(id),
            }),
          },
          AppearanceSection,
        ),
      );
      const petApi = window.deepSeekYukiRyouPets ?? {
        getSnapshot: () => ({ enabled: false, canImport: false, assets: [], inbox: [], revision: 0 }),
        subscribe: () => () => {},
        request: async () => ({ status: 'rejected', code: 'inbox-disabled' }),
      };
      const petStore = createPetStore(petApi);
      ctx.effect(() => () => petStore.dispose(), 'dsh-desktop: pet library bridge');
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'desktop-pets',
            order: 50,
            label: () => t('pet.nav'),
            locale: namespace,
            inject: () => ({ petStore }),
          },
          PetSection,
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
