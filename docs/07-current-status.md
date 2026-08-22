# 当前实现状态

更新时间：2026-08-22。

## 已完成

- Electron Forge + TypeScript + pnpm 可复现工程基线；主进程与 preload 使用显式 CommonJS 产物，避免 ESM/CJS 启动冲突。
- 固定 Node.js 24.19.0、`@deepseek-ai/dsh` 0.1.0-rc.8、pnpm 10.34.5 及其校验值；原生依赖通过 arm64 装配和真实 PTY 往返验证。
- rc.8 首次启动前会先确认全部需检查的旧版 ready 端口均已释放，再把非空 Runtime Home 复制到同级回退目录，完成后才允许 Harness 打开不兼容的新存储格式。同一原子事务标记存在期间只创建或续作同一个目标；正式标记损坏、目标非法或并发准备未完成时失败关闭。完成回滚并删除标记后再次升级，会创建带编号的新副本而不覆盖旧备份。
- 运行时基线测试会强制对齐 source manifest、production lock、DSH 完整性、rc.8 显式 peer 组合与全部 install-script allowlist；`runtime:verify` 会拒绝缺包或残留旧 Runtime，并验证 Node、node-pty、sharp 与 koffi。
- `runtime:vendor` 按架构装配运行时、校验 Node SHA-256、执行版本冒烟并原子替换资源目录。
- Runtime Home 与用户全局 dsh 隔离；运行时 PATH 只显式加入内置 Node/pnpm。
- `RuntimeSupervisor` 负责使用桌面壳选定的稳定回环端口、真实 HTTP 就绪探测、进程组终止和结构化失败。
- 桌面应用首次选择回环端口后会持久化稳定 origin；旧日志迁移按轮转文件物理顺序采用最后一次 ready origin，同时要求保留日志中的全部不同历史 ready 端口先释放，回滚产生更晚旧版记录后也会安全更新。就绪探测使用每次启动 secret 的 HMAC 挑战验证响应者持有本次 secret；桌面父进程异常退出后 Runtime owner watchdog 主动退出，任一遗留端口持续占用都会在写 endpoint 状态、复制或打开 Runtime Home 前失败关闭，抢占者不能伪装成 Harness。
- 主窗口启用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`；只允许当前 Harness origin，HTTPS 外链交给系统浏览器。
- 单实例、Dock 恢复、关闭隐藏、显式退出、重启 Harness、刷新 UI 和打开日志。
- 使用 `hiddenInset` 原生交通灯和 44px 本地一体化顶栏；顶栏提供原生拖动区域，官方 Harness 页面独立承载于下方 `WebContentsView`。顶栏背景分界通过隔离 preload 的 `ResizeObserver` 逐帧跟随侧栏展开、收起和拖拽宽度。
- 启动页采用 YukiRyou 品牌图标、柔光呼吸轨道、三段式加载节奏和轮换状态文案；失败状态停止循环动画并保留重试与诊断入口，同时遵守系统“减少动态效果”偏好。
- 设置弹窗新增“外观”和“关于”页面：外观复用 Harness 官方主题服务，支持浅色、深色、跟随系统和原生持久化；重新设计的关于页包含品牌区、动态应用版本、版本信息、开发者入口与更新中心。两页通过官方 `settings.section` 插槽离线注册。Harness 已解析的主题通过受限外观桥同步到本地顶栏，为后续整套风格注入提供统一入口。
- 插件设置已通过官方 `settings.plugins.tab` 增加只读“管理说明”和“插件市场”：管理说明使用 rc.8 官方 inventory 区分系统、依赖和外部来源并解释停用原因；插件市场在同一入口内提供发现、可安装、已安装和来源四视图。Market Host 支持固定版本的完整分页扫描，当前真实索引为来源报告 9672 条、规范化 9671 条、结构候选 911 条；搜索、分类和 UI 分页均基于完整本地索引。完整快照在受信任的 Runtime Home 下原子持久化，24 小时内重启直接恢复；读取时按白名单 schema 重建，损坏、错源、符号链接或超限缓存均被拒绝，来源不可用时才显式回退到已验证的过期快照。来源页支持添加、排序、停用和移除最多 20 个 HTTPS JSON v1 自定义目录；来源记录由 Host 原子持久化，内置来源不可修改，自定义目录经过逐跳 DNS/IP 与响应预算校验且只获得发现资格。远程图标由 Host 用不透明同源 ID 代理，逐跳拒绝私网目标、限制 MIME/体积/像素并重编码为 WebP，Client 不接触图片原始 URL。只能返回有限窗口的目录明确标为截断来源，不能产生可安装候选。目录不代表官方认可或安全审核；receipt 所有权约束下的受管安装、启用、停用、上一验证版本回滚和安全卸载均已开放，任意远程命令仍未开放。
- 插件市场 Phase 5 已形成完整的受管安装链：安全预检覆盖传递依赖图、Runtime Peer 兼容性和真实 npm 包体；独立 `ArtifactVerifier`、`ArtifactCache`、`ManagedPluginInstaller` 与 `PluginProfileBootstrap` Module 分别负责失败关闭的包体核验、内容寻址缓存与引用保护、离线 generation 装配，以及启动前试运行/receipt/blocklist/自动恢复。Renderer 只能通过受限 preload 请求短期一次性预览，Electron main 持有精确原生确认 Interface，确认后再次校验预览期限与 Runtime 身份才执行事务，并在结果送达后安排应用重启。公开 Runtime inspection 的 `executionReady` 仍保持 `false`，不存在可被页面直接调用的安装路由；Bootstrap 的内部 `mutationReady` 已为 `true`。真实 `@bocha-ai/dsh-web-search-bocha@0.1.0` 已完成 4 个包体、55,378 压缩字节、217,992 解包字节和 47 个文件的全链验证；`dsh-vision-toolkit@0.1.34` 仍因 rc.8 缺少两个必需 Client UI Peer在下载前明确阻断。插件市场所有可见时间统一通过本地化分钟级 formatter 展示，不直接显示 ISO 字符串。
- 内部受管事务已经进一步闭合：Runtime Host 的 `ManagedPreviewVault` 用最多 5 分钟、一次性的 opaque capability 私藏 frozen plan，并通过每次 Runtime 启动轮换、恒定时间比较的私有 token RPC 只接受 Electron main 调用；普通市场 UI 意图头无法访问。main 的 `RuntimeMarketClient` 严格限制响应大小和 schema，`ManagedInstallTransaction` 在任何写盘前消费自己的 token，并串行调用远程 staging 与本地 Bootstrap prepare；过期、重放、generation 不匹配、candidate 替换、并发 mutation 和失败后重试均失败关闭。安装图还会冻结 package 的真实 peer 声明、provider、精确版本和 Runtime snapshot hash；installer 只把 graph Peer 链接到对应 generation 包，把 Runtime Peer 链接到 bundled `node_modules` 中名称/版本均匹配且 realpath 未逃逸的包。Bootstrap 的 bundle 查找也已切换到 receipt 对应的 `generations/<generation>/node_modules`。受限产品 preload/IPC 开放预览、精确确认后的执行、只读受管 inventory，以及精确启停、回滚与卸载请求；Runtime token、URL、缓存路径和 frozen plan 均不会进入 Renderer。`ManagedPluginRemoval`、`ManagedPluginActivation` 与 `ManagedPluginRollback` 都只接受当前 receipt 的 package/version/generation，并与安装共用单 mutation 门。正常升级只保留一个上一已验证 generation；回滚无需重新下载或执行生命周期脚本，仍须原生确认和双健康试启动，成功后消费该回滚点，失败或中断则恢复当前版本。启停通过 receipt 中持久化的 `enabled` 状态和显式 `set-enabled` pending 生成包含或排除目标插件的试运行 launch plan；失败恢复原启用状态、profile 链接和配置，不删除 receipt/cache，也不把原健康插件加入 blocklist。显式重新安装、明确启用或回滚已被 blocklist 的 generation 会开启一次受控重试：试运行前临时解除阻断，失败恢复 blocklist，成功才永久清除。Legacy 产品导航另有 15 秒超时；新建空白产品视图直接首次加载，Runtime 重启时若视图仍承载旧文档，则在首次加载前 `stop()` 并复位到 `about:blank`，超时重试也重复复位，同时容忍 Electron 对被中止旧导航返回的预期 `ERR_ABORTED`。隐藏产品视图显式关闭 `backgroundThrottling`，避免冷启动时后台节流让已经就绪的 Runtime 被误报为 `spawn-failed`。包体和 generation 继续交给引用感知的缓存回收。开发版变更后只重启 Runtime，正式包重启应用。已安装页把官方 Runtime inventory 与 main 校验后的 receipt/blocklist 摘要合并，显示受管版本、格式化安装时间、Runtime 加载状态、上一可回滚版本和最近一次失败版本；只有 receipt 所有者显示“启用/停用”“回滚”和“卸载”。
- 插件版本更新继续复用同一条受管安装事务，而不是新增旁路：预览会根据当前精确 receipt 区分首次安装、同版本重装和版本更新，并把旧 package/version/generation 一并冻结；确认后 receipt 漂移会拒绝落盘。更新成功才替换 receipt；失败只 blocklist 新 generation，并恢复、重新加载旧稳定 generation，不再因同包名误伤已经验证的旧版本。
- 真实开发 fixture 已完成失败升级演练：健康的 `@dsh-desktop/development-install-fixture@1.0.3` 更新到会在顶层立即抛错的 `1.0.4-failure.1` 后，Harness Loader 确实在 ready 前退出；Host 随即恢复旧 receipt/profile，把失败 generation 以 `runtime-unhealthy` 写入 blocklist，并且只消费一次恢复重启。重启后 Runtime 恢复健康，已安装页保持 `1.0.3`，同时显示“已自动恢复失败版本 1.0.4-failure.1”，未出现无限循环。该 fixture 只由开发策略装配，正式 vendor/verify 路径继续拒绝携带它。
- Legacy 产品文档导航仍以 15 秒为单次硬超时，但每次尝试前都会中止残留导航并把隐藏的产品 `WebContents` 复位到 `about:blank`；一次导航在主文档完成事件或对应 `loadURL()` 正常完成时均可收敛，首次冷加载超时后再对同一可信 origin 发起一次全新导航。只有连续两次都未完成才进入失败页。隐藏视图不参与 Chromium 后台节流，这样既保留永久悬挂的有界保护，也不会把可恢复的冷启动误报为 `spawn-failed`。
- Windows 发行适配已进入 Phase 6：Forge 使用同一无扩展名品牌图标基址按目标解析 `.icns`/`.ico`，新增只在 `win32` 生效的 Squirrel.Windows Maker、x64 package/make 命令、七尺寸 ICO 资产及可重复生成脚本。主进程在 Windows 提前处理 Squirrel 安装/更新/卸载事件，并设置与 package ID、可执行文件匹配的 AppUserModelID；自动更新平台合同已显式允许 `darwin-arm64 | win32-x64`，其他组合继续失败关闭。Runtime schema 2 已纳入官方 Windows x64 Node ZIP、ConPTY 原生资产及 PE x64 校验。`Windows x64 candidate` CI 会在真实 Windows runner 上执行质量门禁、host-native Runtime vendor/verify、Squirrel make、打包应用启动/重启冒烟，并冻结 `Setup.exe`、full nupkg、`RELEASES`、SHA-256 与提交来源清单。当前仍是未签名内部候选；签名证书接入、干净 Windows 11 VM 的安装/升级/卸载验收与自动更新闭环尚未通过，因此不能发布 Windows 构建。
- bundled Runtime manifest 已升级为 schema 2，并以完整 target 而非单独 architecture 锁定官方 Node 归档：现有 `darwin-arm64`/`darwin-x64` 保留，新增 `win32-x64` 的 Node 24.19.0 ZIP 与官方 SHA-256。统一 `RuntimePlatformLayout` 成为 vendor、verify 和应用 Runtime 命令的唯一平台来源，定义 Node/npm 路径、`node-pty` prebuild、原生文件及 PTY smoke shell。vendor 只能在目标同平台主机运行，使用通用 tar 解压、目标化 npm 环境并裁剪非目标 prebuild；Windows 额外移除 PDB 和 Node 自带 npm 工具。verify 在 Darwin 使用 `lipo`，在 Windows 解析 PE x64 machine header，并继续真实运行 Node、DSH、pnpm、node-pty、Sharp 与 Koffi smoke。新脚本已在 macOS 重新 vendor/verify `darwin-arm64` 成功；`win32-x64` 会在 Darwin 下载或写盘前失败关闭，真实 Windows 验证留给 Windows runner。
- Harness “设置”上方已通过官方 `sidebar.footer.action` 插槽显示当前凭据所属账户余额；只显示官方 CNY/USD 账户余额，不显示今日消费。余额 Key 只在 Runtime credential service 内解析，主进程使用每次 Runtime 启动轮换的 token 拉取脱敏快照。
- 本地 shell 与 Harness 已改为两个独立 preload 构建产物；余额桥只存在于 Harness，shell 页面 E2E 已验证检测不到该 bridge。
- 本地顶栏已提供 Desktop Companion 开关；右栏使用官方 Session/Workspace store 识别当前上下文，再由 authenticated Runtime registry 复核归属。主进程只在复核成功后建立 Workspace Capability，renderer 仅能使用随机节点 ID，不能提交 root、绝对路径或 shell 命令。
- Workspace Review 已支持懒加载文件树、受限递归文件搜索、按路径/暂存态/状态组合筛选变更、当前 worktree 相对 HEAD 的目录化变更树与增删行数、带双侧行号/hunk/未修改行折叠的单文件 diff，以及 Markdown 排版/源码、纯文本和 PNG/JPEG/GIF/WebP 预览。文件搜索跳过依赖与构建目录，最多扫描 5000 项、返回 100 条，只交付 opaque node ID；Markdown 中受限的相对文件链接同样通过当前文件 capability 重入 WorkspaceInspector，绝对路径、协议 URL、越界与 symlink 仍被拒绝。文件预览使用按 revision 校验的 64 MiB LRU，并在当前 Workspace 内保留最多 50 条前进/后退历史；切换 Workspace 时清空且不落盘。变更预览提供当前筛选结果内的上一项/下一项、显式“已查看”和审阅进度；刷新 overview 或切换 Workspace 会清空标记，绝不写入项目文件。文本、Markdown 与 diff 的当前渲染内容支持不区分大小写的预览内查找、高亮、匹配计数和循环上一项/下一项。预览工具栏可复制相对路径；纯文本、Markdown 源码和 diff 行号可选择并复制行号或 `路径:行号`，写入通过长度受限的 shell preload 剪贴板桥完成。文件、文件夹和当前代码行还可通过拖放或右键菜单把受限的 Workspace 相对引用追加到当前会话输入框；纯文本复制保持独立操作。查询、筛选、预览历史、预览查找、当前行选择、复制与会话引用语义及审阅队列统一由纯内存 `WorkspaceReviewController` Module 管理。Runtime Authority 短暂重连会立即释放文件和预览 capability，但为搜索输入保留 1.5 秒无项目内容的 UI grace；超过时限仍未恢复才进入空状态。`⌘/Ctrl+P` 可从 Harness 或本地侧栏直接打开文件搜索，`⌘/Ctrl+F` 在已有预览中打开内容查找，`⌘/Ctrl+[` 与 `⌘/Ctrl+]` 切换预览历史，`Esc` 优先关闭查找、再次按下关闭预览。窗口在 820–979px 使用不挤压 Harness 的覆盖侧栏，打开文件进入不 reload Harness 的 Review Focus；980px 起使用 docked 模式，1320px 起并排显示 Harness、预览和右栏。右栏可在 280–480px 间拖动或用键盘调整，宽度在完整退出后恢复，并同步驱动 Harness bounds 与预览 inset。官方“产物”行保持不变，其下新增的逐轮变更卡消费成功 mutation 工具事件；升级前旧轮次只回填官方 deliverables 路径且不伪造增删统计。已归档的宠物实验不属于当前产品线，右栏只承载 Workspace Review。
- 产品正式更名为 DeepSeek YukiRyou，使用白底 YukiRyou 鲸鱼女仆品牌图标、独立 Bundle ID、中英文双 README 和品牌化关于页。
- 首次以新名称启动时会合并复制旧 `DSH Desktop` 用户数据，并写入迁移标记；旧目录保留为可恢复备份。
- 关于页展示开发者 GitHub `yoshino-xiao7`，点击后由系统浏览器打开主页。
- 运行时意外退出最多自动重启两次；失败页支持手动重试、打开日志和复制脱敏诊断。
- 应用日志按 2 MiB 自动轮转并保留 3 份历史；故障页和应用菜单可导出 ZIP 诊断包，包内仅包含脱敏后的环境摘要与桌面日志。
- 启动时校验 Harness `settings.yaml`；语法损坏或根节点类型错误时保留带时间戳的 `.corrupt-*` 原文件，创建权限为 `0600` 的空设置并提示用户，会话、凭据与工作区数据不受影响。
- 本地顶栏与 Harness renderer 使用独立的 30 秒有界恢复预算；真实打包应用已分别强制崩溃并验证互不重启，顶栏恢复后会重放侧栏宽度和主题快照。
- 正式签名的 Apple Silicon 版本启动 15 秒后自动检查更新，此后每 6 小时复查；关于页可随时手动检查并在下载完成后直接重启安装。仅在下载或等待安装时，Harness 侧栏右下角显示固定图标入口；侧栏结构不匹配、最新版、空闲和错误状态均失效关闭并移除。开发包明确禁用更新。
- 上一公开版 `v0.2.1-beta.2` 的 Apple Silicon `.app`、DMG 和 ZIP 已完成签名、公证与异机验收；当前 `v0.2.2-beta.1` 已生成本地 arm64 打包 `.app` 并通过真实 Harness Playwright 测试，DMG/ZIP 留给 Release macOS 工作流生成。
- 正式发布改为 GitHub Actions 多 runner 强制门禁：Forge 官方签名候选必须先在全新 runner 复制到 `/Applications` 并启动成功，才允许公证；最终 DMG/ZIP 还要在另一个全新 runner 重复安装、Gatekeeper、ticket 与启动验收，之后才创建 Draft。
- 运行时生产依赖审计为 0 个已知漏洞；内置 pnpm 已从存在高危公告的 10.33.2 升级到 10.34.5。

## 自动验证现状

```text
Unit:        385 passed（85 files）
Integration: 27 passed（9 files；fake Harness、真实 rc.8 dsh、受管 generation fixture、内置 pnpm、发布流程契约、压力/soak 冒烟）
E2E arm64:   7 passed（稳定启动、完整 UI/显式退出、renderer 恢复、Session 选择恢复、Companion 宽度持久化、Workspace 搜索/筛选/预览历史与逐文件审阅、Integrated 单产品窗口/Frame 健康门）
Upgrade:     3/3 consecutive runs passed（0.2.1-beta.2 → 0.2.2-beta.1；真实非空 Session、相同 origin/current selection/Session 集合、Runtime Home 回退副本）
Prior stress baseline:    100/100 passed（启动、就绪、停止、端口回收）
Prior companion baseline: 100/100 passed（审核、工作区切换、面板收起/展开状态循环）
Prior memory baseline:    2500/2500 passed（总 working set 480.2 → 476.9 MiB，无线性增长）
Prior app soak baseline:  60s passed（shell/Harness 每秒探测，5 个进程稳定）
Artifacts:   arm64 packaged `.app` generated；0.2.2-beta.1 DMG/ZIP 待 Release macOS 工作流生成和验收
```

`verify:release` 会检查桌面可执行文件、内置 Node、`pty.node`、`spawn-helper` 和运行时清单的架构一致性，并用包内 Node 实际运行 PTY、sharp 与 koffi 探针；正式发布模式还会逐项验证原生 PTY 签名，并强制验证 Developer ID 签名与 notarization ticket。全新 runner 安装候选和最终 DMG 后，会启动精确的 `/Applications` 产物并等待 Harness 就绪。

## 当前产物

- `out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app`

本地产物只适合开发验证，不应直接作为公开下载版本。上一公开版 `v0.2.1-beta.2` 已通过签名、异机安装、30 分钟真实打包应用 soak、Apple 公证、staple 和最终 DMG/ZIP 异机复验；已发布标签不可覆盖。

## 已完成的 CI 发布配置

1. 将 Developer ID Application 证书导出为带强密码的 `.p12`，以 Base64 和密码分别写入 GitHub Actions Secrets。
2. 将 App Store Connect API `.p8` 以 Base64 写入 GitHub Actions Secrets，同时配置 Key ID 与 Issuer ID。
3. 通过 `Release macOS` 生成并验收新版本 Draft；通过独立 `Publish verified macOS draft` 工作流公开。

上述 CI Secrets 与发布链已完成实际验证；后续版本继续按 `docs/09-github-and-apple-release.md` 执行，不在本地直接公开产物。

## 尚未完成的非发布项

- Harness 缺少已验证的稳定任务事件接口，因此通知功能按方案延期，不使用 DOM 文本猜测。
- Intel 原生机器上的 x64 E2E；当前用户设备与交付目标为 Apple Silicon。
- Integrated 仅保留双开关内部传输原型：直接 Harness ProductWindow、独立 RecoveryWindow、Frame 健康门与共用 Product bridge 可运行，但真实评审确认 rc.8 缺少占位侧栏、自然拖动区和稳定主题 seam。`shell.overlay` Workspace Review 已因遮挡、主题不一致和预览退化撤回；默认和单独请求 Integrated 都使用 Legacy。上游 composition contract 未补齐前，不继续迁移产品 UI。
- Windows 11 x64 发行仍处于架构与安全方案阶段；`v0.2.2-beta.1` 只交付 Apple Silicon macOS，不包含市场安装能力或 Windows 构建。下版本分支已实现社区目录、安全预检、受管安装/卸载与恢复 UI，但这些能力尚未进入公开发行；Windows 的真实安装、卸载与 packaged E2E 仍是发布门禁。
- Desktop Companion 非宠物阶段已完成，详见 [`10-desktop-companion-plan.md`](10-desktop-companion-plan.md)。宠物实验已经停止，不属于当前产品线；后续开发与发布保持不包含宠物代码。

## 冷备份分支

- 宠物实验代码仅保存在远程冷备份分支 `yukiryou/pet-experiment-archive-20260820`，归档提交为 `a05117e`（`archive: preserve abandoned pet experiment`）。
- 该分支只用于保留历史，不得自动合并、变基、挑拣、作为开发基线或进入发布构建。
- 只有项目所有者在当前对话中明确要求恢复宠物开发时，才能创建新的 `yukiryou/` 分支并按明确范围选择性恢复；普通的“继续”或路线图推进不构成授权。
