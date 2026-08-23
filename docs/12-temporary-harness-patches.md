# Harness 临时补丁

## 自定义模型输入能力编辑器

- 状态：启用
- 补丁标识：`deepseek-yukiryou:model-capabilities-patch:v1`
- 适用 Harness：`0.1.1-rc.2`
- 原因：rc.2 已加入 Vision Exp 和图片处理链，但 `llm-pi-ai` 自定义模型设置页仍未提供既有 `models[].input` 控件。
- 范围：只修改随包 Harness 的 `dsh-client-ui-settings-models/lib/client.js`，在自定义模型行的展开区域加入“自动继承 / 仅文本 / 文本与图片”。不修改图片发送校验，不设置 Provider 级 `defaultInput`，不改变官方 DeepSeek adapter。
- 持久化：选择“仅文本”写入 `input: [text]`；选择“文本与图片”写入 `input: [text, image]`；选择“自动继承”移除该模型的 `input` 字段。

### rc.2 复核结论

官方 `dsh-llm-deepseek` 已支持在 YAML catalog 中声明 `inputModalities: [text, image]`，但 `dsh-client-ui-settings-models` 的通用 `ModelListEditor` 仍只编辑 id、name、contextWindow 与 maxTokens。因此不能撤回自定义 Provider 的逐模型补丁。

升级 Harness 时必须重新检查官方模型设置页。版本保护会拒绝把本补丁自动套用到非 `0.1.1-rc.2` 的 bundle；官方覆盖 `models[].input` 后再删除补丁模块、vendor 步骤与集成契约测试。

## 会话选择恢复补丁

- 状态：启用
- 补丁标识：`deepseek-yukiryou:session-selection-patch:v1`
- 适用 Harness：`0.1.1-rc.2`
- 原因：启动阶段的 pending 列表仍可能把已持久化的当前 Session 掩蔽为 `undefined`，导致桌面重启后落入空白会话。
- 范围：只在官方 Session manager bundle 中延迟清除恢复选择，直到列表完成有效观测；不接管 Session 存储或工作区列表。

rc.2 源码和实际 bundle 复核确认该竞态尚未由上游解决，因此本次不能删除。上游提供完整的 workspace + session 恢复语义后，应删除此补丁及其 vendor/verify 门禁。
