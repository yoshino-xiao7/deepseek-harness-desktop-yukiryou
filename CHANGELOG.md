# 更新日志

本文件记录 DeepSeek YukiRyou 面向用户的版本变化。版本说明遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

## [1.0.4] - 2026-08-26

### 自动更新

- 修复 macOS 在更新 ZIP 仅完成下载、原生 Squirrel.Mac 尚未解包并确认可安装时就提前显示“更新并重启”的问题；现在必须等 Electron 原生更新器发出安装就绪事件后才允许重启安装。
- 更新安装明确要求安装完成后自动重新启动应用，避免用户点击后只看到旧进程退出。
- 正式发行新增 macOS 与 Windows 真实跨版本自动升级门禁：macOS 从 GitHub 当前上一公开版升级到本次精确候选；Windows 在隔离目录安装本次候选，再升级到单独构建且嵌入真实更高版本号的后继安装包。两端都经正式更新 provider 验证下载、安装、旧进程退出、系统重新拉起及打包应用冒烟。
- macOS 门禁动态选择上一公开稳定版，不再依赖写死的历史版本；Windows 普通候选构建保持快速，只有正式发行才执行完整的候选到后继版本升级闭环。

### 外部插件管理

- 插件市场“已安装”页现在可对身份和入口均可验证的外部顶层插件执行启用、停用与卸载，不再只能查看详情。
- 启停只写入桌面端自己的覆盖配置，不修改插件代码或用户原有配置；卸载通过内置 Harness 官方插件命令移除对应 web profile 顶层包，并在原生确认后重启应用。
- 子入口、系统插件、依赖项、路径越界或身份不匹配的包继续保持只读，避免把一个包内的局部入口误当作可独立卸载的插件。

### 验证

- 新增外部插件清单、路径边界、配置覆盖、卸载命令、IPC/preload 边界，以及跨平台自动更新下载、安装、重启和版本确认的回归测试。
- 正式发布仍须依次通过代码质量、Windows 真机、macOS 签名候选、异机安装与升级、30 分钟 soak、Apple 公证、最终异机安装、真实自动更新和公开前复验。

## [1.0.3] - 2026-08-26

### Workspace Review

- 修复 Runtime 短暂重连或切换会话后 Workspace Review 长时间停在“正在重新确认工作区”的问题：首次授权请求使用 2 秒上限，失败会立即退出阻塞状态，并在后台按最多 5 个阶段有界重试。
- Runtime 停止、失败或身份变化时会清除旧令牌、工作区能力、文件监视器和待执行重试；恢复后只接受当前会话与工作区身份对应的授权，避免旧响应重新挂回界面。
- 修复从 Harness 使用文件搜索快捷键时，WebContents 切焦未触发后续 `focus` 事件而偶发丢失快捷键的问题。
- “通用设置”新增默认开启的 Workspace Review 开关；关闭后隐藏入口、收起面板并释放工作区能力，且不能通过旧入口再次展开。

### 账户概览与界面

- “通用设置”新增默认开启的账户余额开关；关闭后隐藏侧栏余额与今日估算消耗，同时停止主进程查询并使在途响应失效，避免与同类插件重复或冲突。
- 两个开关使用 Harness 原生通用设置行的字号、字重、间距和颜色；设置弹窗继续保留 Harness 原生纯 `×` 关闭按钮，不注入额外文字样式。
- 桌面功能偏好使用原子持久化，快速连续切换时按最新状态生效，重启应用后保持用户选择。

### 验证

- 新增偏好持久化、Runtime 身份隔离、授权超时与恢复、快速切换，以及设置插件 UI 契约的回归测试。
- macOS Apple Silicon 与 Windows 11 x64 仍须完成签名、公证、安装、修复安装、便携版、卸载和自动更新元数据验证后才允许公开。

## [1.0.2] - 2026-08-25

### 自动更新

