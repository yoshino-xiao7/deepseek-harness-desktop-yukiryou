import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { normalizeRemoteImageUrl, requestRemoteImage } from './catalog-network.js';

const MEDIA_ROUTE = '/plugins/@dsh-desktop/market/media';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_TRANSFORMED_BYTES = 256 * 1024;
const MAX_MEMORY_ENTRIES = 128;
const MAX_TARGET_ENTRIES = 20_000;

export function createMediaProxy(options = {}) {
  const requestImage = options.requestImage ?? requestRemoteImage;
  const transform = options.transform ?? normalizeImage;
  const targets = new Map();
  const cache = new Map();
  const inFlight = new Map();

  return Object.freeze({
    register(value) {
      const url = normalizeRemoteImageUrl(value);
      if (url === undefined) return undefined;
      const token = createHash('sha256').update(url).digest('hex');
      targets.delete(token);
      targets.set(token, url);
      while (targets.size > MAX_TARGET_ENTRIES) targets.delete(targets.keys().next().value);
      return Object.freeze({ icon: `${MEDIA_ROUTE}?id=${token}` });
    },
    async read(token) {
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token) || !targets.has(token)) {
        throw mediaError('not-found', 'Unknown media token');
      }
      const cached = cache.get(token);
      if (cached !== undefined) {
        cache.delete(token);
        cache.set(token, cached);
        return cached;
      }
      const pending = inFlight.get(token);
      if (pending !== undefined) return pending;
      const operation = (async () => {
        const remote = await requestImage(targets.get(token));
        const image = await transform(remote);
        if (!Buffer.isBuffer(image?.bytes) || image.bytes.length === 0 || image.bytes.length > MAX_TRANSFORMED_BYTES || image.contentType !== 'image/webp') {
          throw mediaError('invalid-media', 'Image normalization failed');
        }
        const result = Object.freeze({ bytes: image.bytes, contentType: image.contentType });
        cache.set(token, result);
        while (cache.size > MAX_MEMORY_ENTRIES) cache.delete(cache.keys().next().value);
        return result;
      })();
      inFlight.set(token, operation);
      try {
        return await operation;
      } finally {
        inFlight.delete(token);
      }
    },
  });
}

async function normalizeImage({ bytes }) {
  const { default: sharp } = await import('sharp');
  const image = sharp(bytes, { animated: false, failOn: 'warning', limitInputPixels: 1_048_576 });
  const metadata = await image.metadata();
  if (
    !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) ||
    metadata.width < 1 || metadata.height < 1 || metadata.width > 1_024 || metadata.height > 1_024
  ) throw mediaError('invalid-media', 'Image dimensions exceed policy');
  const normalized = await image
    .rotate()
    .resize(128, 128, { fit: 'cover', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  return Object.freeze({ bytes: normalized, contentType: 'image/webp' });
}

function mediaError(code, message) {
  const error = new Error(message);
  error.code = `catalog:${code}`;
  return error;
}
