import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { requestNpmTarball } from './catalog-network.js';
import { createArtifactCache } from './artifact-cache.js';

const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_GRAPH_TARBALL_BYTES = 128 * 1024 * 1024;
const MAX_GRAPH_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_GRAPH_FILES = 20_000;
const MAX_PATH_BYTES = 240;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const SHA512_PATTERN = /^sha512-([A-Za-z0-9+/]{86}==)$/u;

export function createArtifactVerifier(options = {}) {
  const requestTarball = options.requestTarball ?? requestNpmTarball;
  const store = options.store ?? createArtifactCache({ root: options.root });

  return Object.freeze({
    async verify({ graph, rootBundlePath } = {}) {
      assertGraph(graph);
      if (!validRelativePath(rootBundlePath)) throw artifactError('bundle-path', 'Invalid root bundle path');
      const releaseCache = typeof store.hold === 'function'
        ? store.hold(graph.nodes.map((node) => integrityDigest(node.integrity)))
        : () => undefined;
      const artifacts = [];
      let compressedBytes = 0;
      let unpackedBytes = 0;
      let fileCount = 0;

      try {
      for (const node of graph.nodes) {
        const expectedDigest = integrityDigest(node.integrity);
        const cached = typeof store.read === 'function' ? await store.read(expectedDigest) : undefined;
        const bytes = cached ?? await requestTarball({ packageName: node.name, version: node.version, tarball: node.tarball });
        if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_TARBALL_BYTES) {
          throw artifactError('tarball-budget', 'Tarball exceeded compressed byte budget');
        }
        compressedBytes += bytes.length;
        if (compressedBytes > MAX_GRAPH_TARBALL_BYTES) {
          throw artifactError('graph-budget', 'Dependency graph exceeded compressed byte budget');
        }
        const digest = verifyIntegrity(bytes, node.integrity);
        const declaredDependencies = [
          ...graph.edges.filter((edge) => edge.from === node.id),
          ...graph.optionalSkipped.filter((edge) => edge.from === node.id).map((edge) => ({ ...edge, kind: 'optional' })),
        ];
        const declaredPeers = graph.peerRequirements.filter((peer) => peer.from === node.id);
        const archive = inspectArchive(bytes, {
          name: node.name,
          version: node.version,
          requiredBundle: node.id === graph.root ? rootBundlePath : undefined,
          dependencies: declaredDependencies,
          peerDependencies: declaredPeers,
          maxOutputLength: MAX_GRAPH_UNPACKED_BYTES - unpackedBytes,
        });
        unpackedBytes += archive.unpackedBytes;
        fileCount += archive.fileCount;
        if (unpackedBytes > MAX_GRAPH_UNPACKED_BYTES || fileCount > MAX_GRAPH_FILES) {
          throw artifactError('graph-budget', 'Dependency graph exceeded unpacked archive budget');
        }
        if (cached === undefined) await store.put({ digest, bytes });
        artifacts.push(Object.freeze({
          id: node.id,
          integrity: node.integrity,
          digest,
          compressedBytes: bytes.length,
          archiveBytes: archive.archiveBytes,
          unpackedBytes: archive.unpackedBytes,
          fileCount: archive.fileCount,
          name: node.name,
          version: node.version,
          dependencies: Object.freeze(graph.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) => Object.freeze({ name: edge.name, to: edge.to, kind: edge.kind }))),
          declaredDependencies: Object.freeze(declaredDependencies
            .map((edge) => Object.freeze({ name: edge.name, requested: edge.requested, kind: edge.kind }))),
          declaredPeers: Object.freeze(declaredPeers.map((peer) => Object.freeze({
            name: peer.name, range: peer.range, optional: peer.optional,
          }))),
        }));
      }

      const canonicalArtifacts = artifacts.sort((left, right) => left.id.localeCompare(right.id));
      const peerLinks = Object.freeze(
        graph.peerCompatibility.resolutions
          .filter((peer) => peer.state === 'satisfied')
          .map((peer) => Object.freeze({
            from: peer.from,
            name: peer.name,
            provider: peer.provider,
            version: peer.version,
            ...(peer.provider === 'graph' ? { to: `${peer.name}@${peer.version}` } : {}),
          }))
          .sort((left, right) => `${left.from}\0${left.name}`.localeCompare(`${right.from}\0${right.name}`)),
      );
      const lock = Object.freeze({
        schemaVersion: 1,
        graphHash: graph.hash,
        runtimeSnapshotHash: graph.peerCompatibility.runtimeSnapshotHash,
        root: graph.root,
        peerLinks,
        artifacts: Object.freeze(canonicalArtifacts),
      });
      const lockHash = `sha256:${createHash('sha256').update(JSON.stringify(lock)).digest('hex')}`;
      return Object.freeze({
        status: 'verified',
        lockHash,
        installationPlan: Object.freeze({
          schemaVersion: 1,
          graphHash: graph.hash,
          runtimeSnapshotHash: graph.peerCompatibility.runtimeSnapshotHash,
          lockHash,
          root: graph.root,
          rootBundlePath,
          peerLinks,
          artifacts: Object.freeze(canonicalArtifacts),
        }),
        summary: Object.freeze({
          artifacts: canonicalArtifacts.length,
          compressedBytes,
          unpackedBytes,
          fileCount,
          cache: store.enabled === false ? 'memory-only' : 'content-addressed',
        }),
      });
      } finally {
        releaseCache();
      }
    },
  });
}

