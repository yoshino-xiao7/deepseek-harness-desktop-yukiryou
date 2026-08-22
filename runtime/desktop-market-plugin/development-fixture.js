import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

import { createArtifactVerifier } from './artifact-verifier.js';

const SOURCE_ID = 'desktop-development-fixture';
const ITEM_ID = `${SOURCE_ID}:safe-install`;
const CRASH_ITEM_ID = `${SOURCE_ID}:startup-failure`;
const PACKAGE_NAME = '@dsh-desktop/development-install-fixture';
const VERSION = '1.0.3';
const CRASH_VERSION = '1.0.4-failure.1';
const BUNDLE_PATH = 'fixture.patch.yml';
const REPOSITORY = 'https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou';

/**
 * Development-only Adapter for the real catalog and managed-install seams.
 * It supplies one deterministic package without accepting paths or bytes from
 * the renderer, and still uses the production verifier/cache/installer chain.
 */
export function createDevelopmentFixture(options = {}) {
  if (options.enabled !== true) return undefined;
  const runtimeSnapshotHash = `sha256:${createHash('sha256').update('dsh-0.1.0-rc.8-development-fixture').digest('hex')}`;
  const observedAt = new Date().toISOString();
  const source = Object.freeze({
    id: SOURCE_ID,
    displayName: '本地安装测试',
    providerId: 'desktop-development-fixture',
    completeness: 'complete',
    builtIn: true,
    enabled: true,
    developmentOnly: true,
  });
  const item = Object.freeze({
    id: ITEM_ID,
    displayName: 'YukiRyou 安装测试插件',
    summary: '仅开发版可见的无网络、无生命周期脚本测试插件，用于验证安装、重启与自动恢复。',
    repository: REPOSITORY,
    categories: Object.freeze(['development', 'test']),
    publisher: Object.freeze({ name: 'DeepSeek YukiRyou' }),
    package: Object.freeze({ name: PACKAGE_NAME, version: VERSION }),
    installability: Object.freeze({ state: 'candidate', reason: 'development-fixture' }),
    provenance: Object.freeze({ sourceId: SOURCE_ID, providerId: source.providerId, observedAt }),
  });
  const crashItem = Object.freeze({
    id: CRASH_ITEM_ID,
    displayName: 'YukiRyou 启动恢复测试版本',
    summary: '仅开发版可见的预期故障版本，用于验证更新失败后的自动恢复、单次重启与 blocklist。',
    repository: REPOSITORY,
    categories: Object.freeze(['development', 'failure-test']),
    publisher: Object.freeze({ name: 'DeepSeek YukiRyou' }),
    package: Object.freeze({ name: PACKAGE_NAME, version: CRASH_VERSION }),
    installability: Object.freeze({ state: 'candidate', reason: 'development-fixture' }),
    provenance: Object.freeze({ sourceId: SOURCE_ID, providerId: source.providerId, observedAt }),
  });
  const artifacts = new Map([
    [ITEM_ID, createFixtureArtifact(options.artifactStore, VERSION, 'safe')],
    [CRASH_ITEM_ID, createFixtureArtifact(options.artifactStore, CRASH_VERSION, 'startup-failure')],
  ]);
  const inspections = new Map();

  async function inspectVerified(identity) {
    const artifact = identity?.sourceRecordId === SOURCE_ID
      ? artifacts.get(identity?.itemId)
      : undefined;
    if (artifact === undefined) {
      throw fixtureError('item-not-found', 'Development fixture identity is unavailable');
    }
    let inspection = inspections.get(identity.itemId);
    if (inspection === undefined) {
      inspection = createInspection({ ...artifact, itemId: identity.itemId, runtimeSnapshotHash, observedAt });
      inspections.set(identity.itemId, inspection);
    }
    return inspection;
  }

  return Object.freeze({
    sourceId: SOURCE_ID,
    itemId: ITEM_ID,
    crashItemId: CRASH_ITEM_ID,
    source,
    snapshot(availableSources) {
      return Object.freeze({
        schemaVersion: 2,
        source: Object.freeze({ ...source, complete: true, indexedTotal: 2, providerTotal: 2 }),
        availableSources,
        observedAt,
        items: Object.freeze([item, crashItem]),
        cache: Object.freeze({ status: 'development', storedAt: observedAt, expiresAt: observedAt }),
      });
    },
    inspect: async (identity) => (await inspectVerified(identity)).value,
    inspectVerified,
  });
}

