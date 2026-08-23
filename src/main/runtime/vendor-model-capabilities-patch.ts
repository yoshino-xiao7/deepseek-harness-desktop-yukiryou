/**
 * Temporary downstream patch for DeepSeek Harness 0.1.1-rc.2.
 *
 * rc.2 adds the Vision model and image pipeline, but the pi-ai
 * Models settings editor still does not expose its existing `models[].input`
 * field. Keep this transformation exact and version-scoped.
 */
export const MODEL_CAPABILITIES_PATCH_DSH_VERSION = '0.1.1-rc.2';
export const MODEL_CAPABILITIES_PATCH_MARKER =
  'deepseek-yukiryou:model-capabilities-patch:v1';

const ENGLISH_COPY_ANCHOR = '\t\t\tmodelAdvanced: "Capacities",';
const ENGLISH_COPY_PATCH = `${ENGLISH_COPY_ANCHOR}
\t\t\tmodelInputCapability: "Input capability",
\t\t\tmodelInputAuto: "Automatic / inherit",
\t\t\tmodelInputText: "Text only",
\t\t\tmodelInputVision: "Text and images",`;

const CHINESE_COPY_ANCHOR = '\t\t\tmodelAdvanced: "容量",';
const CHINESE_COPY_PATCH = `${CHINESE_COPY_ANCHOR}
\t\t\tmodelInputCapability: "输入能力",
\t\t\tmodelInputAuto: "自动继承",
\t\t\tmodelInputText: "仅文本",
\t\t\tmodelInputVision: "文本与图片",`;

const MODEL_FIELDS_ANCHOR = `\t\t\t\t\t\t\t\t\t\teditCapacity(index, "maxTokens", event.target.value);
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t})]`;

const MODEL_FIELDS_PATCH = `\t\t\t\t\t\t\t\t\t\teditCapacity(index, "maxTokens", event.target.value);
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("label", {
\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["modelField"],
\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["modelFieldLabel"],
\t\t\t\t\t\t\t\t\tchildren: t("modelInputCapability")
\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("select", {
\t\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["input"] + " " + ModelsSection_module_css_default["selectInput"],
\t\t\t\t\t\t\t\t\tvalue: Array.isArray(model["input"]) ? model["input"].includes("image") ? "vision" : "text" : "auto",
\t\t\t\t\t\t\t\t\t"aria-label": t("modelInputCapability") + " " + String(index + 1),
\t\t\t\t\t\t\t\t\tdisabled,
\t\t\t\t\t\t\t\t\tonChange: (event) => {
\t\t\t\t\t\t\t\t\t\tconst capability = event.target.value;
\t\t\t\t\t\t\t\t\t\tpatch(index, { input: capability === "vision" ? ["text", "image"] : capability === "text" ? ["text"] : void 0 });
\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("option", {
\t\t\t\t\t\t\t\t\t\tvalue: "auto",
\t\t\t\t\t\t\t\t\t\tchildren: t("modelInputAuto")
\t\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("option", {
\t\t\t\t\t\t\t\t\t\tvalue: "text",
\t\t\t\t\t\t\t\t\t\tchildren: t("modelInputText")
\t\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("option", {
\t\t\t\t\t\t\t\t\t\tvalue: "vision",
\t\t\t\t\t\t\t\t\t\tchildren: t("modelInputVision")
\t\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t})]`;

export function patchModelCapabilitiesEditor(source: string): string {
  if (source.includes(MODEL_CAPABILITIES_PATCH_MARKER)) return source;

  let patched = source;
  patched = replaceExactlyOnce(
    patched,
    'window.__ModuleLoader__.load({',
    `/* ${MODEL_CAPABILITIES_PATCH_MARKER} */\nwindow.__ModuleLoader__.load({`,
  );
  patched = replaceExactlyOnce(
    patched,
    ENGLISH_COPY_ANCHOR,
    ENGLISH_COPY_PATCH,
  );
  patched = replaceExactlyOnce(
    patched,
    CHINESE_COPY_ANCHOR,
    CHINESE_COPY_PATCH,
  );
  patched = replaceExactlyOnce(
    patched,
    MODEL_FIELDS_ANCHOR,
    MODEL_FIELDS_PATCH,
  );
  return patched;
}

/** Restore the exact pinned upstream bundle, primarily for upgrade review. */
export function unpatchModelCapabilitiesEditor(source: string): string {
  if (!source.includes(MODEL_CAPABILITIES_PATCH_MARKER)) return source;

  let unpatched = source;
  unpatched = replaceExactlyOnce(
    unpatched,
    `/* ${MODEL_CAPABILITIES_PATCH_MARKER} */\nwindow.__ModuleLoader__.load({`,
    'window.__ModuleLoader__.load({',
  );
  unpatched = replaceExactlyOnce(
    unpatched,
    ENGLISH_COPY_PATCH,
    ENGLISH_COPY_ANCHOR,
  );
  unpatched = replaceExactlyOnce(
    unpatched,
    CHINESE_COPY_PATCH,
    CHINESE_COPY_ANCHOR,
  );
  unpatched = replaceExactlyOnce(
    unpatched,
    MODEL_FIELDS_PATCH,
    MODEL_FIELDS_ANCHOR,
  );
  return unpatched;
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
      'Pinned Harness Models editor no longer matches the temporary model-capabilities patch',
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}