- 修复 Windows 安装版和便携版缺少 `app-update.yml`、导致 `electron-updater` 无法正常初始化的问题；macOS 与 Windows 打包门禁现在都会验证更新引导配置及固定 GitHub 仓库身份。
- 应用启动后立即检查更新，不再等待内置 Harness Runtime 完成启动；即使本地运行时启动较慢或失败，桌面更新仍可独立发现并提示。
- 主页更新入口只在检查、下载、可安装或失败重试等有效状态出现，并显示“检查中”“下载更新”“重启更新”等明确文字；确认已是最新版后自动隐藏，手动检查仍保留在“设置 → 关于”。

### 界面

- Workspace Review 的背景、工具栏表面和滚动条继承当前 Harness 主题，第三方浅色、深色和强调色皮肤下不再出现突兀的固定白底或系统滚动条。
- 重排插件市场“已安装”卡片，把插件身份、受管状态和操作按钮分为稳定的三列布局；窄窗口下自动改为纵向排列，避免按钮漂移和大块空白。

### 验证

- 新增更新引导文件、启动即检查、主页状态按钮、Workspace Review 主题滚动条及已安装插件布局的回归门禁。
- macOS Apple Silicon 与 Windows 11 x64 仍须完成签名、公证、安装、修复安装、便携版、卸载和自动更新元数据验证后才允许公开。

## [1.0.1] - 2026-08-25

### 修复

- 修复账户余额与今日估算消耗首次进入时经常显示“暂时无法查询”、需要反复刷新的问题；余额请求与本机会话统计改为独立缓存和并发读取，慢速统计不再阻塞余额显示。
- 补齐 DeepSeek V4 Flash、Vision Exp 与 Pro 的 usage 识别和估算路径，避免已产生调用但今日估算仍停留在 `¥0`。
- Workspace Review 默认保持收起，并监听当前工作区与 Git 状态变化；原生 watcher 丢失嵌套事件时由低频指纹校正，复制路径、行号和文件信息保持清晰可见。
- 修复主题插件切换模型或深浅色后，本地顶栏与右侧 Workspace Review 没有完整同步前景色、边框、强调色和表面颜色的问题。
- 修复 OpenAI Codex 登录使用 `about:blank` 中转窗口时被桌面安全策略直接拦截的问题；中转窗口仍限制为一次受控外部 OAuth 导航。
- 临时禁用 Harness `0.1.1-rc.2` 上会导致上下文容量区域抖动的非 portalled Tooltip，保留原按钮、无障碍标签、原生悬浮说明和点击详情；升级 Harness 时会强制复核并可完整撤回。
- 记住用户最后一次调整的窗口大小、位置与最大化状态，下次启动自动恢复；外接显示器移除后会把离屏窗口安全移回当前主屏。
- 修复 macOS 与 Windows 原生应用菜单中英文混杂的问题；正式版移除 Developer Tools 与强制刷新入口，并去除重复的全屏菜单项。

### 插件市场

- “已安装”默认只展示用户自行安装的插件，并可切换查看系统插件、依赖或全部条目，避免 170 余个只读内置模块淹没可管理插件。
- 已安装受管插件直接查询 npm `latest`，不再等待完整社区目录索引才能检查更新；目录证据和完整安全预检仍是实际更新的强制门禁。
- 过期的持久目录会立即可用，并在后台非阻塞刷新；刷新期间保留现有搜索、筛选和插件详情，不再让设置页长时间停在空白加载状态。

### 验证

- 完整 lint、类型检查、442 项单元测试和 40 项集成测试通过。
- macOS Apple Silicon 与 Windows 11 x64 的签名、公证、安装、修复安装、便携版和卸载生命周期由本版本候选工作流重新验证后方可公开。

## [1.0.0] - 2026-08-23

### 正式版

- 结束 Beta 版本号，macOS Apple Silicon 与 Windows 11 x64 进入同一套稳定版 `1.0.0` 发布、更新和回退链。
- 稳定版 Release 由工作流创建为正式发布并标记为 GitHub Latest；只有 GitHub 全部门禁和公开发布成功后，才同步中国大陆 OSS/ESA 镜像。

