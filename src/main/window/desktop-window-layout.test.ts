import { describe, expect, it } from 'vitest';

import { harnessContentBounds } from './desktop-window-layout.js';

describe('integrated desktop window layout', () => {
  it('reserves a persistent draggable toolbar above Harness content', () => {
    expect(harnessContentBounds({ width: 1180, height: 780 })).toEqual({
      x: 0,
      y: 44,
      width: 1180,
      height: 736,
    });
  });
});
