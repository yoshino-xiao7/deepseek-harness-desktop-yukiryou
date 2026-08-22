import { describe, expect, it } from 'vitest';

import {
  createWindowsCandidateManifest,
  resolveWindowsSquirrelArtifactNames,
  validateWindowsReleases,
} from './windows-candidate.js';

describe('Windows candidate artifacts', () => {
  it('requires one setup executable, one full package, and RELEASES', () => {
    expect(
      resolveWindowsSquirrelArtifactNames([
        'DeepSeek-YukiRyou-Setup.exe',
        'DeepSeekYukiRyou-0.2.3-beta.1-full.nupkg',
        'RELEASES',
      ]),
    ).toEqual({
      setup: 'DeepSeek-YukiRyou-Setup.exe',
      package: 'DeepSeekYukiRyou-0.2.3-beta.1-full.nupkg',
      releases: 'RELEASES',
    });
  });

  it('rejects incomplete or ambiguous Squirrel output', () => {
    expect(() =>
      resolveWindowsSquirrelArtifactNames(['DeepSeek-YukiRyou-Setup.exe']),
    ).toThrow('Expected exactly one Squirrel full package');
    expect(() =>
      resolveWindowsSquirrelArtifactNames([
        'DeepSeek-YukiRyou-Setup.exe',
        'one-full.nupkg',
        'two-full.nupkg',
        'RELEASES',
      ]),
    ).toThrow('Expected exactly one Squirrel full package');
  });

  it('requires RELEASES to bind the exact full package and byte size', () => {
    expect(() =>
      validateWindowsReleases(
        `${'a'.repeat(40)} package-full.nupkg 4096\n`,
        'package-full.nupkg',
        4096,
      ),
    ).not.toThrow();
    expect(() =>
      validateWindowsReleases(
        `${'a'.repeat(40)} other-full.nupkg 4096\n`,
        'package-full.nupkg',
        4096,
      ),
    ).toThrow('does not bind package-full.nupkg');
  });

  it('records immutable Windows candidate provenance', () => {
    expect(
      createWindowsCandidateManifest({
        version: '0.2.3-beta.1',
        gitCommit: 'abc123',
        artifacts: [
          {
            file: 'DeepSeek-YukiRyou-Setup.exe',
            bytes: 123,
            sha256: 'a'.repeat(64),
          },
        ],
      }),
    ).toEqual({
      schemaVersion: 1,
      version: '0.2.3-beta.1',
      target: 'win32-x64',
      gitCommit: 'abc123',
      artifacts: [
        {
          file: 'DeepSeek-YukiRyou-Setup.exe',
          bytes: 123,
          sha256: 'a'.repeat(64),
        },
      ],
    });
  });
});
