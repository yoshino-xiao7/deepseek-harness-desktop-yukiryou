import { describe, expect, it } from 'vitest';

import {
  MODEL_CAPABILITIES_PATCH_MARKER,
  patchModelCapabilitiesEditor,
  unpatchModelCapabilitiesEditor,
} from './vendor-model-capabilities-patch.js';

const upstreamFixture = [
  'window.__ModuleLoader__.load({',
  '\t\t\tmodelAdvanced: "Capacities",',
  '\t\t\tmodelAdvanced: "容量",',
  '\t\t\t\t\t\t\t\t\t\teditCapacity(index, "maxTokens", event.target.value);',
  '\t\t\t\t\t\t\t\t\t}',
  '\t\t\t\t\t\t\t\t})]',
  '\t\t\t\t\t\t\t})]',
  '});',
].join('\n');

describe('temporary Harness model-capabilities patch', () => {
  it('adds a per-model input capability selector without changing route defaults', () => {
    const patched = patchModelCapabilitiesEditor(upstreamFixture);

    expect(upstreamFixture).not.toContain(MODEL_CAPABILITIES_PATCH_MARKER);
    expect(patched).toContain(MODEL_CAPABILITIES_PATCH_MARKER);
    expect(patched).toContain('modelInputCapability: "输入能力"');
    expect(patched).toContain('modelInputAuto: "自动继承"');
    expect(patched).toContain('modelInputVision: "文本与图片"');
    expect(patched).toContain(
      'patch(index, { input: capability === "vision" ? ["text", "image"]',
    );
    expect(patched).not.toContain('defaultInput: ["text", "image"]');
  });

  it('is idempotent so rebuilding an already-patched runtime is safe', () => {
    const once = patchModelCapabilitiesEditor(upstreamFixture);

    expect(patchModelCapabilitiesEditor(once)).toBe(once);
  });

  it('fails loudly when the pinned upstream bundle no longer matches', () => {
    expect(() => patchModelCapabilitiesEditor('new upstream bundle')).toThrow(
      /no longer matches/,
    );
  });

  it('can restore the exact upstream bundle for a safe rollback', () => {
    const patched = patchModelCapabilitiesEditor(upstreamFixture);

    expect(unpatchModelCapabilitiesEditor(patched)).toBe(upstreamFixture);
  });
});
