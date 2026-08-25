import { describe, expect, it } from 'vitest';

import {
  CONTEXT_METER_TOOLTIP_PATCH_MARKER,
  patchContextMeterTooltip,
  unpatchContextMeterTooltip,
} from './vendor-context-meter-tooltip-patch.js';

const upstreamFixture = `children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
\t\t\t\t\tlabel: t("context.aria", { percent: reading }),
\t\t\t\t\tside: "top",
\t\t\t\t\tdelayMs: 200,
\t\t\t\t\tdisabled: open,
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\tclassName: ContextMeter_module_css_default.trigger,
\t\t\t\t\t\t"aria-label": t("context.aria", { percent: reading }),
\t\t\t\t\t\t"aria-haspopup": "dialog",
\t\t\t\t\t\t"aria-expanded": open,
\t\t\t\t\t\tonClick: () => {
\t\t\t\t\t\t\tsetOpen(!open);
\t\t\t\t\t\t},`;

describe('temporary Harness context-meter tooltip patch', () => {
  it('uses the native title while disabling the mispositioned JS tooltip', () => {
    const patched = patchContextMeterTooltip(upstreamFixture);

    expect(patched).toContain(CONTEXT_METER_TOOLTIP_PATCH_MARKER);
    expect(patched).toContain('disabled: true');
    expect(patched).toContain('title: t("context.aria", { percent: reading })');
    expect(patched).toContain('"aria-label": t("context.aria"');
    expect(patched).toContain('onClick:');
  });

  it('is idempotent', () => {
    const once = patchContextMeterTooltip(upstreamFixture);
    expect(patchContextMeterTooltip(once)).toBe(once);
  });

  it('fails loudly after an upstream implementation change', () => {
    expect(() => patchContextMeterTooltip('new upstream bundle')).toThrow(
      /no longer matches/,
    );
  });

  it('restores the exact pinned upstream source', () => {
    const patched = patchContextMeterTooltip(upstreamFixture);
    expect(unpatchContextMeterTooltip(patched)).toBe(upstreamFixture);
  });
});
