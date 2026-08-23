import { Buffer } from 'node:buffer';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';

const GITHUB_REQUEST = Object.freeze({
  hostname: 'api.github.com',
  path: '/search/repositories?q=topic%3Adsh-plugin&sort=stars&order=desc&per_page=100',
  headers: Object.freeze({
    accept: 'application/vnd.github+json',
    'user-agent': 'DeepSeek-YukiRyou-Plugin-Catalog/0.2',
    'x-github-api-version': '2022-11-28',
  }),
});
const YUKIRYOU_GITHUB_CATALOG_REQUEST = Object.freeze({
  hostname: 'raw.githubusercontent.com',
  path: '/yoshino-xiao7/deepseek-yukiryou-plugin-catalog/main/catalog-v1.json',
  headers: Object.freeze({
    accept: 'application/json',
    'user-agent': 'DeepSeek-YukiRyou-Curated-Catalog/0.2',
  }),
});
const YUKIRYOU_CHINA_CATALOG_REQUEST = Object.freeze({
  hostname: 'download-cn.suzuki.ink',
  path: '/plugins/catalog/catalog-v1.json',
  headers: Object.freeze({
    accept: 'application/json',
    'user-agent': 'DeepSeek-YukiRyou-Curated-Catalog/0.2',
  }),
});
const DSH_1024STORE_REQUEST = Object.freeze({
  hostname: 'deepseek1024.com',
  path: '/api/v1/plugins',
  headers: Object.freeze({
    accept: 'application/json',
    'user-agent': 'DeepSeek-YukiRyou-Plugin-Catalog/0.2',
  }),
});
const DSHFIND_HOSTNAME = 'api.dshfind.com';
const NPM_REGISTRY_HOSTNAME = 'registry.npmjs.org';
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_RESPONSE_BYTES = 1024 * 1024;
const MAX_PACKUMENT_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TARBALL_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_DSHFIND_PAGES = 200;
const BLOCKED_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED_NETWORKS.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED_NETWORKS.addSubnet(network, prefix, 'ipv6');

export function requestGitHubSearch() {
  return requestFixedJson(GITHUB_REQUEST);
}

