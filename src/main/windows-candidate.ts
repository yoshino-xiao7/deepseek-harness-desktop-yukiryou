export interface WindowsSquirrelArtifactNames {
  readonly setup: string;
  readonly package: string;
  readonly releases: 'RELEASES';
}

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

export function resolveWindowsSquirrelArtifactNames(
  files: readonly string[],
): WindowsSquirrelArtifactNames {
  const setup = files.filter((file) => file === 'DeepSeek-YukiRyou-Setup.exe');
  if (setup.length !== 1) {
    throw new Error('Expected DeepSeek-YukiRyou-Setup.exe in Squirrel output');
  }

  const packages = files.filter((file) => file.endsWith('-full.nupkg'));
  if (packages.length !== 1) {
    throw new Error(
      `Expected exactly one Squirrel full package, found ${packages.length}`,
    );
  }

  if (!files.includes('RELEASES')) {
    throw new Error('Expected RELEASES in Squirrel output');
  }

  const setupFile = setup[0];
  const packageFile = packages[0];
  if (setupFile === undefined || packageFile === undefined) {
    throw new Error('Squirrel output changed while resolving artifacts');
  }
  return { setup: setupFile, package: packageFile, releases: 'RELEASES' };
}

export function validateWindowsReleases(
  contents: string,
  packageFile: string,
  packageBytes: number,
): void {
  const matchingLine = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => {
      const fields = line.split(/\s+/u);
      return fields.length === 3 && fields[1] === packageFile;
    });
  if (matchingLine === undefined) {
    throw new Error(`RELEASES does not bind ${packageFile}`);
  }

  const [sha1, , recordedBytes] = matchingLine.split(/\s+/u);
  if (sha1 === undefined || !/^[a-f0-9]{40}$/iu.test(sha1)) {
    throw new Error(`RELEASES contains an invalid SHA-1 for ${packageFile}`);
  }
  if (Number(recordedBytes) !== packageBytes) {
    throw new Error(
      `RELEASES size for ${packageFile} is ${recordedBytes}, expected ${packageBytes}`,
    );
  }
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
