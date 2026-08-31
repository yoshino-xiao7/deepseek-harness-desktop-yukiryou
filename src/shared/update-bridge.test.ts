import { describe, expect, it } from 'vitest';

import {
  shouldShowHeaderUpdate,
  validatedUpdateCommand,
  validatedUpdateState,
} from './update-bridge.js';

describe('desktop update bridge', () => {
  it('accepts only the supported renderer commands', () => {
    expect(validatedUpdateCommand('check')).toBe('check');
    expect(validatedUpdateCommand('install')).toBe('install');
    expect(validatedUpdateCommand('download')).toBe('download');
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

  it('accepts bounded progress only while downloading', () => {
    expect(validatedUpdateState({
      status: 'downloading',
      currentVersion: '1.0.6',
      downloadPercent: 42.6,
    })).toMatchObject({ downloadPercent: 42.6 });
    expect(validatedUpdateState({
      status: 'downloading',
      currentVersion: '1.0.6',
      downloadPercent: 101,
    })).toBeUndefined();
    expect(validatedUpdateState({
      status: 'downloaded',
      currentVersion: '1.0.6',
      downloadPercent: 100,
    })).toBeUndefined();
  });

  it('hides the Harness update action when updates are unavailable or already current', () => {
    expect(
      shouldShowHeaderUpdate({ status: 'latest', currentVersion: '0.1.0' }),
    ).toBe(false);
    expect(
      shouldShowHeaderUpdate({ status: 'idle', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'checking', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'error', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'downloading', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'downloaded', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'manual', currentVersion: '0.1.0' }),
    ).toBe(true);
    expect(
      shouldShowHeaderUpdate({ status: 'disabled', currentVersion: '0.1.0' }),
    ).toBe(false);
  });
});
