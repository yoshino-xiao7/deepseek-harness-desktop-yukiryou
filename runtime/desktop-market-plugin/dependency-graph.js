import { createHash } from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

import semver from 'semver';

import { requestNpmManifest, requestNpmPackument } from './catalog-network.js';
import { createRuntimeSnapshot } from './runtime-snapshot.js';

const MAX_NODES = 256;
const MAX_DEPTH = 16;
const MAX_EDGES = 1_024;
const MAX_VERSIONS = 10_000;
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const SHA512_PATTERN = /^sha512-([A-Za-z0-9+/]{86}==)$/u;
const LIFECYCLE_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall']);

export function createDependencyGraphResolver(options = {}) {
  const requestPackument = options.requestPackument ?? requestNpmPackument;
  const requestManifest = options.requestManifest ?? requestNpmManifest;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxEdges = options.maxEdges ?? MAX_EDGES;
  const runtimeSnapshot = options.runtimeSnapshot ?? createRuntimeSnapshot();

  return Object.freeze({
    async resolve({ name, version, manifest } = {}) {
      assertIdentity(name, version, manifest, false);
      const nodes = new Map();
      const edges = [];
      const peerRequirements = [];
      const optionalSkipped = [];
      const packuments = new Map();
      const manifests = new Map([[`${name}@${version}`, Promise.resolve(manifest)]]);
      const queued = new Set();
      const queue = [{ name, version, manifest, depth: 0 }];

      while (queue.length > 0) {
        const current = queue.shift();
        const currentId = `${current.name}@${current.version}`;
        if (queued.has(currentId)) continue;
        queued.add(currentId);
        const node = normalizeNode(current.name, current.version, current.manifest, {
          platform, architecture, nodeVersion, depth: current.depth,
        });
        nodes.set(currentId, node);
        if (nodes.size > maxNodes) throw graphError('budget', 'dependency-graph', 'Dependency graph exceeded node budget');

        const peers = normalizePeerRequirements(current.manifest);
        if (peers.length > maxNodes || peerRequirements.length + peers.length > maxEdges) {
          throw graphError('budget', 'dependency-graph', 'Dependency graph exceeded peer requirement budget');
        }
        for (const peer of peers) {
          peerRequirements.push(Object.freeze({ from: currentId, ...peer }));
        }

        const dependencies = normalizeDependencies(current.manifest);
        if (dependencies.length > maxNodes) throw graphError('budget', 'dependency-graph', 'Package exceeded dependency budget');
        for (const dependency of dependencies) {
          let selected;
          try {
            selected = await selectVersion(dependency.name, dependency.range, requestPackument, packuments);
            const childId = `${dependency.name}@${selected}`;
            const childManifest = await cachedManifest(dependency.name, selected, requestManifest, manifests);
            assertIdentity(dependency.name, selected, childManifest, true);
            const childDepth = current.depth + 1;
            if (childDepth > maxDepth) throw graphError('budget', 'dependency-graph', 'Dependency graph exceeded depth budget');
            normalizeNode(dependency.name, selected, childManifest, {
              platform, architecture, nodeVersion, depth: childDepth,
            });
            edges.push(Object.freeze({
              from: currentId, to: childId, name: dependency.name,
              requested: dependency.range, kind: dependency.kind,
            }));
            if (edges.length > maxEdges) throw graphError('budget', 'dependency-graph', 'Dependency graph exceeded edge budget');
            const existing = nodes.get(childId);
            if (existing === undefined && !queued.has(childId)) queue.push({
              name: dependency.name, version: selected, manifest: childManifest, depth: childDepth,
            });
          } catch (error) {
            if (dependency.kind === 'optional' && error?.check === 'platform') {
              optionalSkipped.push(Object.freeze({ from: currentId, name: dependency.name, requested: dependency.range }));
              continue;
            }
            throw error;
          }
        }
      }

      const canonicalNodes = [...nodes.values()].sort(compareNode);
      const canonicalEdges = [...edges].sort(compareEdge);
      const canonicalPeers = [...peerRequirements].sort(comparePeer);
      const canonicalSkipped = [...optionalSkipped].sort(compareOptionalSkipped);
      const peerCompatibility = await resolvePeerCompatibility(canonicalPeers, canonicalNodes, await runtimeSnapshot.read());
      const hashInput = JSON.stringify({
        schemaVersion: 1,
        root: `${name}@${version}`,
        environment: { platform, architecture, nodeVersion },
        nodes: canonicalNodes,
        edges: canonicalEdges,
        peers: canonicalPeers,
        peerCompatibility,
        optionalSkipped: canonicalSkipped,
      });
      const hash = `sha256:${createHash('sha256').update(hashInput).digest('hex')}`;
      const summary = Object.freeze({
        nodes: canonicalNodes.length,
        edges: canonicalEdges.length,
        direct: normalizeDependencies(manifest).length,
        peers: normalizePeerRequirements(manifest).length,
        peerRequirements: canonicalPeers.length,
        peerSatisfied: peerCompatibility.satisfied,
        peerOptionalMissing: peerCompatibility.optionalMissing,
        peerBlocked: peerCompatibility.blocked,
        optionalSkipped: optionalSkipped.length,
        maxDepth: canonicalNodes.reduce((maximum, entry) => Math.max(maximum, entry.depth), 0),
        totalUnpackedBytes: safeSum(canonicalNodes.map((entry) => entry.unpackedBytes)),
        totalFiles: safeSum(canonicalNodes.map((entry) => entry.fileCount)),
      });
      return Object.freeze({
        schemaVersion: 1,
        status: 'frozen',
        root: `${name}@${version}`,
        hash,
        summary,
        nodes: Object.freeze(canonicalNodes),
        edges: Object.freeze(canonicalEdges),
        peerRequirements: Object.freeze(canonicalPeers),
        peerCompatibility,
        optionalSkipped: Object.freeze(canonicalSkipped),
      });
    },
  });
}