### 修复

- 修复本机今日估算消耗始终显示 `¥0`：Harness 的官方 DeepSeek 路由实际记录为 `deepseek-official`，现与兼容路由 `deepseek` 一并计费；Flash、Vision Exp 与 Pro 均按各自价格及北京时间峰谷区间计算。
- 修复 Windows 开启“减少动态效果”时启动页看起来完全卡住的问题：保留低强度、无位移的进度脉冲，同时继续尊重系统减少动态效果偏好。
- 修复已安装受管插件无法查看市场简介和来源的问题；详情会按安装收据中的来源读取对应目录，并保留本机版本、运行状态和安装类型作为失败回退信息。
- 修复插件目录长期未更新时把旧版本误当最新版的问题：安装前可明确选择“安装目录版本”或“安装最新版本”，两者分别执行完整安全预检并使用独立缓存。

### 插件市场

- 已安装受管插件新增“检查更新”，可对账 npm `latest`；若目录版本与最新版不同，会同时显示二者和最终精确安装包。
- 选择其他版本、更新或有意回退均复用现有冻结依赖图、真实包体验证、原生确认、试运行和失败自动恢复链，不新增安装旁路。

## [0.2.3-beta.3] - 2026-08-23

### 新增

- 内置 DeepSeek Harness 升级至 `0.1.1-rc.2`，加入 Vision Exp 模型、图片复用与上游沙箱安全修复；升级前为非空 Runtime Home 创建独立的 rc.2 回退副本。
- 账户概览新增本机今日估算消耗：按官方逐请求 usage 与北京时间峰谷费率计算，悬浮在余额位置切换展示，点击同步刷新消耗和余额。
- 插件市场新增由独立公开 JSON 维护的“YukiRyou · 实机验证”来源，记录开发者亲自安装测试过的精确插件版本，同时保留完整安装前安全预检。

### 改进

- Windows 改用可选择安装目录的向导式 NSIS 安装器、自绘原生标题栏和跟随 Harness 语言的菜单；macOS 与 Windows 安装版统一支持后台下载和确认后的重启安装，中国大陆优先走 OSS/ESA，失败自动回退 GitHub。
- 插件市场的可安装与已安装列表均支持搜索；完整目录容量提升到 20,000 条/200 页，并为超过 100 页的真实增长加入回归门禁。
- 移除重复的“外观”设置页，统一使用 Harness 官方“通用设置 → 外观”；未来完整 UI 风格通过声明式插件扩展。
- 所有插件时间统一使用本地化格式，来源详情补充实测平台、Harness 版本和验证时间。

### 修复

- 保留并迁移适用于 Harness rc.2 的会话选择恢复补丁，避免启动时 pending 列表把持久化会话掩蔽为空白会话。
- 开发版与正式版使用隔离的用户数据目录，避免开发调试污染已安装版本的状态。
- 修复社区目录超过 10,000 条后被误判为无效响应、开发版无法读取插件的问题。

### 发行

- macOS 14+ Apple Silicon 提供 Developer ID 签名和 Apple 公证的 DMG、ZIP。
- Windows 11 x64 提供未签名的向导式 Setup EXE 与便携 ZIP，并附独立 SHA-256 清单；可能出现 SmartScreen 警告。
- 国内镜像严格位于 GitHub 公开发布之后：版本化对象上传并回读校验成功后，才更新双平台自动更新元数据和插件目录。

## [0.2.3-beta.2] - 2026-08-23

### 修复

- 修复 Windows 普通用户首次启动长期停留在“正在唤醒 Harness”的问题：桌面扩展改用不要求管理员权限或 Developer Mode 的目录 junction。
- Windows 冷启动等待窗口从 20 秒调整为 60 秒，避免首次组装 Runtime 时被过早判定失败。
- Windows“关于”和手动更新状态改为显示 Windows x64、Setup EXE 与便携 ZIP，不再错误显示 Apple Silicon、macOS 和 DMG。

