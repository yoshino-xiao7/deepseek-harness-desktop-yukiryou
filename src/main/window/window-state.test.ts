import { describe, expect, it } from 'vitest';

import { normalizedWindowState } from './window-state.js';

const primary = { x: 0, y: 25, width: 1512, height: 957 };

describe('desktop window state', () => {
  it('restores a user-sized window inside the current display work area', () => {
    expect(normalizedWindowState({
      schemaVersion: 1,
      bounds: { x: 160, y: 120, width: 1080, height: 720 },
      maximized: false,
    }, [primary])).toEqual({
      bounds: { x: 160, y: 120, width: 1080, height: 720 },
      maximized: false,
    });
  });

  it('moves a valid off-screen state onto the primary display after monitor changes', () => {
    expect(normalizedWindowState({
      schemaVersion: 1,
      bounds: { x: 4000, y: 100, width: 1200, height: 800 },
      maximized: true,
    }, [primary])).toEqual({
      bounds: { x: 156, y: 103, width: 1200, height: 800 },
      maximized: true,
    });
  });

  it.each([
    null,
    { schemaVersion: 2, bounds: { x: 0, y: 0, width: 1000, height: 700 }, maximized: false },
    { schemaVersion: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, maximized: false },
    { schemaVersion: 1, bounds: { x: 0, y: 0, width: 1000, height: 700 }, maximized: 'yes' },
  ])('rejects invalid persisted state %#', (value) => {
    expect(normalizedWindowState(value, [primary])).toBeUndefined();
  });
});
