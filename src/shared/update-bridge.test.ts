import { describe, expect, it } from 'vitest';

import {
  shouldShowHeaderUpdate,
  validatedUpdateCommand,
  validatedUpdateState,
} from './update-bridge.js';

describe('desktop update bridge', () => {
  it('accepts only the two supported renderer commands', () => {
    expect(validatedUpdateCommand('check')).toBe('check');
    expect(validatedUpdateCommand('install')).toBe('install');
    expect(validatedUpdateCommand('open-terminal')).toBeUndefined();
  });

  it('validates bounded update snapshots crossing into the renderer', () => {
    expect(
      validatedUpdateState({
        status: 'downloaded',
        currentVersion: '0.1.0',
        releaseName: '0.2.0',
        releaseNotes: 'Ready',
      }),
    ).toEqual({
      status: 'downloaded',
      currentVersion: '0.1.0',
      releaseName: '0.2.0',
      releaseNotes: 'Ready',
    });
    expect(
      validatedUpdateState({ status: 'owned', currentVersion: '0.1.0' }),
    ).toBeUndefined();
  });

  it('shows the compact Harness action only while an update is actionable', () => {
    expect(
      shouldShowHeaderUpdate({ status: 'latest', currentVersion: '0.1.0' }),
    ).toBe(false);
    expect(
      shouldShowHeaderUpdate({ status: 'downloading', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'downloaded', currentVersion: '0.1.0' }),
    ).toBe(true);
  });
});
