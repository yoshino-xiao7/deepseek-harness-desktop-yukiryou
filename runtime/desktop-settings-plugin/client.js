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
        'about.nav': '关于',
        'about.title': 'DeepSeek YukiRyou',
        'about.badge': 'Apple Silicon 原生应用',
        'about.description': '为个人开发工作流打造的 DeepSeek Harness macOS 桌面体验。',
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
        'about.nav': 'About',
        'about.title': 'DeepSeek YukiRyou',
        'about.badge': 'Native for Apple Silicon',
        'about.description':
          'A personalized DeepSeek Harness desktop experience for macOS.',
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
      .dsh-desktop-about-page {
        padding-top: 2px;
      }
      .dsh-desktop-about-hero {
        display: flex;
        padding: 20px;
        align-items: center;
        gap: 18px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 18px;
        background:
          radial-gradient(circle at 15% 20%, rgb(77 107 254 / 14%), transparent 45%),
          var(--dsw-alias-bg-layer-1);
      }
      .dsh-desktop-about-logo {
        box-sizing: border-box;
        width: 104px;
        height: 104px;
        flex: none;
        border: 1px solid rgb(77 107 254 / 18%);
        border-radius: 24px;
        box-shadow: 0 12px 30px rgb(38 70 180 / 16%);
        object-fit: cover;
      }
      .dsh-desktop-about-copy {
        min-width: 0;
      }
      .dsh-desktop-about-copy h2 {
        font-size: 23px;
        line-height: 32px;
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
        margin: 9px 0 0;
      }
      .dsh-desktop-about-card {
        display: grid;
        margin-top: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .dsh-desktop-about-row {
        display: flex;
        min-height: 58px;
        padding: 12px 14px;
        flex-direction: column;
        justify-content: center;
        gap: 3px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
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
        min-height: 54px;
        margin-top: 10px;
        padding: 0 14px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1);
        font-size: 13px;
        text-decoration: none;
      }
      .dsh-desktop-about-developer:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-desktop-about-developer-label {
        color: var(--dsw-alias-label-secondary);
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
        .dsh-desktop-about-logo { width: 82px; height: 82px; border-radius: 20px; }
        .dsh-desktop-about-card { grid-template-columns: 1fr; }
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

    function AboutSection({ t }) {
      const brandAsset = '/plugins/@dsh-desktop/settings/brand.png';
      const rows = [
        ['about.application', '0.1.0'],
        ['about.harness', '0.1.0-rc.6'],
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
              t('about.badge'),
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
          { className: 'dsh-desktop-about-card' },
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
