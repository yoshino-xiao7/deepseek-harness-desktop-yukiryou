---
status: accepted
date: 2026-08-21
---

# 采用 Plugin-first、可替换 DesktopProductCarrier 与 DesktopFramePlugin

## 背景

当前桌面应用同时使用 Harness Host/Client 插件、preload DOM 观察、版本限定的编译 bundle 补丁，以及本地 toolbar 与 Harness `WebContentsView` 的布局拼接。这些实现交付了原生窗口、更新、Workspace Review 和模型能力等差异化功能，但把一部分产品行为绑定到 Harness DOM、编译产物和双 renderer 像素同步。

产品需要同时满足：

- 跟随 DeepSeek Harness 快速升级；
- 保留 macOS/Windows 原生窗口、文件、Git、PTY、更新和恢复能力；
- 继续开发插件市场、Desktop Companion、Agent 与其他差异化功能；
- 不维护一份长期 Harness fork。

## 决定

采用 **Plugin-first，但不要求 plugin-only** 的分层：

1. Harness 业务能力和 UI 默认实现为 Host/Client 插件，并优先贡献到准确的加法型 slot。
2. 普通业务插件不得替换 `root`、`sidebar`、`conversation` 或 `details` 的既有 occupant，也不得依赖根布局 implementation。
3. Electron 双/单 webContents 载体切换只允许存在于 main 层 `DesktopProductCarrier`；迁移期间保留完整的 `LegacyDesktopProductCarrier` 与 `IntegratedDesktopProductCarrier`。
4. 根布局 composition、标题栏留白和 surface 空间关系只允许存在于 Runtime 的版本化 `DesktopFramePlugin`；该插件仅用于 Integrated carrier，不创建或回退 Electron 窗口。
5. 文件、Git、PTY、原生窗口、进程、签名和更新继续位于 Electron 原生 Module，通过窄、类型化、失败关闭的 preload bridge 向产品插件提供能力。
6. 插件间协作只使用 Cordis service、正式 Host/Client protocol、slot 与序列化 store，不跨包导入 implementation。
7. 官方提供稳定 Electron Client composition/IPC carrier 后，通过新增 `NativeElectronProductCarrier` 替换本地 Web Profile transport，并按正式 root contract 缩小或删除 Frame 插件，不重写业务插件。
8. DOM selector、页面 MutationObserver 和编译 bundle 字符串修改仅可作为版本锁定的临时补丁；每项必须有契约测试、失配拒绝和删除条件。

详细目标、双平台设计、插件市场和分阶段验收见 [`../11-integrated-desktop-shell-and-plugin-market.md`](../11-integrated-desktop-shell-and-plugin-market.md)。

## 结果

正面结果：

- Harness 升级影响集中在插件 contract 与单一 Frame 插件，Electron 载体差异则集中在 main carrier，获得更高 locality。
- Companion、市场、余额和 Agent 扩展不随窗口 composition 变化而重写。
- macOS/Windows 共享产品布局，平台差异收敛到真实原生 Adapter。
- 特殊功能仍可使用 Electron 能力，不需要为了“纯插件”牺牲安全或产品体验。

代价与约束：

- Integrated Frame 在正式 root composition contract 稳定前仍需要固定 Runtime 与契约测试。
- 迁移期同时维护 Legacy/Integrated 两个 carrier 和一个 Integrated Frame 插件，短期代码量增加。
- Client 插件共享 renderer，不构成彼此隔离的安全沙箱；本地插件信任模型必须如实说明。
- 新功能若缺少正式 seam，可能需要先推动上游能力或保持关闭，不能再用 DOM 猜测快速绕过。

## 拒绝的替代方案

- **继续扩展 DOM/编译产物注入**：差异化能力强，但升级成本和误匹配风险持续上升。
- **所有功能强制纯插件化**：无法合理承载窗口、文件、进程、签名和更新等操作系统能力。
- **长期 fork Harness**：自由度最高，但会把每次上游升级变成持续合并与安全审计负担。
- **把 Electron carrier 与 Runtime root composition 合成一个 Adapter**：跨进程生命周期和所有权不一致，无法真实表达 legacy 回退。
- **让每个业务插件处理 root 或 Electron IPC**：会扩散高风险知识，形成多个浅 Module 和不可控 interface。
