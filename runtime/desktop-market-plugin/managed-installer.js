import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  createArtifactStore,
  extractVerifiedArchive,
} from './artifact-verifier.js';

const MAX_NODES = 256;
const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_GRAPH_TARBALL_BYTES = 128 * 1024 * 1024;
const MAX_GRAPH_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_GRAPH_FILES = 20_000;
const GENERATION_PATTERN = /^gen-[a-f0-9]{64}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SHA512_DIGEST_PATTERN = /^sha512:[a-f0-9]{128}$/u;
const SHA512_INTEGRITY_PATTERN = /^sha512-([A-Za-z0-9+/]{86}==)$/u;
const PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;

export function createManagedPluginInstaller(options = {}) {
  const root = options.root ?? process.env.DSH_HOME;
  if (typeof root !== 'string' || root.length === 0) return disabledInstaller();
  const artifactStore = options.artifactStore ?? createArtifactStore({ root });
  const linkDirectory = options.linkDirectory ?? defaultLinkDirectory;
  const runtimeModulesRoot = options.runtimeModulesRoot ?? fileURLToPath(new URL('../../', import.meta.url));
  const userPlugins = join(root, 'user-plugins');
  const generations = join(userPlugins, 'generations');
  const staging = join(userPlugins, '.staging');

  return Object.freeze({
    async stage({ generation, plan } = {}) {
      assertGeneration(generation);
      const normalized = normalizePlan(plan);
      await ensureSafeDirectory(userPlugins);
      await ensureSafeDirectory(generations);
      await ensureSafeDirectory(staging);
      const destination = join(generations, generation);
      const existing = await readPublishedGeneration(destination, generation, normalized.lockHash);
      if (existing !== undefined) return existing;

      const temporary = join(staging, `${generation}.${randomUUID()}`);
      await mkdir(temporary, { mode: 0o700 });
      try {
        const packagePaths = new Map();
        for (const artifact of normalized.artifacts) {
          const bytes = await artifactStore.read(artifact.digest);
          if (bytes === undefined) throw installerError('cache-miss', 'Verified artifact is missing from cache');
          if (!Buffer.isBuffer(bytes) || bytes.length !== artifact.compressedBytes ||
            `sha512:${createHash('sha512').update(bytes).digest('hex')}` !== artifact.digest) {
            throw installerError('cache-integrity', 'Verified artifact cache object changed');
          }
          const files = extractVerifiedArchive(bytes, {
            name: artifact.name,
            version: artifact.version,
            requiredBundle: artifact.id === normalized.root ? normalized.rootBundlePath : undefined,
            dependencies: artifact.declaredDependencies,
            peerDependencies: artifact.declaredPeers,
            maxArchiveBytes: artifact.archiveBytes,
            expectedArchiveBytes: artifact.archiveBytes,
            maxUnpackedBytes: artifact.unpackedBytes,
          });
          if (files.length !== artifact.fileCount ||
            files.reduce((total, file) => total + file.bytes.length, 0) !== artifact.unpackedBytes) {
            throw installerError('archive-drift', 'Verified artifact no longer matches frozen archive metadata');
          }
          const packagePath = join(
            temporary,
            'node_modules',
            '.store',
            nodeKey(artifact.id),
            'node_modules',
            ...artifact.name.split('/'),
          );
          await mkdir(packagePath, { recursive: true, mode: 0o700 });
          for (const file of files) {
            const target = join(packagePath, ...file.path.split('/'));
            await mkdir(dirname(target), { recursive: true, mode: 0o700 });
            await writeFile(target, file.bytes, {
              flag: 'wx',
              mode: file.executable ? 0o700 : 0o600,
            });
          }
          packagePaths.set(artifact.id, packagePath);
        }

        const runtimePackages = new Map();
        for (const peer of normalized.peerLinks) {
          const packagePath = packagePaths.get(peer.from);
          if (packagePath === undefined) throw installerError('invalid-plan', 'Frozen peer owner is missing');
          const existingDependency = normalized.artifacts
            .find((artifact) => artifact.id === peer.from)?.dependencies
            .find((dependency) => dependency.name === peer.name);
          if (existingDependency !== undefined) {
            if (peer.provider !== 'graph' || existingDependency.to !== peer.to) {
              throw installerError('invalid-plan', 'Frozen peer conflicts with dependency link');
            }
            continue;
          }
          const target = peer.provider === 'graph'
            ? packagePaths.get(peer.to)
            : await resolveRuntimePackage(runtimeModulesRoot, peer, runtimePackages);
          if (target === undefined) throw installerError('invalid-plan', 'Frozen peer target is missing');
          const linkPath = join(packagePath, 'node_modules', ...peer.name.split('/'));
          await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });
          await linkDirectory(target, linkPath, {
            platform: process.platform, temporary, destination,
          });
        }

        for (const artifact of normalized.artifacts) {
          const packagePath = packagePaths.get(artifact.id);
          if (packagePath === undefined) throw installerError('invalid-plan', 'Frozen package path is missing');
          for (const dependency of artifact.dependencies) {
            const target = packagePaths.get(dependency.to);
            if (target === undefined) throw installerError('invalid-plan', 'Frozen dependency target is missing');
            const linkPath = join(packagePath, 'node_modules', ...dependency.name.split('/'));
            await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });
            await linkDirectory(target, linkPath, {
              platform: process.platform, temporary, destination,
            });
          }
        }

        const rootPackage = packagePaths.get(normalized.root);
        if (rootPackage === undefined) throw installerError('invalid-plan', 'Frozen root package is missing');
        const rootArtifact = normalized.artifacts.find((artifact) => artifact.id === normalized.root);
        const rootLink = join(temporary, 'node_modules', ...rootArtifact.name.split('/'));
        await mkdir(dirname(rootLink), { recursive: true, mode: 0o700 });
        await linkDirectory(rootPackage, rootLink, {
          platform: process.platform, temporary, destination,
        });
        const manifest = {
          schemaVersion: 1,
          generation,
          graphHash: normalized.graphHash,
          runtimeSnapshotHash: normalized.runtimeSnapshotHash,
          lockHash: normalized.lockHash,
          root: normalized.root,
          rootBundlePath: normalized.rootBundlePath,
          packageCount: normalized.artifacts.length,
        };
        await writeFile(
          join(temporary, '.dsh-generation.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
          { flag: 'wx', mode: 0o600 },
        );
        await rename(temporary, destination);
        return Object.freeze({ status: 'staged', path: destination, ...manifest });
      } catch (error) {
        await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        if (error?.code?.startsWith('catalog:')) throw error;
        throw installerError('stage-failed', 'Could not assemble managed plugin generation', error);
      }
    },
  });
}