export { createArtifactCache as createArtifactStore } from './artifact-cache.js';

export function extractVerifiedArchive(compressed, identity) {
  return inspectArchive(compressed, identity, true).files;
}

function inspectArchive(compressed, identity, collectFiles = false) {
  let tar;
  try {
    tar = gunzipSync(compressed, {
      maxOutputLength: Math.max(1, identity.maxArchiveBytes ?? identity.maxOutputLength),
    });
  } catch (error) {
    throw artifactError('invalid-archive', 'Tarball is not a bounded gzip archive', error);
  }
  if (identity.expectedArchiveBytes !== undefined && tar.length !== identity.expectedArchiveBytes) {
    throw artifactError('archive-drift', 'Tar archive size no longer matches frozen metadata');
  }
  let offset = 0;
  let fileCount = 0;
  let unpackedBytes = 0;
  let packageIdentity;
  let bundleFound = identity.requiredBundle === undefined;
  let pendingPaxPath;
  let ended = false;
  const paths = new Map();
  const files = [];
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      if (!tar.subarray(offset).every((byte) => byte === 0)) throw artifactError('invalid-archive', 'Tar trailer is invalid');
      break;
    }
    verifyTarChecksum(header);
    const size = parseTarNumber(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const headerPath = tarPath(header);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > tar.length) {
      throw artifactError('invalid-archive', 'Tar entry exceeds archive bounds');
    }
    const data = tar.subarray(dataStart, dataEnd);
    if (type === 'x' || type === 'g') {
      if (size > MAX_PACKAGE_JSON_BYTES) throw artifactError('invalid-archive', 'Tar metadata entry exceeded budget');
      if (type === 'x') pendingPaxPath = parsePaxPath(data);
    } else {
      const path = pendingPaxPath ?? headerPath;
      pendingPaxPath = undefined;
      const relative = normalizeArchivePath(path, identity.name);
      if (relative === 'node_modules' || relative.startsWith('node_modules/')) {
        throw artifactError('unsafe-path', 'Archive contains installer-owned node_modules');
      }
      if (type !== '0' && type !== '5') throw artifactError('unsafe-entry', 'Archive contains unsupported entry type');
      const pathKey = relative.normalize('NFC').toLowerCase();
      const mode = parseTarNumber(header.subarray(100, 108));
      const fingerprint = `${type}:${mode}:${size}:${createHash('sha256').update(data).digest('hex')}`;
      const existingPath = paths.get(pathKey);
      if (existingPath !== undefined && (existingPath.relative !== relative || existingPath.fingerprint !== fingerprint)) {
        throw artifactError('unsafe-path', 'Archive contains conflicting duplicate paths');
      }
      const duplicate = existingPath !== undefined;
      if (!duplicate) paths.set(pathKey, Object.freeze({ relative, fingerprint }));
      if (type === '0' && !duplicate) {
        fileCount += 1;
        unpackedBytes += size;
        if (fileCount > MAX_GRAPH_FILES || unpackedBytes > (identity.maxUnpackedBytes ?? identity.maxOutputLength)) {
          throw artifactError('graph-budget', 'Archive exceeded unpacked budget');
        }
        if (relative === 'package.json') {
          if (size > MAX_PACKAGE_JSON_BYTES) throw artifactError('invalid-package', 'package.json exceeded budget');
          packageIdentity = parsePackageMetadata(data);
        }
        if (relative === identity.requiredBundle) bundleFound = true;
        if (collectFiles) {
          files.push(Object.freeze({
            path: relative,
            bytes: Buffer.from(data),
            executable: (mode & 0o111) !== 0,
          }));
        }
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!ended) throw artifactError('invalid-archive', 'Tar archive has no zero trailer');
  if (packageIdentity?.name !== identity.name || packageIdentity?.version !== identity.version) {
    throw artifactError('package-identity', 'Archive package identity does not match frozen graph');
  }
  if (identity.requiredBundle !== undefined && packageIdentity.lifecycleScripts.length > 0) {
    throw artifactError('lifecycle-scripts', 'Root plugin archive contains install lifecycle scripts');
  }
  if (JSON.stringify(packageIdentity.dependencies) !== JSON.stringify(normalizeExpectedDependencies(identity.dependencies))) {
    throw artifactError('dependency-mismatch', 'Archive dependencies do not match frozen graph');
  }
  if (JSON.stringify(packageIdentity.peerDependencies) !== JSON.stringify(normalizeExpectedPeers(identity.peerDependencies))) {
    throw artifactError('peer-mismatch', 'Archive peer dependencies do not match frozen graph');
  }
  if (!bundleFound) throw artifactError('bundle-missing', 'Declared DSH bundle is missing from archive');
  return Object.freeze({
    archiveBytes: tar.length,
    fileCount,
    unpackedBytes,
    files: collectFiles ? Object.freeze(files) : undefined,
  });
}

