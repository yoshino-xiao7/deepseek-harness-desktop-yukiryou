import { requestCustomCatalog, requestDsh1024Store, requestDshfindPage, requestGitHubSearch, requestYukiRyouCatalog } from './catalog-network.js';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

const CACHE_MS = 5 * 60 * 1000;
const PERSISTENT_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CATALOG_ITEMS = 20_000;
const MAX_DSHFIND_PAGES = MAX_CATALOG_ITEMS / 100;
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const SOURCES = Object.freeze([
  Object.freeze({
    id: 'dshfind',
    displayName: 'dshfind',
    providerId: 'dshfind-rest-catalog',
    completeness: 'complete',
    builtIn: true,
    enabled: true,
  }),
  Object.freeze({
    id: 'yukiryou-curated',
    displayName: 'YukiRyou · 实机验证',
    providerId: 'yukiryou-curated-json-v1',
    completeness: 'complete',
    builtIn: true,
    enabled: true,
    curated: true,
  }),
  Object.freeze({
    id: 'dsh-1024store',
    displayName: 'DSH 1024Store',
    providerId: 'deepseek1024-catalog',
    completeness: 'complete',
    builtIn: true,
    enabled: true,
  }),
  Object.freeze({
    id: 'github-topic-dsh-plugin',
    displayName: 'GitHub · dsh-plugin',
    providerId: 'github-rest-search',
    completeness: 'truncated',
    builtIn: true,
    enabled: true,
  }),
]);

