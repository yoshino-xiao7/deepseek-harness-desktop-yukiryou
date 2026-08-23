import { describe, expect, it } from 'vitest';
import { validatedDesktopLocale } from './locale-sync.js';

describe('desktop locale synchronization', () => {
  it('normalizes the two supported application languages', () => {
    expect(validatedDesktopLocale('zh-CN')).toBe('zh-CN');
    expect(validatedDesktopLocale('zh-Hans')).toBe('zh-CN');
    expect(validatedDesktopLocale('en-US')).toBe('en-US');
    expect(validatedDesktopLocale('en-GB')).toBe('en-US');
  });

  it('rejects unsupported or malformed locale payloads', () => {
    expect(validatedDesktopLocale('ja-JP')).toBeUndefined();
    expect(validatedDesktopLocale({ language: 'zh-CN' })).toBeUndefined();
  });
});
