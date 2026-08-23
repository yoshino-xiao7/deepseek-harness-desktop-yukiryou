import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';

import { requestNpmManifest, requestNpmPackument } from './catalog-network.js';
import { createArtifactVerifier } from './artifact-verifier.js';
import { createDependencyGraphResolver } from './dependency-graph.js';

const CACHE_MS = 5 * 60 * 1000;
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const SHA512_PATTERN = /^sha512-([A-Za-z0-9+/]{86}==)$/u;
const LIFECYCLE_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall']);

export function createInstallInspector(options) {
  const catalog = options.catalog;
  const requestManifest = options.requestManifest ?? requestNpmManifest;
  const requestPackument = options.requestPackument ?? requestNpmPackument;
  const now = options.now ?? (() => Date.now());
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const graphResolver = options.graphResolver ?? createDependencyGraphResolver({
    requestManifest, platform, architecture,
  });
  const artifactVerifier = options.artifactVerifier ?? createArtifactVerifier();
  const cache = new Map();
  const inFlight = new Map();

  async function inspectVerified({ sourceRecordId, itemId, versionPreference = 'latest' } = {}) {
      if (typeof sourceRecordId !== 'string' || sourceRecordId.length > 100 || typeof itemId !== 'string' || itemId.length > 320) {
        throw inspectionError('invalid-request', 'Invalid catalog identity');
      }
      if (versionPreference !== 'catalog' && versionPreference !== 'latest') {
        throw inspectionError('invalid-request', 'Invalid version preference');
      }
      const key = `${sourceRecordId}\0${itemId}\0${versionPreference}`;
      const timestamp = now();
      const cached = cache.get(key);
      if (cached !== undefined && timestamp - cached.storedAt < CACHE_MS) return cached.value;
      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;
      const operation = (async () => {
        const snapshot = await catalog.read({ sourceId: sourceRecordId });
        const item = snapshot.items.find((entry) => entry.id === itemId);
        if (item === undefined) throw inspectionError('item-not-found', 'Catalog item is unavailable');
        if (
          item.installability?.state !== 'candidate' ||
          !isRecord(item.package) ||
          !NPM_PACKAGE_PATTERN.test(item.package.name ?? '') ||
          !STABLE_VERSION_PATTERN.test(item.package.version ?? '')
        ) throw inspectionError('not-candidate', 'Catalog item is not eligible for inspection');
        const resolved = versionPreference === 'latest'
          ? await resolveLatestCandidate(item, requestPackument)
          : Object.freeze({ item, catalogVersion: item.package.version });
        const manifest = await requestManifest(resolved.item.package.name, resolved.item.package.version);
        const value = await inspectManifest(resolved.item, manifest, {
          catalogVersion: resolved.catalogVersion,
          observedAt: new Date(now()).toISOString(), platform, architecture,
        }, graphResolver, artifactVerifier);
        cache.set(key, { value, storedAt: now() });
        return value;
      })();
      inFlight.set(key, operation);
      try {
        return await operation;
      } finally {
        inFlight.delete(key);
      }
  }

  return Object.freeze({
    async inspect(identity) {
      return (await inspectVerified(identity)).value;
    },
    inspectVerified,
  });
}

async function resolveLatestCandidate(item, requestPackument) {
  const catalogVersion = item.package.version;
  if (item.provenance?.sourceId === 'desktop-development-fixture') {
    return Object.freeze({ item, catalogVersion });
  }
  const packument = await requestPackument(item.package.name);
  const tags = isRecord(packument) && isRecord(packument['dist-tags']) ? packument['dist-tags'] : undefined;
  const latest = tags?.latest;
  if (typeof latest !== 'string' || !STABLE_VERSION_PATTERN.test(latest)) {
    throw inspectionError('invalid-metadata', 'npm latest version is unavailable');
  }
  if (compareStableVersions(latest, catalogVersion) <= 0) {
    return Object.freeze({ item, catalogVersion });
  }
  return Object.freeze({
    catalogVersion,
    item: Object.freeze({
      ...item,
      package: Object.freeze({ ...item.package, version: latest }),
    }),
  });
}

function compareStableVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

