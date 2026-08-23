# 更新日志

本文件记录 DeepSeek YukiRyou 面向用户的版本变化。版本说明遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.2.3-beta.3] - 2026-08-23

### 新增

- 内置 DeepSeek Harness 升级至 `0.1.1-rc.2`，加入 Vision Exp 模型、图片复用与上游沙箱安全修复；升级前为非空 Runtime Home 创建独立的 rc.2 回退副本。
- 账户概览新增本机今日估算消耗：按官方逐请求 usage 与北京时间峰谷费率计算，悬浮在余额位置切换展示，点击同步刷新消耗和余额。
- 插件市场新增由独立公开 JSON 维护的“YukiRyou · 实机验证”来源，记录开发者亲自安装测试过的精确插件版本，同时保留完整安装前安全预检。

### 改进

- Windows 改用可选择安装目录的向导式 NSIS 安装器、自绘原生标题栏和跟随 Harness 语言的菜单；更新检查直接读取正式 GitHub Release。
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

[0.2.3-beta.3]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.3-beta.3
[0.2.3-beta.2]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.3-beta.2
[0.2.3-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.3-beta.1
[0.2.2-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.2-beta.1
[0.2.1-beta.2]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.1-beta.2
[0.2.1-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.1-beta.1
[0.2.0-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.2.0-beta.1
[0.1.1-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.1.1-beta.1
[0.1.0-beta.1]: https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/tag/v0.1.0-beta.1
