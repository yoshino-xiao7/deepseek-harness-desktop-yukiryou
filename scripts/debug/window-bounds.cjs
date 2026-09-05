const { app, BrowserWindow, screen } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  console.log('[DEBUG-bounds] displays', JSON.stringify(screen.getAllDisplays().map(d => ({ bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }))));
  for (const variant of ['product', 'no-material', 'standard-frame']) {
    const chrome = variant === 'standard-frame' ? {} : {
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#7f858f', height: 44 },
      backgroundColor: '#00000000', backgroundMaterial: variant === 'product' ? 'mica' : 'none',
      roundedCorners: true, thickFrame: true,
    };
    let expected = { x: 80, y: 60, width: 1060, height: 696 };
    for (let round = 0; round < 2; round++) {
      const window = new BrowserWindow({ ...expected, ...chrome, show: false, minWidth: 820, minHeight: 600 });
      const log = label => console.log('[DEBUG-bounds]', JSON.stringify({ variant, round, label, expected, bounds: window.getBounds(), normal: window.getNormalBounds(), content: window.getContentBounds() }));
      log('constructed');
      await window.loadURL('data:text/html,<p>Window bounds probe</p>');
      window.show();
      await delay(500);
      log('shown');
      window.setBounds(expected);
      await delay(500);
      log('setBounds');
      for (let attempt = 0; attempt < 3; attempt++) {
        const actual = window.getBounds();
        window.setBounds({ x: expected.x, y: expected.y, width: expected.width * 2 - actual.width, height: expected.height * 2 - actual.height });
        await delay(100);
        log('compensated-' + attempt);
      }
      expected = window.getBounds();
      window.destroy();
    }
  }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
