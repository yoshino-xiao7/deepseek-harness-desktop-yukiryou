import { describe, expect, it } from 'vitest';

import {
  createWindowsCandidateManifest,
  resolveWindowsPortableArtifactName,
  resolveWindowsInstallerArtifactName,
} from './windows-candidate.js';

describe('Windows candidate artifacts', () => {
  it('requires the exact portable ZIP for the release version', () => {
    expect(
      resolveWindowsPortableArtifactName(
        ['DeepSeek YukiRyou-win32-x64-0.2.3-beta.1.zip'],
        '0.2.3-beta.1',
      ),
    ).toBe('DeepSeek YukiRyou-win32-x64-0.2.3-beta.1.zip');
    expect(() =>
      resolveWindowsPortableArtifactName(
        ['DeepSeek YukiRyou-win32-x64-0.2.2-beta.1.zip'],
        '0.2.3-beta.1',
      ),
    ).toThrow('Expected exactly');
  });

  it('requires one guided NSIS setup executable', () => {
    expect(
      resolveWindowsInstallerArtifactName([
        'DeepSeek-YukiRyou-Setup.exe',
      ]),
    ).toBe('DeepSeek-YukiRyou-Setup.exe');
  });

  it('rejects missing or ambiguous NSIS output', () => {
    expect(() =>
      resolveWindowsInstallerArtifactName([]),
    ).toThrow('Expected exactly one');
    expect(() =>
      resolveWindowsInstallerArtifactName([
        'DeepSeek-YukiRyou-Setup.exe',
        'DeepSeek-YukiRyou-Setup.exe',
      ]),
    ).toThrow('Expected exactly one');
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
