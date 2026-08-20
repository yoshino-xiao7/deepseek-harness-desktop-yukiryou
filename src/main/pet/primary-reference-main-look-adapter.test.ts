import { describe, expect, it } from 'vitest';

import { PrimaryReferenceMainLookAdapter } from './primary-reference-main-look-adapter.js';

describe('PrimaryReferenceMainLookAdapter', () => {
  it('uses an ordinary primary PNG as the canonical look without an engine asset or editor step', async () => {
    const bytes = Uint8Array.of(137, 80, 78, 71);
    const adapter = new PrimaryReferenceMainLookAdapter();
    const result = await adapter.generate({
      input: { schemaVersion: 1, locale: 'zh-CN', displayName: '宠物', request: '保持角色一致', references: [] },
      references: [{ id: 'primary', role: 'primary', mediaType: 'image/png', bytes }],
      signal: new AbortController().signal,
    });
    bytes[0] = 0;
    expect(result).toEqual({ mediaType: 'image/png', bytes: Uint8Array.of(137, 80, 78, 71) });
  });

  it('rejects ambiguous primary references and formats that require hidden conversion', async () => {
    const adapter = new PrimaryReferenceMainLookAdapter();
    const base = {
      input: { schemaVersion: 1 as const, locale: 'en' as const, displayName: 'Pet', request: 'same character', references: [] },
      signal: new AbortController().signal,
    };
    await expect(adapter.generate({ ...base, references: [] })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(adapter.generate({
      ...base,
      references: [{ id: 'primary', role: 'primary', mediaType: 'image/jpeg', bytes: Uint8Array.of(1) }],
    })).rejects.toMatchObject({ code: 'invalid-request' });
  });
});
