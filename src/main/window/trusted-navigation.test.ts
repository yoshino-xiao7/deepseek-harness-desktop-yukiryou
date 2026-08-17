import { describe, expect, it } from 'vitest';

import {
  classifyLocalAction,
  classifyNavigation,
  createTrustedHarnessOrigin,
} from './trusted-navigation.js';

describe('trusted Harness navigation', () => {
  it('allows navigation within the verified loopback origin', () => {
    const trusted = createTrustedHarnessOrigin('http://127.0.0.1:3080');

    expect(
      classifyNavigation(trusted, 'http://127.0.0.1:3080/session/abc'),
    ).toBe('allow');
  });

  it('accepts only the three exact local diagnostic actions', () => {
    expect(classifyLocalAction('dsh-desktop://action/retry')).toBe('retry');
    expect(classifyLocalAction('dsh-desktop://action/open-logs')).toBe(
      'open-logs',
    );
    expect(classifyLocalAction('dsh-desktop://action/copy-diagnostics')).toBe(
      'copy-diagnostics',
    );
    expect(classifyLocalAction('dsh-desktop://evil/retry')).toBeUndefined();
    expect(classifyLocalAction('dsh-desktop://action/delete')).toBeUndefined();
  });

  it('rejects a non-loopback Harness origin', () => {
    expect(() => createTrustedHarnessOrigin('http://192.168.1.8:3080')).toThrow(
      /loopback/i,
    );
  });

  it('sends HTTPS links to the system browser', () => {
    const trusted = createTrustedHarnessOrigin('http://127.0.0.1:3080');

    expect(classifyNavigation(trusted, 'https://github.com/deepseek-ai')).toBe(
      'open-external',
    );
  });

  it('denies local files and untrusted HTTP origins', () => {
    const trusted = createTrustedHarnessOrigin('http://127.0.0.1:3080');

    expect(classifyNavigation(trusted, 'file:///etc/passwd')).toBe('deny');
    expect(classifyNavigation(trusted, 'http://127.0.0.1:9999')).toBe('deny');
  });
});