export function createCatalog(options = {}) {
  const now = options.now ?? (() => Date.now());
  const wait = options.wait ?? delay;
  const requests = options.requests ?? Object.freeze({
    dshfind: requestDshfindPage,
    'yukiryou-curated': requestYukiRyouCatalog,
    'dsh-1024store': requestDsh1024Store,
    'github-topic-dsh-plugin': requestGitHubSearch,
    custom: requestCustomCatalog,
  });
  const snapshotStore = options.snapshotStore;
  const sourceRegistry = options.sourceRegistry;
  const mediaProxy = options.mediaProxy;
  const cache = new Map();
  const inFlight = new Map();

  return Object.freeze({
    async listSources() {
      return resolveSources(sourceRegistry);
    },
    async read({ sourceId = 'dshfind', refresh = false } = {}) {
      const availableSources = await resolveSources(sourceRegistry);
      const source = availableSources.find((entry) => entry.id === sourceId);
      const requestJson = source?.builtIn === false ? requests.custom : requests[sourceId];
      if (source === undefined || source.enabled !== true || typeof requestJson !== 'function') {
        throw catalogError('invalid-source', 'Unknown catalog source');
      }
      const timestamp = now();
      const cached = cache.get(sourceId);
      if (!refresh && cached !== undefined && timestamp - cached.storedAt < CACHE_MS) {
        return decorateSnapshot(cached.snapshot, cached.cacheStatus, cached.persistedAt, availableSources, mediaProxy);
      }
      const pending = inFlight.get(sourceId);
      if (pending !== undefined) return pending;
      const request = (async () => {
        let persistent;
        if (snapshotStore !== undefined) {
          persistent = await snapshotStore.load(sourceId).catch(() => undefined);
          if (persistent !== undefined && isPersistentEntry(persistent, timestamp)) {
            try {
              persistent = { ...persistent, snapshot: validateStoredSnapshot(persistent.snapshot, source, availableSources, mediaProxy) };
            } catch {
              persistent = undefined;
            }
          } else persistent = undefined;
        }
        if (!refresh && persistent !== undefined && timestamp - persistent.storedAt < PERSISTENT_CACHE_MS) {
          cache.set(sourceId, {
            snapshot: persistent.snapshot, storedAt: timestamp, persistedAt: persistent.storedAt, cacheStatus: 'persistent',
          });
          return decorateSnapshot(persistent.snapshot, 'persistent', persistent.storedAt, availableSources, mediaProxy);
        }
        const rebuild = async () => {
          try {
            const raw = sourceId === 'dshfind'
              ? await scanDshfind(requestJson, wait)
              : source.builtIn === false ? await requestJson(source.url) : await requestJson();
            const observedAt = new Date(timestamp).toISOString();
            const normalized = sourceId === 'dshfind'
              ? normalizeDshfind(raw, observedAt, availableSources)
              : sourceId === 'yukiryou-curated'
                ? normalizeYukiRyouSnapshot(raw, observedAt, availableSources, mediaProxy)
              : sourceId === 'dsh-1024store'
                ? normalizeDsh1024Store(raw, observedAt, availableSources)
                : sourceId === 'github-topic-dsh-plugin'
                  ? normalizeGitHubSnapshot(raw, observedAt, availableSources, mediaProxy)
                  : normalizeCustomSnapshot(raw, source, observedAt, availableSources, mediaProxy);
            const storedAt = now();
            cache.set(sourceId, { snapshot: normalized, storedAt, persistedAt: storedAt, cacheStatus: 'network' });
            if (snapshotStore !== undefined) await snapshotStore.save(sourceId, normalized, storedAt).catch(() => undefined);
            return decorateSnapshot(normalized, 'network', storedAt, availableSources, mediaProxy);
          } catch (error) {
            if (persistent !== undefined) {
              cache.set(sourceId, {
                snapshot: persistent.snapshot, storedAt: timestamp, persistedAt: persistent.storedAt, cacheStatus: 'stale',
              });
              return decorateSnapshot(persistent.snapshot, 'stale', persistent.storedAt, availableSources, mediaProxy);
            }
            throw error;
          }
        };
        if (!refresh && persistent !== undefined) {
          cache.set(sourceId, {
            snapshot: persistent.snapshot, storedAt: timestamp, persistedAt: persistent.storedAt, cacheStatus: 'stale',
          });
          const background = rebuild();
          inFlight.set(sourceId, background);
          void background.finally(() => {
            if (inFlight.get(sourceId) === background) inFlight.delete(sourceId);
          }).catch(() => undefined);
          return decorateSnapshot(persistent.snapshot, 'stale', persistent.storedAt, availableSources, mediaProxy);
        }
        return rebuild();
      })();
      inFlight.set(sourceId, request);
      try {
        return await request;
      } finally {
        if (inFlight.get(sourceId) === request) inFlight.delete(sourceId);
      }
    },
  });
}

function validateStoredSnapshot(raw, expectedSource, availableSources, mediaProxy) {
  if (!isRecord(raw) || raw.schemaVersion !== 2 || !isRecord(raw.source) || !Array.isArray(raw.items)) {
    throw catalogError('invalid-cache', 'Invalid cached catalog snapshot');
  }
  const source = expectedSource;
  const observedAt = boundedIsoDate(raw.observedAt);
  const providerTotal = raw.source.providerTotal;
  if (
    source === undefined || raw.source.id !== source.id || observedAt === undefined ||
    raw.items.length > MAX_CATALOG_ITEMS || !Number.isSafeInteger(providerTotal) ||
    providerTotal < raw.items.length || providerTotal > MAX_CATALOG_ITEMS ||
    typeof raw.source.complete !== 'boolean'
  ) throw catalogError('invalid-cache', 'Cached catalog metadata is inconsistent');
  if (source.id === 'dshfind' && raw.source.complete !== true) {
    throw catalogError('invalid-cache', 'Complete source cache is truncated');
  }
  if (source.id === 'github-topic-dsh-plugin' && raw.source.complete !== false) {
    throw catalogError('invalid-cache', 'Truncated source cache is marked complete');
  }
  const providerRevision = boundedString(raw.source.providerRevision, 160);
  if (source.id === 'dshfind' && !/^sha256:[0-9a-f]{64}$/u.test(providerRevision ?? '')) {
    throw catalogError('invalid-cache', 'Cached data version is invalid');
  }
  const items = [];
  const seen = new Set();
  for (const entry of raw.items) {
    const item = validateStoredItem(entry, source, observedAt, mediaProxy);
    if (seen.has(item.id)) throw catalogError('invalid-cache', 'Cached catalog id is duplicated');
    seen.add(item.id);
    items.push(item);
  }
  return snapshot({
    source, availableSources, observedAt, providerTotal, providerRevision, items, complete: raw.source.complete,
  });
}