export async function requestYukiRyouCatalog() {
  const requests = process.env.DSH_DESKTOP_DISTRIBUTION_REGION === 'china'
    ? [YUKIRYOU_CHINA_CATALOG_REQUEST, YUKIRYOU_GITHUB_CATALOG_REQUEST]
    : [YUKIRYOU_GITHUB_CATALOG_REQUEST];
  let lastFailure;
  for (const target of requests) {
    try {
      return await requestFixedJson(target);
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure ?? catalogError('network', 'No curated catalog source is configured');
}

export function requestDsh1024Store() {
  return requestFixedJson(DSH_1024STORE_REQUEST);
}

export function requestDshfindPage(page, dataVersion) {
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_DSHFIND_PAGES) {
    return Promise.reject(catalogError('invalid-request', 'Invalid dshfind page'));
  }
  if (dataVersion !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(dataVersion)) {
    return Promise.reject(catalogError('invalid-request', 'Invalid dshfind data version'));
  }
  const params = new URLSearchParams({ page: String(page), per_page: '100' });
  if (dataVersion !== undefined) params.set('data_version', dataVersion);
  return requestFixedJson({
    hostname: DSHFIND_HOSTNAME,
    path: `/v1/plugins?${params.toString()}`,
    headers: Object.freeze({ accept: 'application/json', 'user-agent': 'DeepSeek-YukiRyou-Plugin-Catalog/0.2' }),
  });
}

export function requestNpmManifest(packageName, version) {
  if (!NPM_PACKAGE_PATTERN.test(packageName ?? '') || !STABLE_VERSION_PATTERN.test(version ?? '')) {
    return Promise.reject(catalogError('invalid-request', 'Invalid npm package identity'));
  }
  return requestFixedJson({
    hostname: NPM_REGISTRY_HOSTNAME,
    path: `/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    headers: Object.freeze({
      accept: 'application/json',
      'user-agent': 'DeepSeek-YukiRyou-Plugin-Inspector/0.2',
    }),
  });
}

export function requestNpmPackument(packageName) {
  if (!NPM_PACKAGE_PATTERN.test(packageName ?? '')) {
    return Promise.reject(catalogError('invalid-request', 'Invalid npm package identity'));
  }
  return requestJsonTarget({
    hostname: NPM_REGISTRY_HOSTNAME,
    path: `/${encodeURIComponent(packageName)}`,
    headers: Object.freeze({
      accept: 'application/json',
      'user-agent': 'DeepSeek-YukiRyou-Plugin-Graph/0.2',
    }),
  }, { allowAddress: isAllowedCatalogAddress, redirects: 0, maxBytes: MAX_PACKUMENT_RESPONSE_BYTES });
}

export function requestNpmTarball({ packageName, version, tarball } = {}) {
  if (!NPM_PACKAGE_PATTERN.test(packageName ?? '') || !STABLE_VERSION_PATTERN.test(version ?? '')) {
    return Promise.reject(catalogError('invalid-request', 'Invalid npm package identity'));
  }
  const target = normalizeNpmTarballUrl(tarball, { name: packageName, version });
  if (target === undefined) return Promise.reject(catalogError('invalid-request', 'Invalid npm tarball URL'));
  return requestFixedBinary({
    hostname: target.hostname,
    path: target.pathname,
    headers: Object.freeze({
      accept: 'application/octet-stream',
      'user-agent': 'DeepSeek-YukiRyou-Plugin-Artifact/0.2',
    }),
  }, MAX_TARBALL_RESPONSE_BYTES);
}

export function requestCustomCatalog(value) {
  const target = normalizeCustomCatalogUrl(value);
  if (target === undefined) return Promise.reject(catalogError('invalid-request', 'Invalid custom catalog URL'));
  return requestJsonTarget({
    hostname: target.hostname,
    path: `${target.pathname}${target.search}`,
    headers: Object.freeze({ accept: 'application/json', 'user-agent': 'DeepSeek-YukiRyou-Plugin-Catalog/0.2' }),
  }, { allowAddress: isAllowedCustomCatalogAddress, redirects: 3 });
}

export function requestRemoteImage(value) {
  const normalized = normalizeRemoteImageUrl(value);
  if (normalized === undefined) return Promise.reject(catalogError('invalid-request', 'Invalid remote image URL'));
  const target = new URL(normalized);
  return requestBinaryTarget({
    hostname: target.hostname,
    path: `${target.pathname}${target.search}`,
    headers: Object.freeze({
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      'user-agent': 'DeepSeek-YukiRyou-Plugin-Media/0.2',
    }),
  }, { redirects: 3 });
}

async function requestFixedJson(target) {
  return requestJsonTarget(target, { allowAddress: isAllowedCatalogAddress, redirects: 0 });
}

async function requestFixedBinary(target, maxBytes) {
  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isAllowedCatalogAddress(entry.address))) {
    throw catalogError('network-policy', `${target.hostname} resolved outside the allowed network ranges`);
  }
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const req = request({
      protocol: 'https:', hostname: target.hostname, servername: target.hostname, port: 443,
      path: target.path, method: 'GET', headers: target.headers,
      lookup: (_hostname, options, callback) => {
        if (options?.all === true) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
      timeout: 30_000,
    }, (response) => {
      if (response.statusCode === 403 || response.statusCode === 429) {
        response.resume();
        finish(() => reject(catalogError('rate-limited', `${target.hostname} rate limit reached`)));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        finish(() => reject(catalogError('upstream', `${target.hostname} returned ${response.statusCode ?? 0}`)));
        return;
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.resume();
        finish(() => reject(catalogError('response-too-large', `${target.hostname} tarball exceeded budget`)));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          req.destroy(catalogError('response-too-large', `${target.hostname} tarball exceeded budget`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
    });
    req.on('timeout', () => req.destroy(catalogError('timeout', `${target.hostname} request timed out`)));
    req.on('error', (error) => finish(() => reject(error.code?.startsWith('catalog:')
      ? error
      : catalogError('network', `${target.hostname} request failed`, error))));
    req.end();
  });
}

async function requestJsonTarget(target, policy) {
  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !policy.allowAddress(entry.address))) {
    throw catalogError('network-policy', `${target.hostname} resolved outside the allowed network ranges`);
  }
  const pinned = addresses[0];

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const req = request({
      protocol: 'https:',
      hostname: target.hostname,
      servername: target.hostname,
      port: 443,
      path: target.path,
      method: 'GET',
      headers: target.headers,
      lookup: (_hostname, options, callback) => {
        if (options?.all === true) {
          callback(null, [pinned]);
          return;
        }
        callback(null, pinned.address, pinned.family);
      },
      timeout: 15_000,
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && policy.redirects > 0) {
        response.resume();
        finish(() => {
          const redirected = resolveCustomCatalogUrl(response.headers.location, `https://${target.hostname}${target.path}`);
          if (redirected === undefined) {
            reject(catalogError('network-policy', 'Custom catalog redirect is invalid'));
            return;
          }
          resolve(requestJsonTarget({
            hostname: redirected.hostname,
            path: `${redirected.pathname}${redirected.search}`,
            headers: target.headers,
          }, { ...policy, redirects: policy.redirects - 1 }));
        });
        return;
      }
      if (response.statusCode === 403 || response.statusCode === 429) {
        response.resume();
        finish(() => reject(catalogError('rate-limited', `${target.hostname} rate limit reached`)));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        finish(() => reject(catalogError('upstream', `${target.hostname} returned ${response.statusCode ?? 0}`)));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > (policy.maxBytes ?? MAX_RESPONSE_BYTES)) {
          req.destroy(catalogError('response-too-large', `${target.hostname} response exceeded budget`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(() => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(catalogError('invalid-response', `${target.hostname} returned invalid JSON`));
        }
      }));
    });
    req.on('timeout', () => req.destroy(catalogError('timeout', `${target.hostname} request timed out`)));
    req.on('error', (error) => finish(() => reject(error.code?.startsWith('catalog:')
      ? error
      : catalogError('network', `${target.hostname} request failed`, error))));
    req.end();
  });
}

