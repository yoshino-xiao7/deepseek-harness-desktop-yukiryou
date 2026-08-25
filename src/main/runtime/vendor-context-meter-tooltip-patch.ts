/**
 * Temporary downstream patch for DeepSeek Harness 0.1.1-rc.2.
 *
 * The ContextMeter lives inside the composer's inline-size query container.
 * rc.2's non-portalled Tooltip renders with `position: fixed`, so Chromium
 * treats the query container as its containing block while the Tooltip still
 * supplies viewport coordinates. The resulting double offset can draw the
 * hover label below the composer and make the hover target flicker.
 *
 * Keep the click-open context breakdown unchanged. Only disable this broken
 * JS hover surface and retain the same accessible copy through a native title.
 */
export const CONTEXT_METER_TOOLTIP_PATCH_DSH_VERSION = '0.1.1-rc.2';
export const CONTEXT_METER_TOOLTIP_PATCH_MARKER =
  'deepseek-yukiryou:context-meter-tooltip-patch:v1';

const CONTEXT_METER_TOOLTIP_ANCHOR = `\t\t\t\t\tlabel: t("context.aria", { percent: reading }),
\t\t\t\t\tside: "top",
\t\t\t\t\tdelayMs: 200,
\t\t\t\t\tdisabled: open,
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\tclassName: ContextMeter_module_css_default.trigger,
\t\t\t\t\t\t"aria-label": t("context.aria", { percent: reading }),`;

const CONTEXT_METER_TOOLTIP_PATCH = `\t\t\t\t\tlabel: t("context.aria", { percent: reading }),
\t\t\t\t\tside: "top",
\t\t\t\t\tdelayMs: 200,
\t\t\t\t\t/* ${CONTEXT_METER_TOOLTIP_PATCH_MARKER} */
\t\t\t\t\tdisabled: true,
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\tclassName: ContextMeter_module_css_default.trigger,
\t\t\t\t\t\ttitle: t("context.aria", { percent: reading }),
\t\t\t\t\t\t"aria-label": t("context.aria", { percent: reading }),`;

export function patchContextMeterTooltip(source: string): string {
  if (source.includes(CONTEXT_METER_TOOLTIP_PATCH_MARKER)) return source;
  return replaceExactlyOnce(
    source,
    CONTEXT_METER_TOOLTIP_ANCHOR,
    CONTEXT_METER_TOOLTIP_PATCH,
  );
}

/** Restore the exact pinned upstream bundle for upgrade review or rollback. */
export function unpatchContextMeterTooltip(source: string): string {
  if (!source.includes(CONTEXT_METER_TOOLTIP_PATCH_MARKER)) return source;
  return replaceExactlyOnce(
    source,
    CONTEXT_METER_TOOLTIP_PATCH,
    CONTEXT_METER_TOOLTIP_ANCHOR,
  );
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
      'Pinned Harness ContextMeter no longer matches the temporary tooltip patch',
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}