### 验证

- 真实 Windows 11 x64 非管理员交互桌面已覆盖固定 Runtime 装配、完整桌面功能/UI E2E、打包应用与便携 ZIP 启动/重启、Squirrel 首次安装、已安装应用启动、同版本修复安装、卸载清理和用户数据保留。
- Windows 候选流水线改为采集宿主窗口与 Harness 附着视图的独立截图，并为 387 MiB Runtime 的打包及产物上传预留完整时限。

## [0.2.3-beta.1] - 2026-08-22

### 新增

- 新增社区插件市场：完整目录索引、搜索、分类、分页、来源管理、安装前安全预检，以及受管安装、更新、重装、启停、回滚和卸载。
- 新增面向 Windows 11 x64 的桌面 Runtime、Squirrel 安装包和候选构建流水线；真实 Windows runner 已覆盖 Runtime 装配、ConPTY、打包启动、会话恢复、安装、修复安装和卸载生命周期。
- Workspace Review 新增文件与变更搜索、审阅队列、前进/后退历史、预览内查找、路径与行号复制，以及通过拖放或右键把文件、文件夹和代码行引用加入当前对话。

### 安全与改进

- 插件安装只接受通过目录/npm 身份、仓库回链、生命周期脚本、SHA-512、官方 tarball、平台、DSH bundle、Node、完整依赖图、Peer 兼容性和真实包体验证的冻结计划；Renderer 不接触 Runtime token、缓存路径或可执行计划。
- 插件变更使用一次性预览能力、系统原生确认、内容寻址缓存、离线 generation、双健康启动和失败自动恢复；受管 receipt 精确约束启停、回滚与卸载，失败版本进入 blocklist。
- 插件目录时间统一显示为本地化时间，不再直接暴露 ISO 时间字符串；长名称、深色主题和详情布局同步改善。
- Windows 路径、诊断归档、插件 junction、PTY 终止、应用进程树回收和 Squirrel 静默卸载合同得到平台化修复。
- 工作区右栏改为不遮挡对话的响应式 dock/overlay 布局，并修复拖动宽度状态、深色菜单对比度、长行 diff 显示和空白预览状态。

### 发行状态

- macOS 14+ Apple Silicon 继续提供 Developer ID 签名和 Apple 公证发行。
- Windows 11 x64 随同一 GitHub Release 提供未签名安装 EXE 与便携 ZIP，并附独立 SHA-256 清单；Squirrel NUPKG/RELEASES 只用于 CI 生命周期验证。真实上一版覆盖升级、自动更新闭环和独立 Windows 11 客户端验收继续完善，用户规模需要时再接入 Authenticode。

## [0.2.2-beta.1] - 2026-08-21

### 新增

- Runtime 基线升级至 DeepSeek Harness `0.1.0-rc.8`，获得上游原生多模态配置、命令图文输入、文件/会话引用及子代理改进。
- 首次使用 rc.8 启动前自动保留完整的 rc.7 Runtime Home 副本，作为不兼容存储格式迁移的回退点。

### 修复

- 修复本版安装后桌面应用重启或手动重启 Harness 时进入空会话的问题：Harness 回环 origin 现在跨启动保持稳定；从正常退出且保留 ready 日志的上一公开版升级时也会一次性迁移，因此官方 `dsh.sessions.current` 可以继续恢复最后活跃会话，升级门禁还会确认没有新增空白 Session。

### 改进

