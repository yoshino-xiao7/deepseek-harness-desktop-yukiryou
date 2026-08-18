export interface BoundedLruCache<Value> {
  get(key: string): Value | undefined;
  set(key: string, value: Value, sizeBytes: number): void;
  clear(): void;
  readonly sizeBytes: number;
}

export function createBoundedLruCache<Value>(maxBytes: number): BoundedLruCache<Value> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('maxBytes must be a non-negative safe integer');
  const entries = new Map<string, { readonly value: Value; readonly sizeBytes: number }>();
  let usedBytes = 0;
  return {
    get(key): Value | undefined {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, sizeBytes): void {
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new RangeError('sizeBytes must be a non-negative safe integer');
      const existing = entries.get(key);
      if (existing !== undefined) {
        usedBytes -= existing.sizeBytes;
        entries.delete(key);
      }
      if (sizeBytes > maxBytes) return;
      entries.set(key, { value, sizeBytes });
      usedBytes += sizeBytes;
      while (usedBytes > maxBytes) {
        const oldest = entries.entries().next().value as [string, { readonly value: Value; readonly sizeBytes: number }] | undefined;
        if (oldest === undefined) break;
        entries.delete(oldest[0]);
        usedBytes -= oldest[1].sizeBytes;
      }
    },
    clear(): void {
      entries.clear();
      usedBytes = 0;
    },
    get sizeBytes(): number {
      return usedBytes;
    },
  };
}