async function inspectManifest(item, manifest, environment, graphResolver, artifactVerifier) {
  if (!isRecord(manifest)) throw inspectionError('invalid-metadata', 'Invalid npm manifest');
  const checks = [];
  const identityPassed = manifest.name === item.package.name && manifest.version === item.package.version;
  checks.push(check('exact-identity', identityPassed, identityPassed ? 'exact-match' : 'registry-mismatch'));

  const registryRepository = canonicalGitHubRepository(isRecord(manifest.repository) ? manifest.repository.url : manifest.repository);
  const repositoryPassed = registryRepository?.toLowerCase() === item.repository.toLowerCase();
  checks.push(check('repository', repositoryPassed, repositoryPassed ? 'exact-match' : 'repository-mismatch'));

  const deprecatedPassed = manifest.deprecated === undefined;
  checks.push(check('deprecated', deprecatedPassed, deprecatedPassed ? 'not-deprecated' : 'deprecated'));

  const lifecycleScripts = dangerousLifecycleScripts(manifest.scripts);
  checks.push(check('lifecycle-scripts', lifecycleScripts.length === 0, lifecycleScripts.length === 0 ? 'none' : 'scripts-present'));

  const integrity = isRecord(manifest.dist) ? validSha512(manifest.dist.integrity) : undefined;
  checks.push(check('integrity', integrity !== undefined, integrity === undefined ? 'missing-sha512' : 'sha512-present'));

  const tarballPassed = isOfficialNpmTarball(isRecord(manifest.dist) ? manifest.dist.tarball : undefined, item.package);
  checks.push(check('tarball-origin', tarballPassed, tarballPassed ? 'official-registry' : 'invalid-tarball-origin'));

  const platformPassed = matchesPlatform(manifest.os, environment.platform) && matchesPlatform(manifest.cpu, environment.architecture);
  checks.push(check('platform', platformPassed, platformPassed ? 'compatible' : 'platform-mismatch'));

  const bundle = normalizeDshBundle(manifest.dsh);
  checks.push(check('dsh-bundle', bundle !== undefined, bundle === undefined ? 'invalid-bundle' : 'bundle-declared'));
  let failed = checks.filter((entry) => entry.state === 'fail').map((entry) => entry.key);
  const dependencyCount = isRecord(manifest.dependencies) ? Object.keys(manifest.dependencies).length : 0;
  const peerDependencyCount = isRecord(manifest.peerDependencies) ? Object.keys(manifest.peerDependencies).length : 0;
  let graph;
  let resolvedGraph;
  let installationPlan;
  let artifact = Object.freeze({ status: 'not-verified' });
  if (failed.length === 0) {
    try {
      const resolved = await graphResolver.resolve({ name: item.package.name, version: item.package.version, manifest });
      resolvedGraph = resolved;
      checks.push(check('node-engine', true, 'compatible'));
      checks.push(check('dependency-graph', true, 'graph-frozen'));
      const peersPassed = resolved.peerCompatibility?.status === 'compatible';
      checks.push(check('peer-compatibility', peersPassed, peersPassed ? 'compatible' : 'peer-conflict'));
      graph = Object.freeze({
        status: 'frozen',
        hash: resolved.hash,
        compatibilityStatus: resolved.peerCompatibility?.status ?? 'blocked',
        runtimeSnapshotHash: resolved.peerCompatibility?.runtimeSnapshotHash,
        peerIssues: normalizePeerIssues(resolved.peerCompatibility?.resolutions),
        ...resolved.summary,
      });
    } catch (error) {
      const failedCheck = typeof error?.check === 'string' ? error.check : 'dependency-graph';
      checks.push(failedCheck === 'node-engine'
        ? check('node-engine', false, 'incompatible')
        : Object.freeze({ key: 'node-engine', state: 'deferred', reason: 'graph-resolution-failed' }));
      checks.push(check('dependency-graph', false, safeGraphReason(error)));
      checks.push(Object.freeze({ key: 'peer-compatibility', state: 'deferred', reason: 'dependency-graph-required' }));
      graph = Object.freeze({ status: 'blocked' });
    }
  } else {
    checks.push(Object.freeze({ key: 'node-engine', state: 'deferred', reason: 'root-policy-failed' }));
    checks.push(Object.freeze({ key: 'dependency-graph', state: 'deferred', reason: 'root-policy-failed' }));
    checks.push(Object.freeze({ key: 'peer-compatibility', state: 'deferred', reason: 'dependency-graph-required' }));
    graph = Object.freeze({ status: 'not-frozen' });
  }
  if (graph.compatibilityStatus === 'compatible' && resolvedGraph !== undefined) {
    try {
      const verified = await artifactVerifier.verify({ graph: resolvedGraph, rootBundlePath: bundle.patch });
      installationPlan = verified.installationPlan;
      checks.push(check('artifact-bytes', true, 'verified'));
      checks.push(check('frozen-lock', true, 'created'));
      artifact = Object.freeze({
        status: verified.status,
        lockHash: verified.lockHash,
        ...verified.summary,
      });
    } catch (error) {
      checks.push(check('artifact-bytes', false, safeArtifactReason(error)));
      checks.push(Object.freeze({ key: 'frozen-lock', state: 'deferred', reason: 'artifact-verification-required' }));
      artifact = Object.freeze({ status: 'blocked' });
    }
  } else {
    checks.push(Object.freeze({ key: 'artifact-bytes', state: 'deferred', reason: 'compatible-graph-required' }));
    checks.push(Object.freeze({ key: 'frozen-lock', state: 'deferred', reason: 'artifact-verification-required' }));
  }
  failed = checks.filter((entry) => entry.state === 'fail').map((entry) => entry.key);
  const profileGeneration = failed.length === 0 && artifact.status === 'verified'
    ? createProfileGeneration({
        packageName: item.package.name,
        version: item.package.version,
        integrity,
        sourceId: item.provenance.sourceId,
        bundlePath: bundle.patch,
        graphHash: graph.hash,
        lockHash: artifact.lockHash,
      })
    : undefined;
  const value = Object.freeze({
    schemaVersion: 1,
    status: failed.length === 0 && artifact.status === 'verified' ? 'artifact-verified' : 'blocked',
    executionReady: false,
    observedAt: environment.observedAt,
    identity: Object.freeze({
      sourceRecordId: item.provenance.sourceId,
      itemId: item.id,
      packageName: item.package.name,
      version: item.package.version,
      catalogVersion: environment.catalogVersion,
      repository: item.repository,
    }),
    environment: Object.freeze({ platform: environment.platform, architecture: environment.architecture }),
    artifact: Object.freeze({
      integrityAlgorithm: integrity === undefined ? undefined : 'sha512',
      compressedBytes: safeSize(manifest.dist?.size),
      unpackedBytes: safeSize(manifest.dist?.unpackedSize),
      fileCount: safeSize(manifest.dist?.fileCount),
      verificationStatus: artifact.status,
      verifiedArtifacts: artifact.artifacts,
      verifiedCompressedBytes: artifact.compressedBytes,
      verifiedUnpackedBytes: artifact.unpackedBytes,
      verifiedFileCount: artifact.fileCount,
      cache: artifact.cache,
    }),
    bundle,
    dependencySummary: Object.freeze({
      direct: dependencyCount,
      peers: peerDependencyCount,
      graphStatus: graph.status,
      nodes: graph.nodes,
      edges: graph.edges,
      maxDepth: graph.maxDepth,
      peerRequirements: graph.peerRequirements,
      optionalSkipped: graph.optionalSkipped,
      peerSatisfied: graph.peerSatisfied,
      peerOptionalMissing: graph.peerOptionalMissing,
      peerBlocked: graph.peerBlocked,
    }),
    graphHash: graph.hash,
    lockHash: artifact.lockHash,
    profileGeneration,
    runtimeSnapshotHash: graph.runtimeSnapshotHash,
    peerIssues: graph.peerIssues ?? Object.freeze([]),
    lifecycleScripts: Object.freeze(lifecycleScripts),
    checks: Object.freeze(checks),
    blockers: Object.freeze(failed),
  });
  const installation = profileGeneration === undefined || installationPlan === undefined
    ? undefined
    : Object.freeze({
        generation: profileGeneration,
        candidate: Object.freeze({
          packageName: item.package.name,
          version: item.package.version,
          integrity,
          sourceId: item.provenance.sourceId,
          bundlePath: bundle.patch,
          graphHash: graph.hash,
          lockHash: artifact.lockHash,
        }),
        plan: installationPlan,
      });
  return Object.freeze({ value, installation });
}