function normalizePlan(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !SHA256_PATTERN.test(value.graphHash ?? '') ||
    !SHA256_PATTERN.test(value.runtimeSnapshotHash ?? '') ||
    !SHA256_PATTERN.test(value.lockHash ?? '') || typeof value.root !== 'string' ||
    !validRelativePath(value.rootBundlePath) || !Array.isArray(value.artifacts) ||
    value.artifacts.length === 0 || value.artifacts.length > MAX_NODES ||
    !Array.isArray(value.peerLinks) || value.peerLinks.length > 1_024) {
    throw installerError('invalid-plan', 'Invalid frozen installation plan');
  }
  const ids = new Set();
  let compressedBytes = 0;
  let archiveBytes = 0;
  let unpackedBytes = 0;
  let fileCount = 0;
  const artifacts = value.artifacts.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !PACKAGE_PATTERN.test(item.name ?? '') ||
      typeof item.version !== 'string' || item.version.length === 0 || item.version.length > 100 ||
      item.id !== `${item.name}@${item.version}` || !SHA512_DIGEST_PATTERN.test(item.digest ?? '') ||
      !SHA512_INTEGRITY_PATTERN.test(item.integrity ?? '') || integrityDigest(item.integrity) !== item.digest ||
      !Number.isSafeInteger(item.compressedBytes) || item.compressedBytes <= 0 || item.compressedBytes > MAX_TARBALL_BYTES ||
      !Number.isSafeInteger(item.archiveBytes) || item.archiveBytes <= 0 ||
      !Number.isSafeInteger(item.unpackedBytes) || item.unpackedBytes < 0 ||
      !Number.isSafeInteger(item.fileCount) || item.fileCount < 1 ||
      !Array.isArray(item.dependencies) || !Array.isArray(item.declaredDependencies) ||
      !Array.isArray(item.declaredPeers)) {
      throw installerError('invalid-plan', 'Invalid frozen installation artifact');
    }
    if (ids.has(item.id)) throw installerError('invalid-plan', 'Duplicate frozen installation artifact');
    ids.add(item.id);
    const dependencyNames = new Set();
    const dependencies = item.dependencies.map((edge) => {
      if (!isRecord(edge) || !PACKAGE_PATTERN.test(edge.name ?? '') || typeof edge.to !== 'string' ||
        (edge.kind !== 'runtime' && edge.kind !== 'optional') || dependencyNames.has(edge.name)) {
        throw installerError('invalid-plan', 'Invalid frozen dependency link');
      }
      dependencyNames.add(edge.name);
      return Object.freeze({ name: edge.name, to: edge.to, kind: edge.kind });
    });
    const declarationNames = new Set();
    const declaredDependencies = item.declaredDependencies.map((edge) => {
      if (!isRecord(edge) || !PACKAGE_PATTERN.test(edge.name ?? '') || typeof edge.requested !== 'string' ||
        edge.requested.length === 0 || (edge.kind !== 'runtime' && edge.kind !== 'optional') ||
        declarationNames.has(edge.name)) {
        throw installerError('invalid-plan', 'Invalid frozen dependency declaration');
      }
      declarationNames.add(edge.name);
      return Object.freeze({ name: edge.name, requested: edge.requested, kind: edge.kind });
    });
    const peerNames = new Set();
    const declaredPeers = item.declaredPeers.map((peer) => {
      if (!isRecord(peer) || !PACKAGE_PATTERN.test(peer.name ?? '') ||
        typeof peer.range !== 'string' || peer.range.length === 0 || peer.range.length > 200 ||
        typeof peer.optional !== 'boolean' || peerNames.has(peer.name)) {
        throw installerError('invalid-plan', 'Invalid frozen peer declaration');
      }
      peerNames.add(peer.name);
      return Object.freeze({ name: peer.name, range: peer.range, optional: peer.optional });
    });
    compressedBytes += item.compressedBytes;
    archiveBytes += item.archiveBytes;
    unpackedBytes += item.unpackedBytes;
    fileCount += item.fileCount;
    return Object.freeze({
      id: item.id,
      name: item.name,
      version: item.version,
      integrity: item.integrity,
      digest: item.digest,
      compressedBytes: item.compressedBytes,
      archiveBytes: item.archiveBytes,
      unpackedBytes: item.unpackedBytes,
      fileCount: item.fileCount,
      dependencies: Object.freeze(dependencies),
      declaredDependencies: Object.freeze(declaredDependencies),
      declaredPeers: Object.freeze(declaredPeers),
    });
  });
  if (compressedBytes > MAX_GRAPH_TARBALL_BYTES || archiveBytes > MAX_GRAPH_UNPACKED_BYTES ||
    unpackedBytes > MAX_GRAPH_UNPACKED_BYTES ||
    fileCount > MAX_GRAPH_FILES) {
    throw installerError('invalid-plan', 'Frozen installation plan exceeded resource budget');
  }
  if (!ids.has(value.root)) throw installerError('invalid-plan', 'Frozen installation root is missing');
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  for (const artifact of artifacts) {
    for (const dependency of artifact.dependencies) {
      const target = artifactsById.get(dependency.to);
      if (target === undefined || target.name !== dependency.name) {
        throw installerError('invalid-plan', 'Frozen dependency target is missing or mismatched');
      }
      const declaration = artifact.declaredDependencies.find((item) => item.name === dependency.name);
      if (declaration === undefined || declaration.kind !== dependency.kind) {
        throw installerError('invalid-plan', 'Frozen dependency declaration is missing or mismatched');
      }
    }
    for (const declaration of artifact.declaredDependencies) {
      if (declaration.kind === 'runtime' &&
        !artifact.dependencies.some((dependency) => dependency.name === declaration.name)) {
        throw installerError('invalid-plan', 'Frozen runtime dependency has no resolved target');
      }
    }
  }
  const peerKeys = new Set();
  const peerLinks = value.peerLinks.map((peer) => {
    if (!isRecord(peer) || typeof peer.from !== 'string' || !PACKAGE_PATTERN.test(peer.name ?? '') ||
      typeof peer.version !== 'string' || peer.version.length === 0 || peer.version.length > 100 ||
      (peer.provider !== 'runtime' && peer.provider !== 'graph') ||
      (peer.provider === 'graph' && typeof peer.to !== 'string')) {
      throw installerError('invalid-plan', 'Invalid frozen peer link');
    }
    const key = `${peer.from}\0${peer.name}`;
    if (peerKeys.has(key) || !artifactsById.has(peer.from)) {
      throw installerError('invalid-plan', 'Duplicate or orphaned frozen peer link');
    }
    peerKeys.add(key);
    if (peer.provider === 'graph') {
      const target = artifactsById.get(peer.to);
      if (target === undefined || target.name !== peer.name || target.version !== peer.version) {
        throw installerError('invalid-plan', 'Frozen graph peer target is missing or mismatched');
      }
    }
    const declaration = artifactsById.get(peer.from)?.declaredPeers
      .find((item) => item.name === peer.name);
    if (declaration === undefined) throw installerError('invalid-plan', 'Frozen peer declaration is missing');
    return Object.freeze({
      from: peer.from,
      name: peer.name,
      provider: peer.provider,
      version: peer.version,
      ...(peer.provider === 'graph' ? { to: peer.to } : {}),
    });
  });
  for (const artifact of artifacts) {
    for (const peer of artifact.declaredPeers) {
      if (!peer.optional && !peerLinks.some((link) => link.from === artifact.id && link.name === peer.name)) {
        throw installerError('invalid-plan', 'Required frozen peer has no provider');
      }
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    graphHash: value.graphHash,
    runtimeSnapshotHash: value.runtimeSnapshotHash,
    lockHash: value.lockHash,
    root: value.root,
    rootBundlePath: value.rootBundlePath,
    peerLinks: Object.freeze(peerLinks),
    artifacts: Object.freeze(artifacts.sort((left, right) => left.id.localeCompare(right.id))),
  });
}