function validateStoredItem(raw, source, observedAt, mediaProxy) {
  if (!isRecord(raw) || !isRecord(raw.publisher) || !isRecord(raw.installability) || !isRecord(raw.provenance)) {
    throw catalogError('invalid-cache', 'Cached catalog item is invalid');
  }
  const id = boundedString(raw.id, 320);
  const displayName = boundedString(raw.displayName, 160);
  const summary = typeof raw.summary === 'string' && raw.summary.length <= 1_000 ? raw.summary : undefined;
  const repository = canonicalGitHubRepository(raw.repository);
  const publisher = boundedString(raw.publisher.name, 100);
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map((value) => boundedString(value, 50)).filter(Boolean)
    : [];
  if (
    !id || !id.startsWith(`${source.id === 'github-topic-dsh-plugin' ? 'github' : source.id}:`) ||
    !displayName || summary === undefined || !repository || !publisher ||
    categories.length > 12 || categories.length !== raw.categories?.length ||
    raw.provenance.sourceId !== source.id || raw.provenance.providerId !== source.providerId ||
    raw.provenance.observedAt !== observedAt
  ) throw catalogError('invalid-cache', 'Cached catalog item identity is invalid');
  const state = raw.installability.state;
  const reason = raw.installability.reason;
  const packageTarget = isRecord(raw.package) && NPM_PACKAGE_PATTERN.test(raw.package.name ?? '') && STABLE_VERSION_PATTERN.test(raw.package.version ?? '')
    ? Object.freeze({ name: raw.package.name, version: raw.package.version })
    : undefined;
  const developerVerification = raw.developerVerification === undefined
    ? undefined
    : normalizeDeveloperVerification(raw.developerVerification);
  const providerCandidate = state === 'candidate' &&
    reason === 'provider-verified-repository-backlink' &&
    source.id !== 'yukiryou-curated' &&
    packageTarget !== undefined &&
    developerVerification === undefined;
  const developerCandidate = state === 'candidate' &&
    reason === 'developer-installed-and-reviewed' &&
    source.id === 'yukiryou-curated' &&
    packageTarget !== undefined &&
    developerVerification !== undefined;
  const candidate = providerCandidate || developerCandidate;
  const browseOnly = state === 'browse-only' && ['missing-exact-package-identity', 'incomplete-source-index', 'custom-source-unverified'].includes(reason) && raw.package === undefined;
  if (!candidate && !browseOnly) throw catalogError('invalid-cache', 'Cached installability is invalid');
  const media = validateInternalMedia(raw._media, mediaProxy);
  return Object.freeze({
    id, displayName, summary, repository,
    categories: Object.freeze([...categories]),
    publisher: Object.freeze({ name: publisher }),
    ...(packageTarget === undefined ? {} : { package: packageTarget }),
    ...(developerVerification === undefined ? {} : { developerVerification }),
    installability: Object.freeze({ state, reason }),
    provenance: Object.freeze({ sourceId: source.id, providerId: source.providerId, observedAt }),
    ...(media === undefined ? {} : { _media: media }),
  });
}

function decorateSnapshot(value, status, storedAt, availableSources, mediaProxy) {
  return Object.freeze({
    ...value,
    items: Object.freeze(value.items.map((item) => publicItem(item, mediaProxy))),
    availableSources,
    cache: Object.freeze({
      status,
      storedAt: new Date(storedAt).toISOString(),
      expiresAt: new Date(storedAt + PERSISTENT_CACHE_MS).toISOString(),
    }),
  });
}

