import { describe, expect, it } from 'vitest';

import { createProductWebPreferences } from './product-web-preferences.js';

describe('product web preferences', () => {
  it('applies the same isolated preload contract to every carrier', () => {
    expect(createProductWebPreferences('/tmp/harness-preload.cjs')).toEqual({
      preload: '/tmp/harness-preload.cjs',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    });
  });

  it('refuses a product window without an explicit preload', () => {
    expect(() => createProductWebPreferences('   ')).toThrow(
      'Product preload path must not be empty',
    );
  });
});
