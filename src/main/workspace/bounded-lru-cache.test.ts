import { describe, expect, it } from 'vitest';

import { createBoundedLruCache } from './bounded-lru-cache.js';

describe('bounded preview LRU', () => {
  it('evicts the least recently used entry while respecting the byte budget', () => {
    const cache = createBoundedLruCache<string>(10);
    cache.set('a', 'first', 4);
    cache.set('b', 'second', 4);
    expect(cache.get('a')).toBe('first');
    cache.set('c', 'third', 4);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('first');
    expect(cache.get('c')).toBe('third');
    expect(cache.sizeBytes).toBe(8);
  });

  it('does not retain a single entry larger than the entire budget', () => {
    const cache = createBoundedLruCache<string>(4);
    cache.set('large', 'value', 5);
    expect(cache.get('large')).toBeUndefined();
    expect(cache.sizeBytes).toBe(0);
  });
});