function normalizeArchivePath(value, packageName) {
  if (
    typeof value !== 'string' || value.includes('\\') || hasControlCharacter(value) ||
    value.startsWith('/') || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
  ) {
    throw artifactError('unsafe-path', 'Archive path is invalid');
  }
  const segments = value.split('/');
  while (segments.at(-1) === '') segments.pop();
  const packageBaseName = packageName.slice(packageName.lastIndexOf('/') + 1);
  const acceptedRoots = new Set(['package', packageBaseName]);
  if (
    segments.length === 0 || !acceptedRoots.has(segments[0]) ||
    segments.some((segment) => segment === '' || segment === '..')
  ) {
    throw artifactError('unsafe-path', 'Archive entry escaped package root');
  }
  return segments.slice(1).filter((segment) => segment !== '.').join('/');
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
}

function tarPath(header) {
  const name = tarString(header.subarray(0, 100));
  const prefix = tarString(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function tarString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
}

function parseTarNumber(bytes) {
  const value = tarString(bytes).trim().replace(/\0.*$/u, '');
  return /^[0-7]+$/u.test(value) ? Number.parseInt(value, 8) : Number.NaN;
}

function verifyTarChecksum(header) {
  const expected = parseTarNumber(header.subarray(148, 156));
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (!Number.isSafeInteger(expected) || expected !== actual) throw artifactError('invalid-archive', 'Tar header checksum mismatch');
}

function parsePaxPath(bytes) {
  const text = bytes.toString('utf8');
  for (const line of text.split('\n')) {
    const separator = line.indexOf(' ');
    if (separator > 0 && line.slice(separator + 1).startsWith('path=')) return line.slice(separator + 6);
  }
  return undefined;
}

function parsePackageMetadata(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    const dependencies = normalizePackageDependencies(value);
    const lifecycleScripts = ['preinstall', 'install', 'postinstall']
      .filter((name) => typeof value?.scripts?.[name] === 'string' && value.scripts[name].trim() !== '');
    return {
      name: value?.name,
      version: value?.version,
      dependencies,
      peerDependencies: normalizePackagePeers(value),
      lifecycleScripts,
    };
  } catch (error) {
    if (error?.code?.startsWith('catalog:')) throw error;
    throw artifactError('invalid-package', 'Archive package.json is invalid', error);
  }
}

function normalizePackageDependencies(value) {
  const dependencies = isRecord(value?.dependencies) ? value.dependencies : {};
  const optional = isRecord(value?.optionalDependencies) ? value.optionalDependencies : {};
  const names = [...new Set([...Object.keys(dependencies), ...Object.keys(optional)])].sort();
  return names.map((name) => {
    const kind = Object.hasOwn(optional, name) ? 'optional' : 'runtime';
    const requested = kind === 'optional' ? optional[name] : dependencies[name];
    if (typeof requested !== 'string') throw artifactError('invalid-package', 'Archive dependency declaration is invalid');
    return { name, requested, kind };
  });
}

