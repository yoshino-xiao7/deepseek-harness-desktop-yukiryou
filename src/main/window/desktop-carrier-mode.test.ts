import { describe, expect, it } from 'vitest';

import { resolveDesktopCarrierMode } from './desktop-carrier-mode.js';

describe('desktop carrier mode', () => {
  it.each([undefined, '', '   '])('defaults %s to the legacy carrier', (value) => {
    expect(resolveDesktopCarrierMode(value)).toBe('legacy');
  });

  it('accepts the production legacy carrier explicitly', () => {
    expect(resolveDesktopCarrierMode('legacy')).toBe('legacy');
  });

  it('does not expose the unfit Integrated prototype through the carrier switch alone', () => {
    expect(resolveDesktopCarrierMode('integrated')).toBe('legacy');
  });

  it('requires a second internal opt-in for Integrated prototype E2E', () => {
    expect(resolveDesktopCarrierMode('integrated', '1')).toBe('integrated');
  });

  it('fails closed for an unknown carrier', () => {
    expect(() => resolveDesktopCarrierMode('web')).toThrow(
      'Invalid DSH_DESKTOP_CARRIER_MODE: web',
    );
  });
});