function boundedIsoDate(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString() === value ? value : undefined;
}

function isPersistentEntry(value, timestamp) {
  return isRecord(value) && Number.isSafeInteger(value.storedAt) && value.storedAt >= 0 &&
    value.storedAt <= timestamp + (5 * 60 * 1000) && isRecord(value.snapshot);
}

function normalizeDsh1024Store(raw, observedAt, availableSources) {
  if (!isRecord(raw) || !Array.isArray(raw.packages) || !isRecord(raw.meta)) {
    throw catalogError('invalid-response', 'Invalid DSH 1024Store payload');
  }
  const packages = raw.packages;
  const providerTotal = raw.meta.total;
  if (
    packages.length > MAX_CATALOG_ITEMS ||
    !Number.isSafeInteger(providerTotal) ||
    providerTotal < 0 ||
    providerTotal > MAX_CATALOG_ITEMS ||
    providerTotal < packages.length
  ) throw catalogError('invalid-response', 'DSH 1024Store total is inconsistent');

  const items = [];
  const seen = new Set();
  for (const entry of packages) {
    const item = normalizeDsh1024StoreItem(entry, observedAt);
    if (item === undefined) continue;
    if (seen.has(item.id)) throw catalogError('duplicate-id', 'Duplicate catalog id');
    seen.add(item.id);
    items.push(item);
  }
  return snapshot({
    source: builtInSource('dsh-1024store'), availableSources,
    observedAt,
    providerTotal,
    items,
    providerRevision: boundedString(raw.meta.revision, 160),
    complete: providerTotal === packages.length,
  });
}

function normalizeDsh1024StoreItem(entry, observedAt) {
  if (!isRecord(entry)) return undefined;
  const id = boundedString(entry.id, 240);
  const name = boundedString(entry.name, 160);
  const owner = boundedString(entry.owner, 100);
  const repository = canonicalGitHubRepository(entry.url);
  if (!id || !name || !owner || !repository) return undefined;
  const category = boundedString(entry.category, 50);
  const description = isRecord(entry.description)
    ? boundedString(entry.description.zh, 1_000) ?? boundedString(entry.description.en, 1_000)
    : boundedString(entry.description, 1_000);
  return Object.freeze({
    id: `dsh-1024store:${id}`,
    displayName: name,
    summary: description ?? '',
    repository,
    categories: Object.freeze(category ? [category] : []),
    publisher: Object.freeze({ name: owner }),
    installability: Object.freeze({ state: 'browse-only', reason: 'incomplete-source-index' }),
    provenance: Object.freeze({
      sourceId: 'dsh-1024store',
      providerId: 'deepseek1024-catalog',
      observedAt,
    }),
  });
}

async function scanDshfind(requestPage, wait) {
  const first = parseDshfindPage(await requestPage(1), 1);
  const pages = [first];
  for (let page = 2; page <= first.totalPages; page += 1) {
    await wait(2_100);
    const next = parseDshfindPage(await requestPage(page, first.dataVersion), page);
    if (
      next.dataVersion !== first.dataVersion ||
      next.total !== first.total ||
      next.totalPages !== first.totalPages
    ) throw catalogError('invalid-response', 'dshfind dataset changed during scan');
    pages.push(next);
  }
  return Object.freeze({ pages: Object.freeze(pages), total: first.total, dataVersion: first.dataVersion });
}

