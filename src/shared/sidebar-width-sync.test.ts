import { describe, expect, it } from 'vitest';

import { validatedSidebarWidth } from './sidebar-width-sync.js';

describe('sidebar width synchronization', () => {
  it('accepts animated widths within the current viewport', () => {
    expect(validatedSidebarWidth(56, 1180)).toBe(56);
    expect(validatedSidebarWidth(173.456, 1180)).toBe(173.46);
    expect(validatedSidebarWidth(280, 1180)).toBe(280);
  });

  it('rejects malformed or out-of-window renderer messages', () => {
    expect(validatedSidebarWidth('280', 1180)).toBeUndefined();
    expect(validatedSidebarWidth(Number.NaN, 1180)).toBeUndefined();
    expect(validatedSidebarWidth(-1, 1180)).toBeUndefined();
    expect(validatedSidebarWidth(1181, 1180)).toBeUndefined();
  });
});