function createProfileGeneration(input) {
  const stable = JSON.stringify(Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  ));
  return `gen-${createHash('sha256').update(stable).digest('hex')}`;
}

function safeArtifactReason(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (!code.startsWith('catalog:artifact-')) return 'artifact-verification-failed';
  const reason = code.slice('catalog:artifact-'.length);
  return [
    'tarball-budget', 'graph-budget', 'integrity', 'invalid-archive', 'unsafe-entry', 'unsafe-path',
    'invalid-package', 'package-identity', 'lifecycle-scripts', 'dependency-mismatch', 'bundle-missing',
    'invalid-cache-path', 'invalid-cache-object', 'cache-write',
  ].includes(reason) ? reason : 'artifact-verification-failed';
}

function normalizePeerIssues(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value
    .filter((entry) => ['missing', 'incompatible', 'ambiguous'].includes(entry?.state))
    .slice(0, 20)
    .map((entry) => Object.freeze({
      packageName: entry.name,
      required: entry.range,
      requiredBy: entry.from,
      state: entry.state,
      available: Array.isArray(entry.available) ? Object.freeze(entry.available.slice(0, 4)) : Object.freeze([]),
    })));
}

function safeGraphReason(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'catalog:graph-budget') return 'graph-budget-exceeded';
  if (code === 'catalog:graph-unresolved') return 'dependency-unresolved';
  if (code === 'catalog:graph-policy') return typeof error?.check === 'string' ? `policy-${error.check}` : 'dependency-policy-failed';
  return 'graph-resolution-failed';
}