async function requestBinaryTarget(target, policy) {
  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isAllowedRemoteImageAddress(target.hostname, entry.address))) {
    throw catalogError('network-policy', `${target.hostname} resolved outside the allowed network ranges`);
  }
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const req = request({
      protocol: 'https:', hostname: target.hostname, servername: target.hostname, port: 443,
      path: target.path, method: 'GET', headers: target.headers,
      lookup: (_hostname, options, callback) => {
        if (options?.all === true) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
      timeout: 15_000,
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && policy.redirects > 0) {
        response.resume();
        finish(() => {
          const redirected = resolveRemoteImageUrl(response.headers.location, `https://${target.hostname}${target.path}`);
          if (redirected === undefined) {
            reject(catalogError('network-policy', 'Remote image redirect is invalid'));
            return;
          }
          resolve(requestBinaryTarget({
            hostname: redirected.hostname,
            path: `${redirected.pathname}${redirected.search}`,
            headers: target.headers,
          }, { redirects: policy.redirects - 1 }));
        });
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        finish(() => reject(catalogError('upstream', `${target.hostname} returned ${response.statusCode ?? 0}`)));
        return;
      }
      const declaredType = String(response.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(declaredType)) {
        response.resume();
        finish(() => reject(catalogError('invalid-media', `${target.hostname} returned unsupported media`)));
        return;
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_RESPONSE_BYTES) {
        response.resume();
        finish(() => reject(catalogError('response-too-large', `${target.hostname} image exceeded budget`)));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_MEDIA_RESPONSE_BYTES) {
          req.destroy(catalogError('response-too-large', `${target.hostname} image exceeded budget`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(() => {
        const bytes = Buffer.concat(chunks);
        if (!matchesImageSignature(bytes, declaredType)) {
          reject(catalogError('invalid-media', `${target.hostname} image signature is invalid`));
          return;
        }
        resolve(Object.freeze({ bytes, contentType: declaredType }));
      }));
    });
    req.on('timeout', () => req.destroy(catalogError('timeout', `${target.hostname} request timed out`)));
    req.on('error', (error) => finish(() => reject(error.code?.startsWith('catalog:')
      ? error
      : catalogError('network', `${target.hostname} request failed`, error))));
    req.end();
  });
}

function normalizeCustomCatalogUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !url.pathname || url.pathname === '/') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function normalizeNpmTarballUrl(value, identity) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    const baseName = identity.name.slice(identity.name.lastIndexOf('/') + 1);
    if (
      url.protocol !== 'https:' || url.hostname !== NPM_REGISTRY_HOSTNAME || url.port || url.username || url.password ||
      url.search || url.hash || !url.pathname.endsWith(`/-/${baseName}-${identity.version}.tgz`)
    ) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function normalizeRemoteImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function resolveCustomCatalogUrl(location, base) {
  if (typeof location !== 'string') return undefined;
  try {
    return normalizeCustomCatalogUrl(new URL(location, base).toString());
  } catch {
    return undefined;
  }
}

function resolveRemoteImageUrl(location, base) {
  if (typeof location !== 'string') return undefined;
  try {
    const normalized = normalizeRemoteImageUrl(new URL(location, base).toString());
    return normalized === undefined ? undefined : new URL(normalized);
  } catch {
    return undefined;
  }
}

function matchesImageSignature(bytes, contentType) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false;
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (contentType === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (contentType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  return false;
}

export function isAllowedCustomCatalogAddress(address) {
  if (!isAllowedCatalogAddress(address)) return false;
  const ipv4 = isIP(address) === 4 ? address : mappedIpv4Address(address);
  if (ipv4 !== undefined) {
    const [first, second] = ipv4.split('.').map(Number);
    if (first === 198 && (second === 18 || second === 19)) return false;
  }
  return true;
}

export function isAllowedRemoteImageAddress(hostname, address) {
  // macOS TUN proxies synthesize 198.18/15 addresses. Permit that range only
  // for the fixed GitHub avatar CDN; arbitrary catalog-controlled hosts keep
  // the stricter SSRF policy even when their URL resembles a public image.
  return String(hostname).toLowerCase() === 'avatars.githubusercontent.com'
    ? isAllowedCatalogAddress(address)
    : isAllowedCustomCatalogAddress(address);
}

export function isAllowedCatalogAddress(address) {
  const family = isIP(address);
  // 198.18.0.0/15 remains allowed only for compile-time-fixed adapters because
  // macOS TUN proxies commonly use it as a synthetic address. Custom sources
  // apply the additional rejection below.
  if (family === 4) return !BLOCKED_NETWORKS.check(address, 'ipv4');
  if (family === 6) {
    const mapped = mappedIpv4Address(address);
    return mapped === undefined
      ? !BLOCKED_NETWORKS.check(address, 'ipv6')
      : !BLOCKED_NETWORKS.check(mapped, 'ipv4');
  }
  return false;
}

function mappedIpv4Address(address) {
  const normalized = address.toLowerCase();
  const dotted = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(normalized);
  if (dotted !== null && isIP(dotted[1]) === 4) return dotted[1];
  const hexadecimal = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized);
  if (hexadecimal === null) return undefined;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export const isAllowedGitHubAddress = isAllowedCatalogAddress;

function catalogError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = `catalog:${code}`;
  return error;
}
