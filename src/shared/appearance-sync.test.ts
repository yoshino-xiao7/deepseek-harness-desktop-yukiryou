import { describe, expect, it } from 'vitest';

import { validatedAppearanceSnapshot } from './appearance-sync.js';

describe('desktop appearance synchronization', () => {
  it('accepts normalized browser colors', () => {
    expect(
      validatedAppearanceSnapshot({
        colorScheme: 'dark',
        sidebarBackground: 'rgb(32, 35, 42)',
        contentBackground: 'rgba(21, 23, 28, 0.95)',
        foreground: 'rgb(238, 242, 250)',
        mutedForeground: 'rgb(159, 178, 212)',
        borderColor: 'rgba(148, 168, 210, 0.13)',
        accentColor: 'rgb(79, 131, 242)',
        accentForeground: 'rgb(255, 255, 255)',
        surfaceBackground: 'rgb(13, 20, 36)',
        subtleBackground: 'rgb(20, 30, 54)',
        hoverBackground: 'rgba(79, 131, 242, 0.13)',
        selectedBackground: 'rgba(79, 131, 242, 0.22)',
        overlayBackground: 'rgb(27, 41, 71)',
      }),
    ).toEqual({
      colorScheme: 'dark',
      sidebarBackground: 'rgb(32, 35, 42)',
      contentBackground: 'rgba(21, 23, 28, 0.95)',
      foreground: 'rgb(238, 242, 250)',
      mutedForeground: 'rgb(159, 178, 212)',
      borderColor: 'rgba(148, 168, 210, 0.13)',
      accentColor: 'rgb(79, 131, 242)',
      accentForeground: 'rgb(255, 255, 255)',
      surfaceBackground: 'rgb(13, 20, 36)',
      subtleBackground: 'rgb(20, 30, 54)',
      hoverBackground: 'rgba(79, 131, 242, 0.13)',
      selectedBackground: 'rgba(79, 131, 242, 0.22)',
      overlayBackground: 'rgb(27, 41, 71)',
    });
  });

  it.each([
    undefined,
    { colorScheme: 'system', sidebarBackground: 'red', contentBackground: 'red' },
    {
      colorScheme: 'light',
      sidebarBackground: 'url(file:///tmp/private)',
      contentBackground: 'rgb(255, 255, 255)',
    },
    {
      colorScheme: 'light',
      sidebarBackground: 'rgb(255, 255, 255)',
      contentBackground: 'rgb(255, 255, 255)',
      foreground: 'var(--stolen-value)',
    },
  ])('rejects untrusted appearance payloads', (value) => {
    expect(validatedAppearanceSnapshot(value)).toBeUndefined();
  });
});