function parseDshfindPage(raw, expectedPage) {
  if (!isRecord(raw) || !Array.isArray(raw.data)) throw catalogError('invalid-response', 'Invalid dshfind payload');
  const page = raw.page;
  const perPage = raw.per_page;
  const total = raw.total;
  const totalPages = raw.total_pages;
  const dataVersion = raw.data_version;
  if (
    !Number.isSafeInteger(page) || page !== expectedPage ||
    perPage !== 100 ||
    !Number.isSafeInteger(total) || total < 0 || total > MAX_CATALOG_ITEMS ||
    !Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > MAX_DSHFIND_PAGES ||
    totalPages !== (total === 0 ? 0 : Math.ceil(total / 100)) ||
    typeof dataVersion !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(dataVersion)
  ) throw catalogError('invalid-response', 'dshfind page metadata is inconsistent');
  const expectedItems = totalPages === 0 ? 0 : page < totalPages ? 100 : total - ((page - 1) * 100);
  if (raw.data.length !== expectedItems) throw catalogError('invalid-response', 'dshfind page length is inconsistent');
  return Object.freeze({ page, total, totalPages, dataVersion, items: Object.freeze(raw.data) });
}

function normalizeDshfind(scan, observedAt, availableSources) {
  const items = [];
  const seen = new Set();
  for (const page of scan.pages) {
    for (const entry of page.items) {
      const item = normalizeDshfindItem(entry, observedAt);
      if (item === undefined) continue;
      if (seen.has(item.id)) throw catalogError('duplicate-id', 'Duplicate catalog id');
      seen.add(item.id);
      items.push(item);
    }
  }
  return snapshot({
    source: builtInSource('dshfind'), availableSources, observedAt, providerTotal: scan.total, providerRevision: scan.dataVersion, items, complete: true,
  });
}

function normalizeDshfindItem(entry, observedAt) {
  if (!isRecord(entry) || entry.is_risky === true) return undefined;
  const id = boundedString(entry.full_name, 240);
  const name = boundedString(entry.name, 160);
  const owner = boundedString(entry.owner, 100);
  const repository = canonicalGitHubRepository(entry.repository_url);
  if (!id || !name || !owner || !repository) return undefined;
  const category = boundedString(entry.category, 50);
  const description = boundedString(entry.description, 1_000) ?? '';
  const npmTarget = reviewedNpmTarget(isRecord(entry.install) ? entry.install.methods : undefined);
  const packageName = isRecord(entry.install) ? boundedString(entry.install.pkg_name, 214) : undefined;
  const trustedTarget = npmTarget !== undefined && (packageName === undefined || packageName === npmTarget.name)
    ? npmTarget
    : undefined;
  return Object.freeze({
    id: `dshfind:${id}`,
    displayName: name,
    summary: description,
    repository,
    categories: Object.freeze(category ? [category] : []),
    publisher: Object.freeze({ name: owner }),
    ...(trustedTarget === undefined ? {} : { package: Object.freeze(trustedTarget) }),
    installability: Object.freeze(trustedTarget === undefined
      ? { state: 'browse-only', reason: 'missing-exact-package-identity' }
      : { state: 'candidate', reason: 'provider-verified-repository-backlink' }),
    provenance: Object.freeze({ sourceId: 'dshfind', providerId: 'dshfind-rest-catalog', observedAt }),
  });
}

function reviewedNpmTarget(methods) {
  if (!Array.isArray(methods)) return undefined;
  const targets = new Map();
  for (const method of methods) {
    if (!isRecord(method)) continue;
    if (
      method.kind !== 'npm' ||
      method.verification !== 'verified' ||
      method.code !== 'repository_backlink' ||
      method.requiresBuildAllowance !== false ||
      typeof method.spec !== 'string' ||
      typeof method.revision !== 'string' ||
      !NPM_PACKAGE_PATTERN.test(method.spec) ||
      !STABLE_VERSION_PATTERN.test(method.revision)
    ) continue;
    targets.set(`${method.spec}@${method.revision}`, { name: method.spec, version: method.revision });
  }
  return targets.size === 1 ? targets.values().next().value : undefined;
}

