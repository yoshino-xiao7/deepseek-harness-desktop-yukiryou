import { describe, expect, it } from 'vitest';

import { validatedShellClipboardText } from './shell-clipboard.js';

describe('shell clipboard contract', () => {
  it('accepts bounded visible text', () => {
    expect(validatedShellClipboardText('src/main.ts:12')).toBe('src/main.ts:12');
  });

  it.each([undefined, '', 'bad\0text', 'x'.repeat(4_097)])('rejects invalid text %o', (value) => {
    expect(validatedShellClipboardText(value)).toBeUndefined();
  });
});