async function resolveRuntimePackage(runtimeModulesRoot, peer, cache) {
  const cached = cache.get(peer.name);
  if (cached !== undefined) return cached;
  const root = await realpath(runtimeModulesRoot);
  const candidate = join(root, ...peer.name.split('/'));
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    throw installerError('runtime-peer-missing', 'Bundled Runtime peer is unavailable', error);
  }
  const containment = relative(root, resolved);
  if (containment === '..' || containment.startsWith('../') || containment.startsWith('..\\')) {
    throw installerError('unsafe-path', 'Bundled Runtime peer escaped node_modules');
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(resolved, 'package.json'), 'utf8'));
  } catch (error) {
    throw installerError('runtime-peer-invalid', 'Bundled Runtime peer manifest is invalid', error);
  }
  if (manifest?.name !== peer.name || manifest?.version !== peer.version) {
    throw installerError('runtime-peer-invalid', 'Bundled Runtime peer identity changed');
  }
  cache.set(peer.name, resolved);
  return resolved;
}

async function ensureSafeDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw installerError('unsafe-path', 'Managed plugin directory is unsafe');
  }
}

async function readPublishedGeneration(path, generation, lockHash) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw installerError('unsafe-path', 'Managed generation path is unsafe');
  }
  try {
    const manifest = JSON.parse(await readFile(join(path, '.dsh-generation.json'), 'utf8'));
    if (manifest?.schemaVersion !== 1 || manifest.generation !== generation || manifest.lockHash !== lockHash) {
      throw installerError('generation-conflict', 'Managed generation already exists with different contents');
    }
    return Object.freeze({ status: 'reused', path, ...manifest });
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      throw installerError('generation-conflict', 'Managed generation has no valid manifest', error);
    }
    throw error;
  }
}

