import { describe, expect, it } from 'vitest';

import { redact } from './app-log.js';

describe('diagnostic redaction', () => {
  it('redacts tokens, authorization headers, and sensitive URL parameters', () => {
    const value = [
      'sk-abcdefghijk12345',
      'Authorization: Bearer private-value',
      'https://example.test/path?api_key=top-secret&mode=safe&token=also-secret',
    ].join(' ');

    const result = redact(value);

    expect(result).not.toContain('abcdefghijk12345');
    expect(result).not.toContain('private-value');
    expect(result).not.toContain('top-secret');
    expect(result).not.toContain('also-secret');
    expect(result).toContain('mode=safe');
  });
});
