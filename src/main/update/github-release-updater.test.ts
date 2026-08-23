import { describe, expect, it, vi } from 'vitest';

import { compareVersions, GitHubReleaseAppUpdater } from './app-updater.js';

function releaseResponse(tag: string): Response {
  return new Response(JSON.stringify({
    tag_name: tag,
    name: tag,
    body: 'Release notes',
    html_url: `https://github.com/example/releases/tag/${tag}`,
    draft: false,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Windows GitHub release updater', () => {
  it('reports the installed formal release as latest without requesting Squirrel metadata', async () => {
    const request = vi.fn(async () => releaseResponse('v0.2.3-beta.2'));
    const updater = new GitHubReleaseAppUpdater({
      enabled: true,
      currentVersion: '0.2.3-beta.2',
      platform: 'win32',
      architecture: 'x64',
      onError: vi.fn(),
      fetchLatestRelease: request as typeof fetch,
    });

    await expect(updater.checkForUpdates()).resolves.toEqual({ status: 'not-available' });
    expect(updater.getState()).toMatchObject({ status: 'latest' });
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/repos/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('offers the verified release page when a newer Windows build exists', async () => {
    const updater = new GitHubReleaseAppUpdater({
      enabled: true,
      currentVersion: '0.2.3-beta.2',
      platform: 'win32',
      architecture: 'x64',
      onError: vi.fn(),
      fetchLatestRelease: (async () => releaseResponse('v0.2.3-beta.3')) as typeof fetch,
    });

    await expect(updater.checkForUpdates()).resolves.toEqual({ status: 'available' });
    expect(updater.getState()).toMatchObject({
      status: 'manual',
      releaseName: 'v0.2.3-beta.3',
    });
  });

  it('orders prerelease identifiers without treating beta.10 as beta.1', () => {
    expect(compareVersions('v0.2.3-beta.10', '0.2.3-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('0.2.3', '0.2.3-beta.10')).toBeGreaterThan(0);
  });
});