function createFixtureArtifact(store, version, behavior) {
  const bytes = fixtureArchive(version, behavior);
  return Object.freeze({
    artifactVerifier: createArtifactVerifier({
      store,
      requestTarball: async () => bytes,
    }),
    bytes,
    version,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    graphHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
}

export function createDevelopmentCatalogAdapter(catalog, fixture) {
  if (fixture === undefined) return catalog;
  return Object.freeze({
    async listSources() {
      const sources = await catalog.listSources();
      return Object.freeze([fixture.source, ...sources]);
    },
    async read(request = {}) {
      if (request.sourceId !== fixture.sourceId) return catalog.read(request);
      return fixture.snapshot(await this.listSources());
    },
  });
}

export function createDevelopmentInspectorAdapter(inspector, fixture) {
  if (fixture === undefined) return inspector;
  const isFixture = (identity) =>
    identity?.sourceRecordId === fixture.sourceId;
  return Object.freeze({
    inspect: (identity) => isFixture(identity) ? fixture.inspect(identity) : inspector.inspect(identity),
    inspectVerified: (identity) => isFixture(identity)
      ? fixture.inspectVerified(identity)
      : inspector.inspectVerified(identity),
  });
}

async function createInspection({ artifactVerifier, bytes, version, integrity, graphHash, itemId, runtimeSnapshotHash, observedAt }) {
  const root = `${PACKAGE_NAME}@${version}`;
  const graph = Object.freeze({
    status: 'frozen', root, hash: graphHash,
    nodes: Object.freeze([Object.freeze({
      id: root, name: PACKAGE_NAME, version,
      tarball: 'development-fixture://local/package.tgz', integrity,
    })]),
    edges: Object.freeze([]), optionalSkipped: Object.freeze([]), peerRequirements: Object.freeze([]),
    peerCompatibility: Object.freeze({
      status: 'compatible', runtimeSnapshotHash, resolutions: Object.freeze([]),
    }),
  });
  const verified = await artifactVerifier.verify({ graph, rootBundlePath: BUNDLE_PATH });
  const candidate = Object.freeze({
    packageName: PACKAGE_NAME, version, integrity, sourceId: SOURCE_ID,
    bundlePath: BUNDLE_PATH, graphHash, lockHash: verified.lockHash,
  });
  const generation = profileGeneration(candidate);
  const value = Object.freeze({
    schemaVersion: 1,
    status: 'artifact-verified',
    executionReady: false,
    observedAt,
    identity: Object.freeze({
      sourceRecordId: SOURCE_ID, itemId, packageName: PACKAGE_NAME,
      version, repository: REPOSITORY,
    }),
    environment: Object.freeze({ platform: process.platform, architecture: process.arch }),
    artifact: Object.freeze({
      integrityAlgorithm: 'sha512',
      compressedBytes: bytes.length,
      unpackedBytes: verified.summary.unpackedBytes,
      fileCount: verified.summary.fileCount,
      verificationStatus: 'verified',
      verifiedArtifacts: verified.summary.artifacts,
      verifiedCompressedBytes: verified.summary.compressedBytes,
      verifiedUnpackedBytes: verified.summary.unpackedBytes,
      verifiedFileCount: verified.summary.fileCount,
      cache: verified.summary.cache,
    }),
    bundle: Object.freeze({ patch: BUNDLE_PATH }),
    dependencySummary: Object.freeze({
      direct: 0, peers: 0, graphStatus: 'frozen', nodes: 1, edges: 0, maxDepth: 0,
      peerRequirements: 0, optionalSkipped: 0, peerSatisfied: 0, peerOptionalMissing: 0, peerBlocked: 0,
    }),
    graphHash,
    lockHash: verified.lockHash,
    profileGeneration: generation,
    runtimeSnapshotHash,
    peerIssues: Object.freeze([]),
    lifecycleScripts: Object.freeze([]),
    checks: Object.freeze([
      'exact-identity', 'repository', 'deprecated', 'lifecycle-scripts', 'integrity',
      'tarball-origin', 'platform', 'dsh-bundle', 'node-engine', 'dependency-graph',
      'peer-compatibility', 'artifact-bytes', 'frozen-lock',
    ].map((key) => Object.freeze({ key, state: 'pass', reason: key === 'tarball-origin' ? 'bundled-development-fixture' : 'verified' }))),
    blockers: Object.freeze([]),
  });
  return Object.freeze({
    value,
    installation: Object.freeze({ generation, candidate, plan: verified.installationPlan }),
  });
}

function fixtureArchive(version, behavior) {
  return archive([
    {
      path: 'package/package.json',
      body: JSON.stringify({
        name: PACKAGE_NAME,
        version,
        type: 'module',
        main: './index.js',
      }),
    },
    {
      path: `package/${BUNDLE_PATH}`,
      body: `- insert:\n    - id: development-install-fixture\n      name: '${PACKAGE_NAME}'\n`,
    },
    {
      path: 'package/index.js',
      body: behavior === 'startup-failure'
        ? "throw new Error('intentional development fixture startup failure');\n"
        : "export const inject = [];\nexport function apply() {}\n",
    },
  ]);
}

function archive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body);
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeOctal(header, 148, 8, checksum);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { mtime: 0 });
}

function writeOctal(target, offset, length, value) {
  target.write(`${value.toString(8).padStart(length - 2, '0')}\0 `, offset, length, 'ascii');
}

function profileGeneration(candidate) {
  const stable = JSON.stringify(Object.fromEntries(
    Object.entries(candidate).sort(([left], [right]) => left.localeCompare(right)),
  ));
  return `gen-${createHash('sha256').update(stable).digest('hex')}`;
}

function fixtureError(code, message) {
  const error = new Error(message);
  error.code = `catalog:${code}`;
  return error;
}