function normalizeExpectedDependencies(value) {
  if (!Array.isArray(value)) throw artifactError('invalid-graph', 'Frozen dependency edges are invalid');
  return value.map((edge) => ({ name: edge.name, requested: edge.requested, kind: edge.kind }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizePackagePeers(value) {
  const peers = isRecord(value?.peerDependencies) ? value.peerDependencies : {};
  const metadata = isRecord(value?.peerDependenciesMeta) ? value.peerDependenciesMeta : {};
  return Object.keys(peers).sort().map((name) => {
    const range = peers[name];
    if (typeof range !== 'string') throw artifactError('invalid-package', 'Archive peer declaration is invalid');
    return { name, range, optional: metadata[name]?.optional === true };
  });
}

function normalizeExpectedPeers(value) {
  if (!Array.isArray(value)) throw artifactError('invalid-graph', 'Frozen peer requirements are invalid');
  return value.map((peer) => ({ name: peer.name, range: peer.range, optional: peer.optional === true }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function verifyIntegrity(bytes, integrity) {
  const match = SHA512_PATTERN.exec(integrity ?? '');
  if (match === null) throw artifactError('integrity', 'Frozen integrity is invalid');
  const actual = createHash('sha512').update(bytes).digest();
  const expected = Buffer.from(match[1], 'base64');
  if (expected.length !== actual.length || !actual.equals(expected)) throw artifactError('integrity', 'Tarball integrity mismatch');
  return `sha512:${actual.toString('hex')}`;
}

function integrityDigest(integrity) {
  const match = SHA512_PATTERN.exec(integrity ?? '');
  if (match === null) throw artifactError('integrity', 'Frozen integrity is invalid');
  const expected = Buffer.from(match[1], 'base64');
  if (expected.length !== 64) throw artifactError('integrity', 'Frozen integrity is invalid');
  return `sha512:${expected.toString('hex')}`;
}

function validRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_PATH_BYTES &&
    !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function assertGraph(graph) {
  if (
    !isRecord(graph) || graph.status !== 'frozen' || !/^sha256:[0-9a-f]{64}$/u.test(graph.hash ?? '') ||
    typeof graph.root !== 'string' || !Array.isArray(graph.nodes) || graph.nodes.length === 0 || graph.nodes.length > 256 ||
    !Array.isArray(graph.edges) || graph.edges.length > 1_024 ||
    !Array.isArray(graph.optionalSkipped) || graph.optionalSkipped.length > 1_024 ||
    !Array.isArray(graph.peerRequirements) || graph.peerRequirements.length > 1_024 ||
    !isRecord(graph.peerCompatibility) || graph.peerCompatibility.status !== 'compatible' ||
    !/^sha256:[0-9a-f]{64}$/u.test(graph.peerCompatibility.runtimeSnapshotHash ?? '') ||
    !Array.isArray(graph.peerCompatibility.resolutions) || graph.peerCompatibility.resolutions.length > 1_024
  ) throw artifactError('invalid-graph', 'Frozen dependency graph is invalid');
  for (const node of graph.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || typeof node.name !== 'string' || typeof node.version !== 'string' ||
      typeof node.tarball !== 'string' || !SHA512_PATTERN.test(node.integrity ?? '')) {
      throw artifactError('invalid-graph', 'Frozen dependency node is invalid');
    }
  }
  for (const edge of graph.edges) {
    if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.name !== 'string' || typeof edge.requested !== 'string' ||
      (edge.kind !== 'runtime' && edge.kind !== 'optional')) throw artifactError('invalid-graph', 'Frozen dependency edge is invalid');
  }
  for (const edge of graph.optionalSkipped) {
    if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.name !== 'string' || typeof edge.requested !== 'string') {
      throw artifactError('invalid-graph', 'Frozen optional dependency is invalid');
    }
  }
  for (const peer of graph.peerRequirements) {
    if (!isRecord(peer) || typeof peer.from !== 'string' || typeof peer.name !== 'string' ||
      typeof peer.range !== 'string' || typeof peer.optional !== 'boolean') {
      throw artifactError('invalid-graph', 'Frozen peer requirement is invalid');
    }
  }
  for (const peer of graph.peerCompatibility.resolutions) {
    if (!isRecord(peer) || typeof peer.from !== 'string' || typeof peer.name !== 'string' ||
      (peer.state === 'satisfied' &&
        ((peer.provider !== 'runtime' && peer.provider !== 'graph') || typeof peer.version !== 'string')) ||
      (peer.state !== 'satisfied' && peer.state !== 'optional-missing')) {
      throw artifactError('invalid-graph', 'Frozen peer resolution is invalid');
    }
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function artifactError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = `catalog:artifact-${code}`;
  error.check = 'artifact-bytes';
  return error;
}
