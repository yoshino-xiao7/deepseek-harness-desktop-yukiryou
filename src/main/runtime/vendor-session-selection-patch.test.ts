import { describe, expect, it } from 'vitest';

import {
  patchSessionSelectionRestore,
  SESSION_SELECTION_PATCH_MARKER,
  unpatchSessionSelectionRestore,
} from './vendor-session-selection-patch.js';

const upstreamFixture = `\t\t\t\tconst persisted = this.selection.getSnapshot().sessionId;
\t\t\t\tif (current === void 0) {
\t\t\t\t\tif (persisted !== void 0) this.selection.set({});
\t\t\t\t} else if (byId[current] !== void 0) this.selection.set({ sessionId: current });`;

describe('temporary Harness session-selection patch', () => {
  it('preserves a restored selection while the first session list is pending', () => {
    const patched = patchSessionSelectionRestore(upstreamFixture);

    expect(patched).toContain(SESSION_SELECTION_PATCH_MARKER);
    expect(patched).toContain(
      'persisted !== void 0 && phase === "ready"',
    );
  });

  it('is idempotent', () => {
    const once = patchSessionSelectionRestore(upstreamFixture);
    expect(patchSessionSelectionRestore(once)).toBe(once);
  });

  it('fails loudly when the pinned upstream bundle changes', () => {
    expect(() => patchSessionSelectionRestore('new upstream bundle')).toThrow(
      /no longer matches/,
    );
  });

  it('restores the exact upstream source', () => {
    const patched = patchSessionSelectionRestore(upstreamFixture);
    expect(unpatchSessionSelectionRestore(patched)).toBe(upstreamFixture);
  });
});