async function resolvePeerCompatibility(requirements, graphNodes, snapshot) {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.packages) || !/^sha256:[0-9a-f]{64}$/u.test(snapshot.hash ?? '')) {
    throw graphError('runtime-snapshot', 'peer-compatibility', 'Runtime compatibility snapshot is invalid');
  }
  const runtimeProviders = new Map(snapshot.packages.map((entry) => [entry.name, entry.version]));
  const graphProviders = new Map();
  for (const node of graphNodes) {
    const versions = graphProviders.get(node.name) ?? new Set();
    versions.add(node.version);
    graphProviders.set(node.name, versions);
  }
  const resolutions = requirements.map((requirement) => {
    const runtimeVersion = runtimeProviders.get(requirement.name);
    if (runtimeVersion !== undefined && semver.satisfies(runtimeVersion, requirement.range, { includePrerelease: true })) {
      return Object.freeze({ ...requirement, state: 'satisfied', provider: 'runtime', version: runtimeVersion });
    }
    const graphVersions = [...(graphProviders.get(requirement.name) ?? [])].sort(semver.rcompare);
    const matching = graphVersions.filter((version) => semver.satisfies(version, requirement.range, { includePrerelease: true }));
    if (matching.length === 1) {
      return Object.freeze({ ...requirement, state: 'satisfied', provider: 'graph', version: matching[0] });
    }
    if (matching.length > 1) return Object.freeze({ ...requirement, state: 'ambiguous', available: Object.freeze(matching.slice(0, 4)) });
    if (runtimeVersion === undefined && graphVersions.length === 0 && requirement.optional) {
      return Object.freeze({ ...requirement, state: 'optional-missing' });
    }
    return Object.freeze({
      ...requirement,
      state: runtimeVersion === undefined && graphVersions.length === 0 ? 'missing' : 'incompatible',
      available: Object.freeze([...(runtimeVersion === undefined ? [] : [runtimeVersion]), ...graphVersions].slice(0, 4)),
    });
  }).sort(comparePeerResolution);
  const blocked = resolutions.filter((entry) => entry.state === 'missing' || entry.state === 'incompatible' || entry.state === 'ambiguous').length;
  return Object.freeze({
    status: blocked === 0 ? 'compatible' : 'blocked',
    runtimeSnapshotHash: snapshot.hash,
    satisfied: resolutions.filter((entry) => entry.state === 'satisfied').length,
    optionalMissing: resolutions.filter((entry) => entry.state === 'optional-missing').length,
    blocked,
    resolutions: Object.freeze(resolutions),
  });
}

async function selectVersion(name, range, requestPackument, cache) {
  let pending = cache.get(name);
  if (pending === undefined) {
    pending = requestPackument(name);
    cache.set(name, pending);
  }
  const packument = await pending;
  if (!isRecord(packument) || packument.name !== name || !isRecord(packument.versions)) {
    throw graphError('invalid-metadata', 'dependency-graph', 'Invalid npm packument');
  }
  const versions = Object.entries(packument.versions);
  if (versions.length === 0 || versions.length > MAX_VERSIONS) {
    throw graphError('budget', 'dependency-graph', 'Invalid npm version set');
  }
  const matching = versions
    .filter(([candidate, metadata]) => semver.valid(candidate) !== null &&
      semver.satisfies(candidate, range) && isRecord(metadata));
  const preferred = matching.filter(([, metadata]) => metadata.deprecated === undefined);
  const candidates = (preferred.length > 0 ? preferred : matching)
    .map(([candidate]) => candidate)
    .sort(semver.rcompare);
  if (candidates.length === 0) throw graphError('unresolved', 'dependency-graph', 'Dependency range has no eligible version');
  return candidates[0];
}