function integrityDigest(integrity) {
  const match = SHA512_INTEGRITY_PATTERN.exec(integrity);
  if (match === null) return undefined;
  const bytes = Buffer.from(match[1], 'base64');
  return bytes.length === 64 ? `sha512:${bytes.toString('hex')}` : undefined;
}

async function defaultLinkDirectory(target, path, context = {}) {
  const platform = context.platform ?? process.platform;
  const resolvedTarget = await realpath(target);
  const resolvedTemporary = typeof context.temporary === 'string'
    ? await realpath(context.temporary)
    : context.temporary;
  const resolvedDestination = typeof context.destination === 'string'
    ? join(await realpath(dirname(context.destination)), basename(context.destination))
    : context.destination;
  const linkTarget = platform === 'win32'
    ? resolvePublishedJunctionTarget(
        resolvedTarget,
        resolvedTemporary,
        resolvedDestination,
      )
    : relative(await realpath(dirname(path)), resolvedTarget);
  await symlink(linkTarget, path, platform === 'win32' ? 'junction' : 'dir');
}

export function resolvePublishedJunctionTarget(target, temporary, destination) {
  if (typeof temporary !== 'string' || typeof destination !== 'string') return target;
  const stagingRelative = relative(temporary, target);
  if (stagingRelative === '' || (
    stagingRelative !== '..' &&
    !stagingRelative.startsWith('../') &&
    !stagingRelative.startsWith('..\\')
  )) {
    return join(destination, stagingRelative);
  }
  return target;
}

function nodeKey(id) {
  return createHash('sha256').update(id).digest('hex').slice(0, 24);
}

function assertGeneration(value) {
  if (!GENERATION_PATTERN.test(value ?? '')) throw installerError('invalid-generation', 'Invalid profile generation');
}

function validRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 &&
    !value.includes('\\') && !value.startsWith('/') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function disabledInstaller() {
  return Object.freeze({
    async stage() {
      throw installerError('disabled', 'Managed installer requires Runtime Home');
    },
  });
}

function installerError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = `catalog:installer-${code}`;
  return error;
}
