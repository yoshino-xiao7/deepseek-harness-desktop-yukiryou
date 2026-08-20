# 开发文档

本目录是项目开发方案的单一入口。建议按以下顺序阅读：

1. [产品范围与验收标准](01-product-scope.md)
2. [系统架构](02-architecture.md)
3. [安全模型](03-security.md)
4. [测试与发布](04-testing-and-release.md)
5. [实施计划](05-implementation-plan.md)
6. [开发约定](06-development-guide.md)
7. [外部依据](references.md)
8. [当前实现状态](07-current-status.md)
9. [外观扩展契约](08-appearance-extension.md)
10. [GitHub 与 Apple 发布准备](09-github-and-apple-release.md)
11. [Desktop Companion 完整实现方案](10-desktop-companion-plan.md)
12. [宠物平台完整实现方案](11-pet-platform-plan.md)

关键且难以逆转的决策记录在 [`adr/`](adr/)；领域术语以仓库根目录的 [`CONTEXT.md`](../CONTEXT.md) 为准。

## 当前基线

- 当前交付平台：macOS Apple Silicon（arm64）；Intel 构建链保留为后续可选目标。
- 最低系统：macOS 14 Sonoma；当前签名、公证和异机安装矩阵按该基线验证，下调需重新跑完整兼容与发布门。
- 分发方式：站外直接下载签名、公证后的 DMG/ZIP，不进入 Mac App Store。
- 运行方式：桌面壳启动随包固定版本的官方 Harness，再加载其本地 Web UI。
- 更新单位：整个应用原子更新；不单独在线升级 Harness。
- 当前阶段：`v0.2.1-beta.2` 代码基线已完成账户余额、Workspace Review、相对 Markdown 链接、64 MiB 有界预览和响应式矩阵；最近公开版已通过签名、公证与异机安装。宠物平台 Phase 6A–6C 已完成安全包 envelope、开发 Inbox、设置资产页、右栏尺寸与静态 Pet Stage，尚未开放用户动画安装。
- 下一阶段：Phase 6D 已纠正为 creator-first；专用 PetPlayer 隔离与 benchmark contract 已落地，先验证“角色参考图 + 自然语言 → 自动生成可导入包”，再对通过 Creator Gate 的开放候选做 packaged arm64 benchmark。Rive 当前仅保留技术探针，不作为默认产品方向。

## 后续仍需持续复核

- 当前 Developer ID、App Store Connect 公证凭据、下载仓库和更新 feed 已完成真实发布验证；每个正式候选仍需重新验证签名身份、notarization ticket、异机安装和更新链。
- 宠物动画 runtime 选定后补齐对应第三方许可证、编辑器/用户导入授权边界和隐私说明；Intel 若重新进入目标平台，必须增加原生 x64 真机矩阵。
