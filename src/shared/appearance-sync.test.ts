import { describe, expect, it } from 'vitest';

import { validatedAppearanceSnapshot } from './appearance-sync.js';

describe('desktop appearance synchronization', () => {
  it('accepts normalized browser colors', () => {
    expect(
      validatedAppearanceSnapshot({
        colorScheme: 'dark',
        sidebarBackground: 'rgb(32, 35, 42)',
        contentBackground: 'rgba(21, 23, 28, 0.95)',
      }),
    ).toEqual({
      colorScheme: 'dark',
      sidebarBackground: 'rgb(32, 35, 42)',
      contentBackground: 'rgba(21, 23, 28, 0.95)',
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
  ])('rejects untrusted appearance payloads', (value) => {
    expect(validatedAppearanceSnapshot(value)).toBeUndefined();
  });
});