function normalizeGitHubSnapshot(raw, observedAt, availableSources, mediaProxy) {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.items) ||
    raw.items.length > 100 ||
    !Number.isSafeInteger(raw.total_count) ||
    raw.total_count < raw.items.length
  ) throw catalogError('invalid-response', 'Invalid GitHub search payload');
  const seen = new Set();
  const items = raw.items.map((entry) => normalizeGitHubRepository(entry, observedAt, mediaProxy));
  for (const item of items) {
    if (seen.has(item.id)) throw catalogError('duplicate-id', 'Duplicate catalog id');
    seen.add(item.id);
  }
  return snapshot({
    source: builtInSource('github-topic-dsh-plugin'), availableSources,
    observedAt,
    providerTotal: raw.total_count,
    items,
    complete: false,
  });
}

function normalizeGitHubRepository(entry, observedAt, mediaProxy) {
  if (!isRecord(entry) || !Number.isSafeInteger(entry.id) || entry.id <= 0) {
    throw catalogError('invalid-response', 'Repository id is invalid');
  }
  const name = boundedString(entry.name, 100);
  const fullName = boundedString(entry.full_name, 200);
  const owner = isRecord(entry.owner) ? boundedString(entry.owner.login, 100) : undefined;
  const topics = Array.isArray(entry.topics)
    ? entry.topics.map((topic) => boundedString(topic, 50)).filter(Boolean)
    : [];
  if (!name || !fullName || !owner || !topics.includes('dsh-plugin')) {
    throw catalogError('invalid-response', 'Repository identity is invalid');
  }
  const expectedRepository = `https://github.com/${fullName}`;
  if (entry.html_url !== expectedRepository) {
    throw catalogError('invalid-response', 'Repository URL is invalid');
  }
  const iconUrl = isRecord(entry.owner) ? entry.owner.avatar_url : undefined;
  const media = createInternalMedia(iconUrl, mediaProxy);
  return Object.freeze({
    id: `github:${entry.id}`,
    displayName: name,
    summary: boundedString(entry.description, 280) ?? '',
    repository: expectedRepository,
    categories: Object.freeze([...new Set(topics.filter((topic) => topic !== 'dsh-plugin'))].slice(0, 12)),
    publisher: Object.freeze({ name: owner }),
    installability: Object.freeze({ state: 'browse-only', reason: 'incomplete-source-index' }),
    provenance: Object.freeze({ sourceId: 'github-topic-dsh-plugin', providerId: 'github-rest-search', observedAt }),
    ...(media === undefined ? {} : { _media: media }),
  });
}

function normalizeYukiRyouSnapshot(raw, observedAt, availableSources, mediaProxy) {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.items) || raw.items.length > 500) {
    throw catalogError('invalid-response', 'Invalid YukiRyou curated catalog payload');
  }
  const revision = boundedString(raw.revision, 160);
  if (!revision) throw catalogError('invalid-response', 'YukiRyou catalog revision is required');
  const source = builtInSource('yukiryou-curated');
  const items = [];
  const seen = new Set();
  for (const entry of raw.items) {
    const item = normalizeYukiRyouItem(entry, source, observedAt, mediaProxy);
    if (seen.has(item.id)) throw catalogError('duplicate-id', 'Duplicate curated catalog id');
    seen.add(item.id);
    items.push(item);
  }
  return snapshot({
    source, availableSources, observedAt, providerTotal: items.length,
    providerRevision: revision, items, complete: true,
  });
}

