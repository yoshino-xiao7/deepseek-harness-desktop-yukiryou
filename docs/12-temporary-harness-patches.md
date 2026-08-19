# Harness 临时补丁

## 自定义模型输入能力编辑器

- 状态：启用
- 补丁标识：`deepseek-yukiryou:model-capabilities-patch:v1`
- 适用 Harness：`0.1.0-rc.7`
- 原因：`llm-pi-ai` 已支持每模型 `models[].input`，但官方模型设置页没有对应控件，手工声明的视觉模型会保守回退为仅文本。
- 范围：只修改随包 Harness 的 `dsh-client-ui-settings-models/lib/client.js`，在模型行的展开区域加入“自动继承 / 仅文本 / 文本与图片”。不修改图片发送校验，不设置 Provider 级 `defaultInput`，不改变内置模型能力。
- 持久化：选择“仅文本”写入 `input: [text]`；选择“文本与图片”写入 `input: [text, image]`；选择“自动继承”移除该模型的 `input` 字段。

### 撤回条件与步骤

升级 Harness 时必须先检查官方模型设置页是否已经支持编辑每模型输入模态。版本保护会拒绝把本补丁自动套用到非 `0.1.0-rc.7` 的 bundle。

若官方已经修复：

1. 从 `scripts/vendor-runtime.ts` 删除 `patchModelCapabilitiesEditor` 的导入、版本保护与写入步骤。
2. 删除 `src/main/runtime/vendor-model-capabilities-patch.ts` 及其测试。
3. 删除 `tests/integration/bundled-harness.test.ts` 中的临时补丁契约测试。
4. 重新执行 `pnpm runtime:vendor -- --arch=arm64`，再运行 `pnpm check` 与打包 E2E。

用户设置中的 `models[].input` 是官方 adapter schema 的合法字段，因此撤回 UI 补丁不会破坏已保存配置；官方编辑器只需继续保留并呈现这些字段。

补丁模块同时导出 `unpatchModelCapabilitiesEditor()`，其往返测试确保当前补丁可以逐字恢复所针对的官方 bundle，便于升级前做差异核对。
