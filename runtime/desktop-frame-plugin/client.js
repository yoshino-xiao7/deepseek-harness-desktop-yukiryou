/* global window */

window.__ModuleLoader__.load({
  id: '@dsh-desktop/frame-prototype',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');

    const health = {
      protocolVersion: 1,
      status: 'ready',
      capabilities: {
        integratedChrome: false,
        resizablePanels: false,
        shellOverlay: true,
      },
    };

    function DesktopFrameHealth() {
      React.useEffect(() => {
        window.deepSeekYukiRyouFrame?.reportHealth(health);
      }, []);
      return React.createElement('div', {
        'aria-hidden': 'true',
        'data-desktop-frame': 'prototype',
        'data-desktop-surface': 'shell.overlay',
        style: { display: 'none' },
      });
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject(
          'shell.overlay',
          () => ctx.slots.register(
            { name: 'shell.overlay', id: 'desktop-frame-health', order: -100 },
            DesktopFrameHealth,
          ),
        ),
        'dsh-desktop: integrated frame health overlay',
      );
    }

    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