function normalizeYukiRyouItem(entry, source, observedAt, mediaProxy) {
  if (!isRecord(entry) || !isRecord(entry.package) || !isRecord(entry.verification)) {
    throw catalogError('invalid-response', 'Invalid YukiRyou curated catalog item');
  }
  const providerItemId = boundedString(entry.id, 240);
  const displayName = boundedString(entry.displayName, 160);
  const summary = typeof entry.summary === 'string' && entry.summary.length <= 1_000 ? entry.summary : undefined;
  const repository = canonicalGitHubRepository(entry.repository);
  const publisher = isRecord(entry.publisher) ? boundedString(entry.publisher.name, 100) : undefined;
  const packageName = boundedString(entry.package.name, 214);
  const packageVersion = boundedString(entry.package.version, 100);
  const categories = Array.isArray(entry.categories)
    ? entry.categories.map((value) => boundedString(value, 50)).filter(Boolean)
    : [];
  const verification = normalizeDeveloperVerification(entry.verification);
  if (
    !providerItemId || !displayName || summary === undefined || !repository || !publisher ||
    !packageName || !NPM_PACKAGE_PATTERN.test(packageName) ||
    !packageVersion || !STABLE_VERSION_PATTERN.test(packageVersion) ||
    categories.length > 12 || categories.length !== entry.categories?.length || verification === undefined
  ) throw catalogError('invalid-response', 'Invalid YukiRyou curated catalog item identity');
  const media = createInternalMedia(entry.icon, mediaProxy);
  if (entry.icon !== undefined && media === undefined) throw catalogError('invalid-response', 'Invalid curated catalog icon');
  return Object.freeze({
    id: `${source.id}:${providerItemId}`,
    displayName,
    summary,
    repository,
    categories: Object.freeze([...new Set(categories)]),
    publisher: Object.freeze({ name: publisher }),
    package: Object.freeze({ name: packageName, version: packageVersion }),
    developerVerification: verification,
    installability: Object.freeze({ state: 'candidate', reason: 'developer-installed-and-reviewed' }),
    provenance: Object.freeze({ sourceId: source.id, providerId: source.providerId, observedAt }),
    ...(media === undefined ? {} : { _media: media }),
  });
}

function normalizeDeveloperVerification(raw) {
  if (!isRecord(raw) || raw.status !== 'installed') return undefined;
  const testedAt = boundedIsoDate(raw.testedAt);
  const harnessVersion = boundedString(raw.harnessVersion, 80);
  const allowedPlatforms = new Set(['darwin-arm64', 'win32-x64']);
  const platforms = Array.isArray(raw.platforms)
    ? [...new Set(raw.platforms.filter((value) => allowedPlatforms.has(value)))]
    : [];
  const notes = raw.notes === undefined ? undefined : boundedString(raw.notes, 500);
  if (!testedAt || !harnessVersion || platforms.length === 0 || platforms.length !== raw.platforms?.length ||
    (raw.notes !== undefined && notes === undefined)) return undefined;
  return Object.freeze({
    status: 'installed', testedAt, harnessVersion,
    platforms: Object.freeze(platforms),
    ...(notes === undefined ? {} : { notes }),
  });
}

function normalizeCustomSnapshot(raw, source, observedAt, availableSources, mediaProxy) {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.items) || raw.items.length > MAX_CATALOG_ITEMS) {
    throw catalogError('invalid-response', 'Invalid custom catalog payload');
  }
  const revision = boundedString(raw.revision, 160);
  if (!revision) throw catalogError('invalid-response', 'Custom catalog revision is required');
  const items = [];
  const seen = new Set();
  for (const entry of raw.items) {
    const item = normalizeCustomItem(entry, source, observedAt, mediaProxy);
    if (seen.has(item.id)) throw catalogError('duplicate-id', 'Duplicate catalog id');
    seen.add(item.id);
    items.push(item);
  }
  return snapshot({
    source, availableSources, observedAt, providerTotal: items.length,
    providerRevision: revision, items, complete: true,
  });
}