- 桌面壳启动 rc.8 Web Profile 时显式禁止打开系统浏览器，Harness UI 只在应用窗口内显示。
- 模型输入能力补丁已复核并严格迁移到 rc.8：上游新增的是官方 DeepSeek adapter 的 `inputModalities`，自定义 Provider 的 `models[].input` 仍需临时 UI 控件。
- 修复打包后启动页品牌图路径，改由 Vite 的 public asset 机制提供，不再出现开发环境正常、安装包图片缺失。
- 固定回环端口使用每次 Runtime 启动生成的 secret 与 HMAC 挑战证明响应者持有本次 secret；本机其他服务即使抢占端口也不能被误判为可信 Harness。一次性旧日志迁移还会要求轮转日志中保留的全部不同 ready 端口先释放；任一遗留 Runtime 仍占用端口，都会在复制或打开 Runtime Home 前失败关闭。
- `v0.2.1-beta.2` 升级合同明确要求先正常退出旧版；若旧版被强杀、崩溃或 ready 日志已清理，需先重启 macOS。日志已经丢失时可能需要在升级后手动重新选择一次原会话。

### 文档

- 接受 Plugin-first、main 层可替换 DesktopProductCarrier 与 Runtime 层 DesktopFramePlugin 的长期架构决定，并把 Windows 11 x64 纳入后续发行方向；这些规划不表示本版已经支持 Windows 或插件市场。

## [0.2.1-beta.2] - 2026-08-19

### 修复

- 主页面更新入口改为固定在侧栏右下角的图标按钮，不再依赖 Harness 品牌行结构，避免运行时更新后位置错乱或被挤出界面。
- 未配置模型时，账户余额说明改为纵向排布并与“设置”图标对齐，不再发生文字挤压、截断和起始位置偏移。
- 自定义模型目录新增逐模型输入能力选择，可明确设置为自动继承、仅文本或文本与图片；不会把同一 Provider 的所有模型一起误标为多模态。

### 改进

- Markdown 排版预览中的安全相对文件链接现在可以在当前工作区继续打开；协议 URL、绝对路径、越界路径和 symlink 仍被拒绝。
- 文件预览新增按 revision 校验的 64 MiB LRU，Workspace 切换会随 Inspector 一起释放缓存。
- 窗口最小宽度调整为 820px，并补齐 820/980/1180/1480px 的 overlay、docked、Review Focus 与宽屏审核布局验证。

### 维护

- 模型能力 UI 以仅适用于 Harness `0.1.0-rc.7` 的可逆临时补丁交付；升级 Harness 时会强制复核，官方修复后可以逐字撤回。

### 文档

- 修正 Desktop Companion 和 `v0.2.1-beta.1` 发布门禁状态；明确非宠物阶段已经收口。

## [0.2.1-beta.1] - 2026-08-18

### 修复

- 软件更新下载阶段新增不定进度动画与“下载中”状态，不再误显示为“检查中”。
- macOS 无法验证自动更新签名时不再停留在失败状态，改为明确提示并提供官方已公证 DMG 下载入口；不会绕过系统签名验证。
- 主页面更新提示固定在展开后的 DeepSeek Harness 品牌行中，不再出现在交通灯下方的空白工具栏。

### 文档

- 新增独立英文 README，并在中英文首页提供互相切换入口。
- 补充账户余额、Desktop Companion、文件预览、变更审核、安全边界和发布流程说明。
- 新增产品路线图，明确 DeepSeek 宠物处于开发中，手机远程控制与插件市场处于规划阶段。
- GitHub Release Notes 改为同一文件内同时提供简体中文与英文。

## [0.2.0-beta.1] - 2026-08-18

### 新增

- Runtime 基线升级至 DeepSeek Harness `0.1.0-rc.7`。
- 在“设置”上方显示当前 DeepSeek 凭据所属账户余额；不显示今日消费。
- 新增 Desktop Companion 右栏、当前工作区文件树、Git 变更摘要与单文件 diff。
- 新增纯文本、常见图片和 Markdown 排版预览；Markdown 仍可切换到源码。
- 在原生“产物”行下新增基于 rc.7 逐轮工具事件的变更卡，可展开文件并跳转到只读审阅。

### 安全与改进

