import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import {
  createWindowsCandidateManifest,
  resolveWindowsPortableArtifactName,
  resolveWindowsInstallerArtifactName,
  type WindowsCandidateArtifact,
} from '../src/main/windows-candidate.ts';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows candidates must be prepared on a win32-x64 host');
}

const sourceDirectory = resolve(
  readArgument('--source') ?? join('out', 'make', 'nsis.windows', 'x64'),
);
const outputDirectory = resolve(
  readArgument('--output') ?? join('out', 'windows-candidate'),
);
const portableSourceDirectory = resolve(
  readArgument('--portable-source') ?? join('out', 'make', 'zip', 'win32', 'x64'),
);
const packageMetadata = JSON.parse(
  await readFile(resolve('package.json'), 'utf8'),
) as { readonly version?: string };
const version = packageMetadata.version?.trim();
if (version === undefined || version === '') {
  throw new Error('package.json must contain a version');
}

const setupName = resolveWindowsInstallerArtifactName(await readdir(sourceDirectory));
const portableSourceName = resolveWindowsPortableArtifactName(
  await readdir(portableSourceDirectory),
  version,
);
await mkdir(outputDirectory, { recursive: true });
const artifacts: WindowsCandidateArtifact[] = [];
for (const file of [setupName]) {
  const source = join(sourceDirectory, file);
  const destination = join(outputDirectory, basename(file));
  await copyFile(source, destination);
  const metadata = await stat(destination);
  artifacts.push({
    file: basename(destination),
    bytes: metadata.size,
    sha256: await sha256(destination),
  });
}
const portableName = `DeepSeek.YukiRyou-win32-x64-${version}-portable.zip`;
const portableDestination = join(outputDirectory, portableName);
await copyFile(
  join(portableSourceDirectory, portableSourceName),
  portableDestination,
);
artifacts.push({
  file: portableName,
  bytes: (await stat(portableDestination)).size,
  sha256: await sha256(portableDestination),
});

const gitCommit =
  process.env.GITHUB_SHA?.trim() ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const manifest = createWindowsCandidateManifest({
  version,
  gitCommit,
  artifacts,
});
await writeFile(
  join(outputDirectory, 'windows-candidate-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(
  join(outputDirectory, 'SHA256SUMS'),
  `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`).join('\n')}\n`,
);

console.log(
  `Prepared Windows ${version} candidate with ${artifacts.length} installer and portable artifacts`,
);

function readArgument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
