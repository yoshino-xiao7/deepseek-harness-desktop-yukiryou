import { describe, expect, it } from 'vitest';

import { resolveRendererLocation } from './app-config.js';

describe('renderer location', () => {
  it('rejects a development server URL in production', () => {
    expect(() =>
      resolveRendererLocation({
        isPackaged: true,
        developmentServerUrl: 'http://localhost:5173',
        packagedRendererUrl: 'file:///app/main_window/index.html',
      }),
    ).toThrow(/development server/i);
  });

  it('loads the Forge development server while developing', () => {
    expect(
      resolveRendererLocation({
        isPackaged: false,
        developmentServerUrl: 'http://localhost:5173',
        packagedRendererUrl: 'file:///app/main_window/index.html',
      }),
    ).toEqual({ kind: 'url', value: 'http://localhost:5173' });
  });

  it('loads the bundled renderer without a development server', () => {
    expect(
      resolveRendererLocation({
        isPackaged: true,
        developmentServerUrl: undefined,
        packagedRendererUrl: 'file:///app/main_window/index.html',
      }),
    ).toEqual({
      kind: 'file',
      value: 'file:///app/main_window/index.html',
    });
  });
});
