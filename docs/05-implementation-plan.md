# 实施计划

> 本文保留已完成的 Phase 0–5 基线和最初 Issue 切分，不再作为实时状态看板。当前事实见 [`07-current-status.md`](07-current-status.md)，下一阶段采用 [`11-integrated-desktop-shell-and-plugin-market.md`](11-integrated-desktop-shell-and-plugin-market.md)。宠物实验已归档，不属于当前产品线。

每个阶段都应形成一个可评审 PR；不得把签名、运行时装配和核心生命周期压到最后一次性处理。

## Phase 0：仓库基线

目标：得到可重复构建的空 Electron 应用。

- 初始化 pnpm、TypeScript、Electron Forge、lint、Vitest 和基础 CI。
- 建立 `src/main`、本地 Loading/Failure renderer、测试和 scripts 目录。
- 固定 Bundle ID 占位配置、arm64 构建目标与 macOS 14 deployment target；保留独立 x64 构建能力。
- 增加配置校验，禁止在 production 使用开发 URL。

完成标准：`pnpm test`、`pnpm typecheck` 和未签名 arm64 `.app` 构建通过；应用仅显示本地 Loading 页面。

## Phase 1：可复现 Harness 运行时

目标：无需全局 Node/dsh 即可从应用资源启动固定版本 Harness。

- 创建运行时版本清单和 `vendor-runtime`、`verify-runtime` 脚本。
- 分架构下载 Node、校验哈希、离线装配 dsh 与许可证。
- 实现 `RuntimeSupervisor` 及 fake adapters。
- 覆盖端口选择、就绪探测、超时、退出和进程所有权测试。

完成标准：集成测试能用 fake harness 覆盖失败矩阵；真实 dsh 在临时 Runtime Home 上完成启动/停止冒烟测试。

## Phase 2：桌面壳 MVP

目标：用户双击应用即可使用官方 Harness UI。

- 实现 `DesktopWindow` 的可信 origin 和导航策略。
- 实现 `AppCoordinator`、单实例、macOS activate/close/quit 生命周期。
- 增加 Restart Harness、Reload UI、Open Logs 和 About 菜单。
- 实现结构化错误页与脱敏日志。
- 加入端到端启动、端口占用、导航拦截、退出清理测试。

完成标准：满足产品验收标准 1–6；可提供内部未签名 DMG 给开发机测试。

## Phase 3：稳定性与诊断

目标：长时间运行和常见故障可恢复、可定位。

- 有界崩溃重启和 backoff。
- renderer 与 runtime 独立恢复。
- 日志轮转、诊断预览/导出、损坏偏好恢复。
- 使用稳定 Harness 事件接口实现通知；若接口不稳定则记录为延期。
- 完成正式候选 30 分钟 soak、独立5小时扩展测试和重复启动/退出压力测试。

完成标准：连续 100 次启动/退出无遗留进程；故障矩阵均能给出用户可操作信息。

## Phase 4：签名、公证与发布

目标：形成可公开下载、可被 Gatekeeper 信任的正式发行物。

- 确定产品名、Bundle ID、图标、Apple Team 和发布地址。
- 配置 Developer ID、Hardened Runtime、entitlements、notarization 和 stapling。
- 构建 arm64 DMG + ZIP；生成哈希、SBOM 和第三方许可证。
- 实现 `AppUpdater` 的手动检查/下载/退出安装路径。
- 验证从候选旧版本升级并完成发布 runbook。

完成标准：满足产品验收标准 7–8及《测试与发布》的发布完成定义。

## Phase 5：V1.1 候选

- 自动后台检查更新，仍由用户确认安装。
- 任务完成/审批等待通知。
- 菜单栏模式、登录时启动。
- 经过正式兼容矩阵的运行时升级工具。

## 已接受的后续专题计划

Desktop Companion 的完整产品语义、架构、安全 seam、文件落点、测试矩阵与阶段退出条件已冻结在 [`10-desktop-companion-plan.md`](10-desktop-companion-plan.md)。非宠物阶段已实现并随 `v0.2.1-beta.1` 完成签名、公证和异机发布验证；相对 Markdown 文件链接、64 MiB 有界预览缓存和 820px 最小窗口响应式矩阵也已收口。下一实施阶段是一体化 DesktopProductCarrier、DesktopFramePlugin、受管插件目录与 Windows 发行适配。

Desktop Companion 已完成的实施顺序为：安全契约与双 preload → 账户余额 → 右栏与 Workspace Capability → 文件树和安全预览 → Git 变更与审阅 → 无宠物版本稳定性验收。宠物实验已停止并存入冷备份分支；不得把它自动恢复到后续开发或发行分支。该专题阶段不得反向改写上文已经完成的基础 Phase 0–4。

## 首批 Issue 切分

1. `build: bootstrap Electron Forge + TypeScript + pnpm`
2. `build: add runtime manifest and deterministic vendor script`
3. `runtime: implement supervised child-process lifecycle`
4. `runtime: add fake harness and failure matrix`
5. `window: enforce trusted local origin and navigation policy`
6. `app: implement macOS single-instance and quit lifecycle`
7. `diagnostics: structured failures, redacted logs and export preview`
8. `test: Electron E2E for startup, occupied port and shutdown`
9. `release: architecture-specific packaging and nested-code signing`
10. `release: notarization, artifact verification and draft publishing`
11. `update: atomic signed app update`
12. `docs: operator runbook and user data/uninstall guide`

## 风险登记

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| dsh Developer Preview 破坏性变化 | 启动/UI/数据不兼容 | 固定版本、契约测试、原子应用发布 |
| dsh 依赖原生模块 | 双架构打包或签名失败 | 每架构原生构建、清单扫描所有 Mach-O |
| Web UI 无稳定任务事件 | 通知不可靠 | 不使用 DOM 猜测，延期或开发官方插件 |
| Harness HTTP 服务位于 loopback | 本机进程可能探测或抢占固定端口 | 稳定 origin、旧日志全部历史 ready 端口迁移检查、每次启动随机 secret 的 HMAC 持有证明、owner watchdog、持续占用失败关闭与可信导航；持续跟踪官方认证能力 |
| macOS 进程树退出差异 | 遗留工具进程 | 进程组、所有权记录、真实集成测试，不按名称清理 |
| 公证/自动更新配置晚暴露 | 无法发布 | Phase 0 保留配置，Phase 2 进行首次开发签名演练 |
| 用户数据格式不可逆 | 回滚困难 | 升级前兼容检查；必要时快照 Runtime Home |

## 执行原则

- 每阶段先写/更新最小相关测试，再实现接口行为。
- 每次升级 dsh 都单独提交并附真实启动日志摘要、版本差异和兼容结论。
- 任何新增 preload 能力必须先更新安全模型和威胁测试。
- 代码事实与文档冲突时，同一 PR 内修正文档；`docs/` 不保留失效计划。
