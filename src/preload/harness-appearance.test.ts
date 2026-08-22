import { describe, expect, it } from 'vitest';

import { resolvedHarnessAppearance } from './harness-appearance.js';

describe('resolvedHarnessAppearance', () => {
  it('keeps the native toolbar and companion dark while Harness layout tokens are unavailable', () => {
    expect(resolvedHarnessAppearance({ colorScheme: 'dark' })).toEqual({
      colorScheme: 'dark',
      sidebarBackground: 'rgb(27, 28, 31)',
      contentBackground: 'rgb(20, 20, 22)',
    });
  });

  it('prefers resolved Harness colors when they are available', () => {
    expect(resolvedHarnessAppearance({
      colorScheme: 'light',
      sidebarBackground: 'rgb(1, 2, 3)',
      contentBackground: 'rgb(4, 5, 6)',
      bodyBackground: 'rgb(7, 8, 9)',
    })).toMatchObject({
      sidebarBackground: 'rgb(1, 2, 3)',
      contentBackground: 'rgb(4, 5, 6)',
    });
  });
});
