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
12. [一体化桌面框架与插件市场改造方案](11-integrated-desktop-shell-and-plugin-market.md)
13. [开发者实机验证插件来源](13-developer-curated-plugin-source.md)

关键且难以逆转的决策记录在 [`adr/`](adr/)；领域术语以仓库根目录的 [`CONTEXT.md`](../CONTEXT.md) 为准。

## 当前基线

- 当前交付平台：macOS Apple Silicon（arm64）；Intel 构建链保留为后续可选目标。
- 最低系统：macOS 14 Sonoma；在首个可运行原型上重新验证后才可下调。
- 分发方式：站外直接下载签名、公证后的 DMG/ZIP，不进入 Mac App Store。
- 运行方式：桌面壳启动随包固定版本的官方 Harness，再加载其本地 Web UI。
- 更新单位：整个应用原子更新；不单独在线升级 Harness。
- 当前阶段：`yukiryou/v1.0.1` 正在完成稳定版修复候选门禁；macOS arm64 与 Windows x64 共用 Harness 0.1.1-rc.2、账户概览、受管插件市场和双区域自动更新链。实时事实以 [`07-current-status.md`](07-current-status.md) 为准。
- 下一阶段：按已接受的 [`11-integrated-desktop-shell-and-plugin-market.md`](11-integrated-desktop-shell-and-plugin-market.md) 推进一体化窗口、插件目录与 Windows 11 x64 发行适配。宠物实验已归档，不属于当前产品路线。

## 发行配置

- Apple Developer Team、Developer ID Application 证书和公证凭据仅保存在 GitHub Actions Secrets。
- 发布仓库、下载入口、隐私边界和第三方许可证展示方式以当前发行工作流与公开文档为准。