function normalizeCustomItem(entry, source, observedAt, mediaProxy) {
  if (!isRecord(entry)) throw catalogError('invalid-response', 'Invalid custom catalog item');
  const providerItemId = boundedString(entry.id, 240);
  const displayName = boundedString(entry.displayName, 160);
  const summary = typeof entry.summary === 'string' && entry.summary.length <= 1_000 ? entry.summary : undefined;
  const repository = canonicalGitHubRepository(entry.repository);
  const publisher = isRecord(entry.publisher) ? boundedString(entry.publisher.name, 100) : undefined;
  const categories = Array.isArray(entry.categories)
    ? entry.categories.map((value) => boundedString(value, 50)).filter(Boolean)
    : [];
  if (!providerItemId || !displayName || summary === undefined || !repository || !publisher || categories.length > 12 || categories.length !== entry.categories?.length) {
    throw catalogError('invalid-response', 'Invalid custom catalog item identity');
  }
  const media = createInternalMedia(entry.icon, mediaProxy);
  if (entry.icon !== undefined && media === undefined) throw catalogError('invalid-response', 'Invalid custom catalog icon');
  return Object.freeze({
    id: `${source.id}:${providerItemId}`,
    displayName,
    summary,
    repository,
    categories: Object.freeze([...new Set(categories)]),
    publisher: Object.freeze({ name: publisher }),
    installability: Object.freeze({ state: 'browse-only', reason: 'custom-source-unverified' }),
    provenance: Object.freeze({ sourceId: source.id, providerId: source.providerId, observedAt }),
    ...(media === undefined ? {} : { _media: media }),
  });
}

function createInternalMedia(iconUrl, mediaProxy) {
  if (iconUrl === undefined || mediaProxy === undefined) return undefined;
  const publicMedia = mediaProxy.register(iconUrl);
  return publicMedia === undefined ? undefined : Object.freeze({ iconUrl });
}

function validateInternalMedia(raw, mediaProxy) {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || typeof raw.iconUrl !== 'string') throw catalogError('invalid-cache', 'Cached media is invalid');
  const media = createInternalMedia(raw.iconUrl, mediaProxy);
  if (media === undefined) throw catalogError('invalid-cache', 'Cached media URL is invalid');
  return media;
}

function publicItem(item, mediaProxy) {
  const { _media, ...publicFields } = item;
  const media = _media === undefined ? undefined : mediaProxy?.register(_media.iconUrl);
  return Object.freeze({ ...publicFields, ...(media === undefined ? {} : { media }) });
}

async function resolveSources(sourceRegistry) {
  if (sourceRegistry === undefined) return SOURCES;
  const custom = await sourceRegistry.list();
  return Object.freeze([
    ...SOURCES,
    ...custom.map((entry) => Object.freeze({
      id: entry.id,
      displayName: entry.displayName,
      providerId: 'custom-json-v1',
      completeness: 'complete',
      builtIn: false,
      enabled: entry.enabled,
      url: entry.url,
      order: entry.order,
    })),
  ]);
}

function builtInSource(id) {
  const source = SOURCES.find((entry) => entry.id === id);
  if (source === undefined) throw catalogError('invalid-source', `Unknown built-in source ${id}`);
  return source;
}

function snapshot({ source, availableSources, observedAt, providerTotal, providerRevision, items, complete }) {
  return Object.freeze({
    schemaVersion: 2,
    source: Object.freeze({
      ...source,
      complete,
      indexedTotal: items.length,
      providerTotal,
      ...(providerRevision === undefined ? {} : { providerRevision }),
    }),
    availableSources,
    observedAt,
    items: Object.freeze(items),
  });
}

function canonicalGitHubRepository(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.username || url.password || url.search || url.hash ||
      segments.length !== 2
    ) return undefined;
    const owner = segments[0];
    const repository = segments[1].replace(/\.git$/u, '');
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/iu.test(owner) || !/^[a-z0-9._-]{1,100}$/iu.test(repository)) return undefined;
    return `https://github.com/${owner}/${repository}`;
  } catch {
    return undefined;
  }
}

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function catalogError(code, message) {
  const error = new Error(message);
  error.code = `catalog:${code}`;
  return error;
}
