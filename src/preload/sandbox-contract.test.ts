import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Harness preload sandbox contract', () => {
  it('does not import Node builtins into the sandboxed preload entry graph root', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/from ['"]node:/u);
    expect(source).toContain('globalThis.crypto.randomUUID()');
  });
});
