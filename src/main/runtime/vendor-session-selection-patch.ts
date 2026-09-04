/**
 * Temporary downstream patch for DeepSeek Harness 0.1.2-rc.1.
 *
 * The Session Controller can still project an empty, pending list during startup. rc.1
 * treats that transient snapshot as proof that the restored session is gone
 * and clears `dsh.sessions.current` before the first list pull can validate it.
 * Defer that destructive fallback until the first successful list arrives.
 */
export const SESSION_SELECTION_PATCH_DSH_VERSION = '0.1.2-rc.1';
export const SESSION_SELECTION_PATCH_MARKER =
  'deepseek-yukiryou:session-selection-patch:v1';

const SELECTION_CLEAR_ANCHOR = `\t\t\t\tconst persisted = this.selection.getSnapshot().sessionId;
\t\t\t\tif (current === void 0) {
\t\t\t\t\tif (persisted !== void 0) this.selection.set({});
\t\t\t\t} else if`;

const SELECTION_CLEAR_PATCH = `\t\t\t\tconst persisted = this.selection.getSnapshot().sessionId;
\t\t\t\t/* ${SESSION_SELECTION_PATCH_MARKER} */
\t\t\t\tif (current === void 0) {
\t\t\t\t\tif (persisted !== void 0 && phase === "ready") this.selection.set({});
\t\t\t\t} else if`;

export function patchSessionSelectionRestore(source: string): string {
  if (source.includes(SESSION_SELECTION_PATCH_MARKER)) return source;
  return replaceExactlyOnce(source, SELECTION_CLEAR_ANCHOR, SELECTION_CLEAR_PATCH);
}

/** Restore the exact pinned upstream bundle for upgrade review. */
export function unpatchSessionSelectionRestore(source: string): string {
  if (!source.includes(SESSION_SELECTION_PATCH_MARKER)) return source;
  return replaceExactlyOnce(source, SELECTION_CLEAR_PATCH, SELECTION_CLEAR_ANCHOR);
}

function replaceExactlyOnce(
  source: string,
  anchor: string,
  replacement: string,
): string {
  const first = source.indexOf(anchor);
  const last = source.lastIndexOf(anchor);
  if (first < 0 || first !== last) {
    throw new Error(
      'Pinned Harness session service no longer matches the temporary session-selection patch',
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}