function check(key, passed, reason) {
  return Object.freeze({ key, state: passed ? 'pass' : 'fail', reason });
}

function dangerousLifecycleScripts(value) {
  if (!isRecord(value)) return [];
  return LIFECYCLE_SCRIPTS.filter((name) => typeof value[name] === 'string' && value[name].trim() !== '');
}

function validSha512(value) {
  if (typeof value !== 'string') return undefined;
  const match = SHA512_PATTERN.exec(value);
  if (match === null) return undefined;
  try {
    return Buffer.from(match[1], 'base64').length === 64 ? value : undefined;
  } catch {
    return undefined;
  }
}

function isOfficialNpmTarball(value, identity) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port ||
      url.username || url.password || url.search || url.hash
    ) return false;
    const baseName = identity.name.includes('/') ? identity.name.slice(identity.name.lastIndexOf('/') + 1) : identity.name;
    return url.pathname.endsWith(`/-/${baseName}-${identity.version}.tgz`);
  } catch {
    return false;
  }
}

function normalizeDshBundle(value) {
  if (!isRecord(value) || !isRecord(value.bundle)) return undefined;
  const declared = value.bundle.patch;
  if (
    typeof declared !== 'string' || declared.length === 0 || declared.length > 240 || declared.includes('\\') || declared.includes('\0')
  ) return undefined;
  const patch = declared.startsWith('./') ? declared.slice(2) : declared;
  if (
    patch.length === 0 || patch.startsWith('/') || patch.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/\.ya?ml$/u.test(patch)
  ) return undefined;
  return Object.freeze({ patch });
}

function matchesPlatform(value, current) {
  if (value === undefined) return true;
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  if (entries.length === 0 || entries.length > 32 || entries.some((entry) => typeof entry !== 'string')) return false;
  if (entries.includes(`!${current}`)) return false;
  const positive = entries.filter((entry) => !entry.startsWith('!'));
  return positive.length === 0 || positive.includes(current) || positive.includes('any');
}

function canonicalGitHubRepository(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/^git\+/u, '').replace(/^git:\/\//u, 'https://').replace(/^git@github\.com:/u, 'https://github.com/');
  try {
    const url = new URL(normalized);
    const segments = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.search || url.hash || segments.length !== 2) return undefined;
    const owner = segments[0];
    const repository = segments[1].replace(/\.git$/u, '');
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/iu.test(owner) || !/^[a-z0-9._-]{1,100}$/iu.test(repository)) return undefined;
    return `https://github.com/${owner}/${repository}`;
  } catch {
    return undefined;
  }
}

function safeSize(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectionError(code, message) {
  const error = new Error(message);
  error.code = `catalog:${code}`;
  return error;
}
