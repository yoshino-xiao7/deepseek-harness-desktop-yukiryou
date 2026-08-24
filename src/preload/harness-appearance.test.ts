import { describe, expect, it } from 'vitest';

import { resolvedHarnessAppearance } from './harness-appearance.js';

describe('resolvedHarnessAppearance', () => {
  it('keeps the native toolbar and companion dark while Harness layout tokens are unavailable', () => {
    expect(resolvedHarnessAppearance({ colorScheme: 'dark' })).toEqual({
      colorScheme: 'dark',
      sidebarBackground: 'rgb(27, 28, 31)',
      contentBackground: 'rgb(20, 20, 22)',
      foreground: 'rgb(232, 234, 240)',
      mutedForeground: 'rgb(142, 148, 159)',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      accentColor: 'rgb(79, 131, 242)',
      accentForeground: 'rgb(255, 255, 255)',
      surfaceBackground: 'rgb(21, 22, 26)',
      subtleBackground: 'rgb(27, 29, 34)',
      hoverBackground: 'rgba(255, 255, 255, 0.045)',
      selectedBackground: 'rgba(79, 131, 242, 0.13)',
      overlayBackground: 'rgb(27, 29, 34)',
    });
  });

  it('prefers resolved Harness colors when they are available', () => {
    expect(resolvedHarnessAppearance({
      colorScheme: 'light',
      sidebarBackground: 'rgb(1, 2, 3)',
      contentBackground: 'rgb(4, 5, 6)',
      bodyBackground: 'rgb(7, 8, 9)',
      foreground: 'rgb(10, 11, 12)',
      accentColor: 'rgb(225, 29, 120)',
    })).toMatchObject({
      sidebarBackground: 'rgb(1, 2, 3)',
      contentBackground: 'rgb(4, 5, 6)',
      foreground: 'rgb(10, 11, 12)',
      accentColor: 'rgb(225, 29, 120)',
    });
  });
});
