import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MODEL_CAPABILITIES_PATCH_MARKER,
  patchModelCapabilitiesEditor,
  unpatchModelCapabilitiesEditor,
} from './vendor-model-capabilities-patch.js';

const bundledClient = join(
  process.cwd(),
  'resources',
  'runtime',
  'dsh',
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-settings-models',
  'lib',
  'client.js',
);

describe('temporary Harness model-capabilities patch', () => {
  it('adds a per-model input capability selector without changing route defaults', async () => {
    const original = unpatchModelCapabilitiesEditor(
      await readFile(bundledClient, 'utf8'),
    );
    const patched = patchModelCapabilitiesEditor(original);

    expect(original).not.toContain(MODEL_CAPABILITIES_PATCH_MARKER);
    expect(patched).toContain(MODEL_CAPABILITIES_PATCH_MARKER);
    expect(patched).toContain('modelInputCapability: "输入能力"');
    expect(patched).toContain('modelInputAuto: "自动继承"');
    expect(patched).toContain('modelInputVision: "文本与图片"');
    expect(patched).toContain(
      'patch(index, { input: capability === "vision" ? ["text", "image"]',
    );
    expect(patched).not.toContain('defaultInput: ["text", "image"]');
  });

  it('is idempotent so rebuilding an already-patched runtime is safe', async () => {
    const original = unpatchModelCapabilitiesEditor(
      await readFile(bundledClient, 'utf8'),
    );
    const once = patchModelCapabilitiesEditor(original);

    expect(patchModelCapabilitiesEditor(once)).toBe(once);
  });

  it('fails loudly when the pinned upstream bundle no longer matches', () => {
    expect(() => patchModelCapabilitiesEditor('new upstream bundle')).toThrow(
      /no longer matches/,
    );
  });

  it('can restore the exact upstream bundle for a safe rollback', async () => {
    const original = unpatchModelCapabilitiesEditor(
      await readFile(bundledClient, 'utf8'),
    );
    const patched = patchModelCapabilitiesEditor(original);

    expect(unpatchModelCapabilitiesEditor(patched)).toBe(original);
  });
});
