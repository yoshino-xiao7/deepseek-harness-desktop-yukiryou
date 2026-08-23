export interface WindowsCandidateArtifact {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface WindowsCandidateManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly target: 'win32-x64';
  readonly gitCommit: string;
  readonly artifacts: readonly WindowsCandidateArtifact[];
}

export function resolveWindowsPortableArtifactName(
  files: readonly string[],
  version: string,
): string {
  const expected = `DeepSeek YukiRyou-win32-x64-${version}.zip`;
  const archives = files.filter((file) => file.endsWith('.zip'));
  if (archives.length !== 1 || archives[0] !== expected) {
    throw new Error(
      `Expected exactly ${expected} in Windows ZIP output, found ${archives.join(', ') || 'none'}`,
    );
  }
  return expected;
}

export function resolveWindowsInstallerArtifactName(
  files: readonly string[],
): string {
  const setup = files.filter((file) => file === 'DeepSeek-YukiRyou-Setup.exe');
  if (setup.length !== 1) {
    throw new Error('Expected exactly one DeepSeek-YukiRyou-Setup.exe in NSIS output');
  }
  return setup[0] as string;
}

export function createWindowsCandidateManifest(input: {
  readonly version: string;
  readonly gitCommit: string;
  readonly artifacts: readonly WindowsCandidateArtifact[];
}): WindowsCandidateManifest {
  if (input.version.trim() === '') throw new Error('Version is required');
  if (input.gitCommit.trim() === '') throw new Error('Git commit is required');
  for (const artifact of input.artifacts) {
    if (artifact.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      throw new Error(`Invalid candidate artifact metadata for ${artifact.file}`);
    }
  }

  return {
    schemaVersion: 1,
    version: input.version,
    target: 'win32-x64',
    gitCommit: input.gitCommit,
    artifacts: input.artifacts,
  };
}