async function cachedManifest(name, version, requestManifest, cache) {
  const key = `${name}@${version}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = requestManifest(name, version);
    cache.set(key, pending);
  }
  return pending;
}

function normalizeNode(name, version, manifest, environment) {
  if (environment.depth === 0 && manifest.deprecated !== undefined) {
    throw graphError('policy', 'deprecated', 'Root package is deprecated');
  }
  if (environment.depth === 0 && dangerousLifecycleScripts(manifest.scripts).length > 0) {
    throw graphError('policy', 'lifecycle-scripts', 'Lifecycle scripts in dependency graph');
  }
  const integrity = validSha512(manifest.dist?.integrity);
  if (integrity === undefined) throw graphError('policy', 'integrity', 'Missing SHA512 integrity in dependency graph');
  const tarball = officialTarball(manifest.dist?.tarball, { name, version });
  if (tarball === undefined) throw graphError('policy', 'tarball-origin', 'Invalid tarball origin in dependency graph');
  if (!matchesPlatform(manifest.os, environment.platform) || !matchesPlatform(manifest.cpu, environment.architecture)) {
    throw graphError('policy', 'platform', 'Package is incompatible with the target platform');
  }
  if (manifest.engines?.node !== undefined) {
    if (typeof manifest.engines.node !== 'string' || semver.validRange(manifest.engines.node) === null ||
      !semver.satisfies(environment.nodeVersion, manifest.engines.node, { includePrerelease: true })) {
      throw graphError('policy', 'node-engine', 'Package is incompatible with the bundled Node runtime');
    }
  }
  return Object.freeze({
    id: `${name}@${version}`,
    name,
    version,
    depth: environment.depth,
    integrity,
    tarball,
    unpackedBytes: safeSize(manifest.dist?.unpackedSize),
    fileCount: safeSize(manifest.dist?.fileCount),
  });
}

function normalizeDependencies(manifest) {
  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {};
  const optional = isRecord(manifest.optionalDependencies) ? manifest.optionalDependencies : {};
  const names = new Set([...Object.keys(dependencies), ...Object.keys(optional)]);
  return [...names].sort().map((name) => {
    const kind = Object.hasOwn(optional, name) ? 'optional' : 'runtime';
    const range = kind === 'optional' ? optional[name] : dependencies[name];
    if (!NPM_PACKAGE_PATTERN.test(name) || typeof range !== 'string' || range.length > 200 || semver.validRange(range) === null) {
      throw graphError('policy', 'dependency-graph', 'Unsupported dependency declaration');
    }
    return Object.freeze({ name, range, kind });
  });
}

function normalizePeerRequirements(manifest) {
  if (!isRecord(manifest.peerDependencies)) return [];
  const metadata = isRecord(manifest.peerDependenciesMeta) ? manifest.peerDependenciesMeta : {};
  return Object.keys(manifest.peerDependencies).sort().map((name) => {
    const range = manifest.peerDependencies[name];
    if (!NPM_PACKAGE_PATTERN.test(name) || typeof range !== 'string' || range.length > 200 || semver.validRange(range) === null) {
      throw graphError('policy', 'dependency-graph', 'Unsupported peer dependency declaration');
    }
    return Object.freeze({ name, range, optional: metadata[name]?.optional === true });
  });
}

function assertIdentity(name, version, manifest, allowPrerelease) {
  if (!NPM_PACKAGE_PATTERN.test(name ?? '') || semver.valid(version) === null ||
    (!allowPrerelease && semver.prerelease(version) !== null) ||
    !isRecord(manifest) || manifest.name !== name || manifest.version !== version) {
    throw graphError('invalid-metadata', 'exact-identity', 'Invalid exact package manifest');
  }
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

function officialTarball(value, identity) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const baseName = identity.name.slice(identity.name.lastIndexOf('/') + 1);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password ||
      url.search || url.hash || !url.pathname.endsWith(`/-/${baseName}-${identity.version}.tgz`)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function matchesPlatform(value, current) {
  if (value === undefined) return true;
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  if (entries.length === 0 || entries.length > 32 || entries.some((entry) => typeof entry !== 'string')) return false;
  if (entries.includes(`!${current}`)) return false;
  const positive = entries.filter((entry) => !entry.startsWith('!'));
  return positive.length === 0 || positive.includes(current) || positive.includes('any');
}

function safeSize(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeSum(values) {
  let total = 0;
  for (const value of values) {
    if (value === undefined || !Number.isSafeInteger(total + value)) return undefined;
    total += value;
  }
  return total;
}

function compareNode(left, right) {
  return left.id.localeCompare(right.id);
}

function compareEdge(left, right) {
  return `${left.from}\0${left.to}\0${left.kind}`.localeCompare(`${right.from}\0${right.to}\0${right.kind}`);
}

function comparePeer(left, right) {
  return `${left.from}\0${left.name}`.localeCompare(`${right.from}\0${right.name}`);
}

function compareOptionalSkipped(left, right) {
  return `${left.from}\0${left.name}`.localeCompare(`${right.from}\0${right.name}`);
}

function comparePeerResolution(left, right) {
  return `${left.from}\0${left.name}\0${left.state}`.localeCompare(`${right.from}\0${right.name}\0${right.state}`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function graphError(code, check, message) {
  const error = new Error(message);
  error.code = `catalog:graph-${code}`;
  error.check = check;
  return error;
}