- 拆分本地 shell 与 Harness preload；Harness 页面无法访问文件审阅能力。
- Workspace root 必须由 Runtime registry 复核会话归属，renderer 只能使用不透明节点 ID。
- rc.7 原生依赖增加真实 PTY、sharp、koffi、架构与发布包门禁。
- 账户余额改为与“设置”一致的横向行样式；Desktop Companion 统一 Harness 字号、标题和下划线标签，并加入 220ms 同步收放动画。
- 变更区改为可折叠目录树；diff 增加双侧行号、hunk、未修改行折叠与整行红绿背景。
- 历史轮次中的 Markdown 变更统一进入红删绿增的审核视图，不再误显示为当前文件的排版预览。
- 文件预览拒绝非法 UTF-8，并在解码图片前限制单边尺寸与总像素，避免替换字符和图片像素炸弹进入 renderer。
- 切换工作区时立即关闭旧预览，并增加 100 次审核、切换、收起和展开的确定性状态压力测试。
- Markdown 预览改为只消费 SafeMarkdown 结构；HTML、远程图片、iframe 与 `javascript:` 链接均作为普通文本显示。
- Workspace 切换会主动清空 preload 中缓存的旧预览正文和图片 data URL；文件读取改为 `O_NOFOLLOW` 句柄读取并校验读取前后文件身份。
- 新增打包应用长会话内存、上一版本 Runtime Home 保留和 shell/Harness 持续健康门禁。
- 发布流水线在异机安装候选后、公证前执行30分钟真实应用 soak；独立5小时扩展 soak 支持手动和每周低峰运行，不再阻塞普通 Beta 发布。
- Runtime 只有在 Harness 首页与受保护的 Companion RPC 同时就绪后才允许界面发起请求，避免慢速启动时短暂返回 `405`。

### 已知限制

- 变更区表示当前工作区相对 HEAD 的事实，不声称全部由当前轮次产生。
- 宠物活动区尚未加入，等待角色素材冻结后作为最后阶段开发。

## [0.1.1-beta.1] - 2026-08-18

### 新增

- 新增应用内检查更新、后台更新检查和下载完成后的重启安装入口。
- 新增 YukiRyou 品牌启动动画和状态反馈。
- 在原有自动更新 ZIP 之外增加 Apple Silicon DMG 安装包。

### 改进

- 使用多台全新 runner 对签名候选和最终 DMG/ZIP 执行安装、Gatekeeper 与真实启动验收。
- 提升跨机器复制后的签名稳定性，并统一 GitHub-safe 发行文件名。

### 已知限制

- 目前只支持 Apple Silicon 和 macOS 14 或更高版本。
- 当前仍为 Beta，建议重要工作保留项目与配置备份。
- 本项目是社区独立项目，不是 DeepSeek 官方客户端。

## [0.1.0-beta.1] - 2026-08-17

### 新增

- 首个公开 Beta，仅支持 Apple Silicon Mac。
- 将 DeepSeek Harness 封装为独立 macOS 桌面应用，并内置固定版本 Node.js、Harness 与 pnpm。
- 新增原生窗口交通灯、可拖动顶栏、侧栏动画同步、外观与关于页面。
- 新增运行时恢复、日志轮转与诊断包导出。
- 提供经过 Developer ID 签名、Apple 公证和 stapled ticket 验证的 ZIP。

### 已知限制

- 仅提供 ZIP，尚未提供 DMG 安装包。
- 属于早期测试版本，建议重要工作保留备份。

[1.0.3]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v1.0.3
[1.0.2]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v1.0.2
[1.0.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v1.0.1
[1.0.0]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v1.0.0
[0.2.3-beta.3]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.3-beta.3
[0.2.3-beta.2]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.3-beta.2
[0.2.3-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.3-beta.1
[0.2.2-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.2-beta.1
[0.2.1-beta.2]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.1-beta.2
[0.2.1-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.1-beta.1
[0.2.0-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.0-beta.1
[0.1.1-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.1.1-beta.1
[0.1.0-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.1.0-beta.1
