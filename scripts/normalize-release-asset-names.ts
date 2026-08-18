import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

interface ReleaseArtifact {
  readonly file: string;
  readonly sha256: string;
}

interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly artifacts: readonly ReleaseArtifact[];
  readonly [key: string]: unknown;
}

const options = new Map(
  process.argv
    .slice(2)
    .filter((value) => value.startsWith('--') && value.includes('='))
    .map((value) => {
      const separator = value.indexOf('=');
      return [value.slice(2, separator), value.slice(separator + 1)];
    }),
);
const directory = resolve(requiredOption('directory'));
const metadataOnly = options.get('metadata-only') === 'true';
const manifestPath = join(directory, 'release-manifest.json');
const checksumsPath = join(directory, 'SHA256SUMS.txt');
const manifest = JSON.parse(
  await readFile(manifestPath, 'utf8'),
) as ReleaseManifest;
const recordedChecksums = parseChecksums(await readFile(checksumsPath, 'utf8'));

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) {
  throw new Error('Invalid release manifest');
}

const artifacts: ReleaseArtifact[] = [];
for (const artifact of manifest.artifacts) {
  const recordedDigest = recordedChecksums.get(artifact.file);
  if (recordedDigest !== artifact.sha256) {
    throw new Error(`Checksum metadata mismatch for ${artifact.file}`);
  }
  const canonicalFile = canonicalAssetFileName(artifact.file);
  if (!metadataOnly) {
    const sourcePath = join(directory, artifact.file);
    const canonicalPath = join(directory, canonicalFile);
    if (artifact.file !== canonicalFile && (await pathExists(sourcePath))) {
      await rename(sourcePath, canonicalPath);
    }
    if ((await sha256(canonicalPath)) !== artifact.sha256) {
      throw new Error(`Artifact digest mismatch for ${canonicalFile}`);
    }
  }
  artifacts.push({ file: canonicalFile, sha256: artifact.sha256 });
}

await writeFile(
  manifestPath,
  `${JSON.stringify({ ...manifest, artifacts }, null, 2)}\n`,
);
await writeFile(
  checksumsPath,
  `${artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.file}`)
    .join('\n')}\n`,
);
process.stdout.write(`Release asset names normalized in ${directory}\n`);

function canonicalAssetFileName(file: string): string {
  return basename(file).replaceAll('DeepSeek YukiRyou', 'DeepSeek.YukiRyou');
}

function parseChecksums(value: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of value.trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
    if (match === null) throw new Error(`Invalid checksum line: ${line}`);
    checksums.set(match[2]!, match[1]!);
  }
  return checksums;
}

function requiredOption(name: string): string {
  const value = options.get(name);
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required option: --${name}=...`);
  }
  return value;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest('hex');
}
