# 当前实现状态

更新时间：2026-08-20。

## 已完成

- Electron Forge + TypeScript + pnpm 可复现工程基线；主进程与 preload 使用显式 CommonJS 产物，避免 ESM/CJS 启动冲突。
- 固定 Node.js 24.19.0、`@deepseek-ai/dsh` 0.1.0-rc.7、pnpm 10.34.5 及其校验值；rc.7 带来的 `node-pty` 1.2.0-beta.15 已通过 arm64 原生装配和真实 PTY 往返。
- 运行时基线测试会强制对齐 source manifest、production lock、DSH 完整性与全部 install-script allowlist；`runtime:verify` 会拒绝残留旧 Runtime，并验证 Node、node-pty、sharp 与 koffi。
- `runtime:vendor` 按架构装配运行时、校验 Node SHA-256、执行版本冒烟并原子替换资源目录。
- Runtime Home 与用户全局 dsh 隔离；运行时 PATH 只显式加入内置 Node/pnpm。
- `RuntimeSupervisor` 负责随机回环端口、真实 HTTP 就绪探测、进程组终止和结构化失败。
- 主窗口启用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`；只允许当前 Harness origin，HTTPS 外链交给系统浏览器。
- 单实例、Dock 恢复、关闭隐藏、显式退出、重启 Harness、刷新 UI 和打开日志。
- 使用 `hiddenInset` 原生交通灯和 44px 本地一体化顶栏；顶栏提供原生拖动区域，官方 Harness 页面独立承载于下方 `WebContentsView`。顶栏背景分界通过隔离 preload 的 `ResizeObserver` 逐帧跟随侧栏展开、收起和拖拽宽度。
- 启动页采用 YukiRyou 品牌图标、柔光呼吸轨道、三段式加载节奏和轮换状态文案；失败状态停止循环动画并保留重试与诊断入口，同时遵守系统“减少动态效果”偏好。
- 设置弹窗新增“外观”和“关于”页面：外观复用 Harness 官方主题服务，支持浅色、深色、跟随系统和原生持久化；重新设计的关于页包含品牌区、动态应用版本、版本信息、开发者入口与更新中心。两页通过官方 `settings.section` 插槽离线注册。Harness 已解析的主题通过受限外观桥同步到本地顶栏，为后续整套风格注入提供统一入口。
- Harness “设置”上方已通过官方 `sidebar.footer.action` 插槽显示当前凭据所属账户余额；只显示官方 CNY/USD 账户余额，不显示今日消费。余额 Key 只在 Runtime credential service 内解析，主进程使用每次 Runtime 启动轮换的 token 拉取脱敏快照。
- 本地 shell 与 Harness 已改为两个独立 preload 构建产物；余额桥只存在于 Harness，shell 页面 E2E 已验证检测不到该 bridge。
- 本地顶栏已提供 Desktop Companion 开关；右栏使用官方 Session/Workspace store 识别当前上下文，再由 authenticated Runtime registry 复核归属。主进程只在复核成功后建立 Workspace Capability，renderer 仅能使用随机节点 ID，不能提交 root、绝对路径或 shell 命令。
- Workspace Review 已支持懒加载文件树、当前 worktree 相对 HEAD 的目录化变更树与增删行数、带双侧行号/hunk/未修改行折叠的单文件 diff，以及 Markdown 排版/源码、纯文本和 PNG/JPEG/GIF/WebP 预览。Markdown 中受限的相对文件链接可通过当前文件 opaque node 重入 WorkspaceInspector，绝对路径、协议 URL、越界与 symlink 仍被拒绝；文件预览使用按 revision 校验的 64 MiB LRU。窗口在 820–979px 使用不挤压 Harness 的覆盖侧栏，打开文件进入不 reload Harness 的 Review Focus；980px 起使用 docked 模式，1320px 起并排显示 Harness、预览和右栏。官方“产物”行保持不变，其下新增的逐轮变更卡消费 rc.7 成功 mutation 工具事件；升级前旧轮次只回填官方 deliverables 路径且不伪造增删统计。右栏顶端现包含 Pet Stage，文件区占用其余空间。
- 产品正式更名为 DeepSeek YukiRyou，使用白底 YukiRyou 鲸鱼女仆品牌图标、独立 Bundle ID、中英文双 README 和品牌化关于页。
- 首次以新名称启动时会合并复制旧 `DSH Desktop` 用户数据，并写入迁移标记；旧目录保留为可恢复备份。
- 关于页展示开发者 GitHub `yoshino-xiao7`，点击后由系统浏览器打开主页。
- 运行时意外退出最多自动重启两次；失败页支持手动重试、打开日志和复制脱敏诊断。
- 应用日志按 2 MiB 自动轮转并保留 3 份历史；故障页和应用菜单可导出 ZIP 诊断包，包内仅包含脱敏后的环境摘要与桌面日志。
- 启动时校验 Harness `settings.yaml`；语法损坏或根节点类型错误时保留带时间戳的 `.corrupt-*` 原文件，创建权限为 `0600` 的空设置并提示用户，会话、凭据与工作区数据不受影响。
- 本地顶栏与 Harness renderer 使用独立的 30 秒有界恢复预算；真实打包应用已分别强制崩溃并验证互不重启，顶栏恢复后会重放侧栏宽度和主题快照。
- 正式签名的 Apple Silicon 版本启动 15 秒后自动检查更新，此后每 6 小时复查；关于页可随时手动检查并在下载完成后直接重启安装。仅在下载或等待安装时，Harness 品牌行显示紧凑更新入口；最新版、空闲和错误状态均隐藏。开发包明确禁用更新。
- Apple Silicon `.app`、DMG 和 ZIP 构建成功；打包应用真实启动官方 Harness 的 Playwright 测试通过。
- 正式发布改为 GitHub Actions 多 runner 强制门禁：Forge 官方签名候选必须先在全新 runner 复制到 `/Applications` 并启动成功，才允许公证；最终 DMG/ZIP 还要在另一个全新 runner 重复安装、Gatekeeper、ticket 与启动验收，之后才创建 Draft。
- 运行时生产依赖审计为 0 个已知漏洞；内置 pnpm 已从存在高危公告的 10.33.2 升级到 10.34.5。
- 宠物平台 Phase 6A 已完成：`.yukipet draft-0` 严格 envelope、通用 ZIP/manifest preflight、路径/链接/可执行载荷/压缩炸弹/大小/哈希/缩略图门禁，以及只接受 opaque ID 与 revision 的 Pet Library contract/fake 均已有确定性单元测试；此阶段不加载动画 payload，也不向用户承诺格式兼容。
- 宠物平台 Phase 6B 已完成：应用自有 Pet Library 持久化、串行 revision、同卷原子开发 Inbox、主进程系统选择器、metadata-only Harness bridge，以及中英文“宠物”设置页均已接通。`dsh-pet:` 只可读取主进程预注册的有界 PNG/WebP 缩略图；公开打包默认关闭 draft 导入，开发 Inbox 条目不会成为 ready 资产。内置“YukiRyou 鲸鱼女仆（开发预览）”现在以签名 `.yukipet` 随包交付，启动时必须通过同一深层预检才会成为 ready 资产，缺失、损坏或身份不匹配均 fail-closed。
- 宠物平台 Phase 6C 已完成：Companion 的 `open` 与 `preferredWidth` 分离，宽度统一限制为 340–560px；支持指针 separator、键盘 16/48px 步进、双击复位和原子 `desktop.json` 持久化。达到 340px 后继续缩小无效且不会关闭，右上开关仍可完全隐藏并恢复上次宽度。文件区上方的 Pet Stage 严格裁剪动画 surface，独立 DOM 气泡会在 Harness `running=true` 时显示“疯狂进食 token 中”；真实打包 E2E 已覆盖 pointer 380→460→340px、600/720/900px 垂直矩阵，以及 Player Canvas 真正完成 standing 呈现。
- 宠物平台 Phase 6D 的通用底座已完成：专用 PetPlayer 隔离、一次性 MessagePort、外部 watchdog、frame-time 指标、fail-closed benchmark contract、trial recorder 和隔离 runtime validator 均已落地。2026-08-20 已纠正选型原则：`creatorInputContract` 与 `headlessSkillGeneration` 现在是一票否决门，候选必须先证明普通用户只用角色参考图和自然语言即可由项目流程生成、验证并打包宠物，才允许进入 packaged benchmark。Creator-first 工作流现已提供准备角色、确定主形象、生成动作、孵化打包四段单调进度，九类动作可逐项完成；失败/取消终态不会伪装成功，生成器与独立视觉 QA 不共享可变参考图或进度能力。模型编排 Module 已固定 canonical look → 九类 60fps 动作的依赖图、三路并发、一次瞬时重试、取消传播、1,320 帧预算和版本化 Backend 身份绑定。首个真实远端动作源探针已按官方契约接入 Runway Gen‑4.5，固定 API 版本、方形图生视频、5 秒轮询、取消/删除、HTTPS/MP4/64 MiB 输出门禁和安全拒绝分类；它默认关闭、不读取 DeepSeek Key。`ClipBasedPetVisualBackend` 现已把主形象、视频生成与隔离 rasterizer 收敛成一个带稳定版本指纹的完整 Backend，并严格校验 atlas 几何、透明边缘、稳定定位、活动区边界和真实不同帧比例；低帧源复制到 60fps 会直接失败，不能伪装过门。确定性 rasterization 核心已实现固定绿幕的软 alpha、绿色溢色抑制、空前景/越界拒绝，并通过两遍处理所需的全片 union bounds 计算唯一裁切、缩放和底部基线，避免角色逐帧忽大忽小或上下跳动。Chromium 转换内核也已完成：从完整 MP4 时间轴产生精确目标时间戳，第一遍解码、去背景并以 SHA-256 统计真实不同帧，第二遍重新解码并用统一 transform 写入 192×208 cells，最后编码透明 PNG atlas；视频、源尺寸、时长、帧数和 atlas pixels 均有硬上限并响应取消。一次性 `ChromiumPetMotionRasterizer` host、专用 Vite/preload 入口和精确协议现已接通：每动作使用独立非持久 partition，禁止 Node、权限、下载、弹窗、导航和外网；epoch/nonce/generation、精确字段、输入输出大小均由两端校验，90 秒 watchdog、取消、端口关闭或 renderer 崩溃由主进程强制销毁 realm。该 Module 现在同时实现版本化 `PetAtlasFrameDecoder`：PNG/WebP atlas 必须是固定 192×208 cell、最多 240 帧，解码后原始 RGBA 被限制为 38.3 MiB 并切成互不共享的只读 QA 帧副本。打包 arm64 Electron 真实媒体 smoke 已覆盖完整 `MP4 → 透明 PNG atlas → 90 个 RGBA frames` 往返；本轮 Chromium 150 实测输入 13,356 bytes、atlas 469,151 bytes、90 个目标帧中 85 个真实不同帧，透明边缘、稳定定位和活动区边界全部通过。独立视觉 QA 主模块也已完成：逐动作客观检查透明边缘、4px 活动区安全留白、空白帧、相邻帧质心/面积/像素突变，以及 loop 动作首尾闭合；它只抽取五个确定性采样帧交给独立身份模型 Adapter，绝不使用像素相似度替代角色身份判断。decoder、身份模型与 objective-v1 共同形成 evaluator 版本指纹并绑定 Creator Input/generation hash。当前只剩接入与 Runway 生成端独立的真实身份视觉模型，再用真实生成样片通过 Creator Gate；因此 Runway 还不能计为通过。现有 Rive Canvas Lite `2.40.0` 代码只保留为 Player/validator 技术探针；因 `.riv` 当前依赖专有编辑器导出且尚无项目可用的无头制作链，Rive 不再是默认下一步，也不能据此冻结 runtime。普通启动仍保持两 renderer 基线。
- arm64 打包输入已改为 `.cache` 下的硬链接干净镜像，不读取或删除 `resources/runtime` 中的 macOS 云端编号冲突副本。当前镜像保留 33,788 个文件和 13 个符号链接，排除 689 个存在规范同名项的冲突副本；完整 `.app` 打包及 packaged E2E 3/3 通过。E2E 退出改为有界的 app quit → SIGTERM → SIGKILL 测试子进程清理，失败用例不再遗留应用实例。
- Phase 6D 凭据门纠正：产品复核已否决需要 Runway/OpenAI Key 的完整制作组合，相关组合工厂已删除。`extraProviderCredentialRequired:false` 和 `zeroExtraCredentials` 现在是一票否决门；Runway/OpenAI 代码只保留为研究探针，不能获得 Creator Gate pass。正式下一步改为验证本地自动制作 Module，或由 Phase 7 Skill 使用宿主已提供且无需用户另配 Key 的图像能力；终端用户 Interface 始终只有角色图和自然语言。
- 实验性 `skills/yukiryou-pet-authoring/` 已把现有 Codex 图像能力适配为项目协议：公开输入只有角色参考图和自然语言，输出为 `.yukipet`、预览与绑定证据，不需要用户配置额外 Key。产品已否决会出现零件拼装感的自动分层 rig；当前内置开发预览改为九段“完整角色帧序列”，运行时不再组装头、手、服装或鲸尾。语义链固定为站立→犯困→趴下→睡眠→醒来→揉眼→站立，以及站立→工作进入→进食→工作退出→站立。生成底稿保留 60fps/1,320 帧，随包交付版本使用 30 个独立完整画面/秒、共 660 帧，并由 60Hz rAF 按 elapsed time 播放；编码后 651/651 组相邻帧全部不同。内置 `.yukipet` 为 6,108,277 bytes，启动只解码 standing 图集，其他动作按需解码并释放上一图集。真实 arm64 Player smoke 已逐项呈现 9 种动作，启动 4,925ms、刷新周期 16.7ms、P95 17.6ms、超过两倍刷新周期比例 0；生产握手门限据此从易抖动的 5 秒调整为有界 10 秒。该包仍标记“开发预览”，动作自然度和慢放视觉仍待产品人工验收；Creator Gate 与产品批准仍未运行，因此不能宣称官方宠物或公开制作 Skill 已完成。

- 启动时延复测修正：打包后冷启动 ready 为 13,123ms，稳定复跑为 6,407ms；因此上一条的 10 秒为中间实验值，最终生产 `PetPlayerRealm` 使用有界 20 秒外部 watchdog，自动 smoke 仍要求 15 秒内 ready。九动作、刷新周期 16.7ms、P95 17.7ms 和双周期丢帧比例 0 的结论不变。

## 自动验证现状

```text
Unit:        291 passed
Integration: 22 passed（fake Harness、真实 rc.7 dsh、内置 pnpm、双语发布说明、30分钟发布与独立5小时门禁契约、压力/soak 冒烟）
E2E arm64:   3 passed（稳定启动 + 完整 UI 契约 + Harness/顶栏 renderer 独立强制崩溃恢复）
Stress:      100/100 passed（启动、就绪、停止、端口回收）
Companion:   100/100 passed（审核、工作区切换、面板收起/展开状态循环）
Memory:      2500/2500 passed（总 working set 480.2 → 476.9 MiB，无线性增长）
Upgrade:     0.1.0 layout passed（Runtime Home 与 settings 字节保留）
App soak:    60s passed（shell/Harness 每秒探测，5 个进程稳定）
Artifacts:   arm64 DMG + ZIP generated
```

`verify:release` 会检查桌面可执行文件、内置 Node、`pty.node`、`spawn-helper` 和运行时清单的架构一致性，并用包内 Node 实际运行 PTY、sharp 与 koffi 探针；正式发布模式还会逐项验证原生 PTY 签名，并强制验证 Developer ID 签名与 notarization ticket。全新 runner 安装候选和最终 DMG 后，会启动精确的 `/Applications` 产物并等待 Harness 就绪。

## 当前产物

- `out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app`
- `out/make/DeepSeek YukiRyou-0.2.1-beta.1-arm64.dmg`
- `out/make/zip/darwin/arm64/DeepSeek YukiRyou-darwin-arm64-0.2.1-beta.1.zip`

本地产物只适合开发验证，不应直接作为公开下载版本。`v0.2.1-beta.1` 已通过签名、异机安装、30 分钟真实打包应用 soak、Apple 公证、staple 和最终 DMG/ZIP 异机复验并公开发布；已发布标签不可覆盖。

## 已完成的 CI 发布配置

1. 将 Developer ID Application 证书导出为带强密码的 `.p12`，以 Base64 和密码分别写入 GitHub Actions Secrets。
2. 将 App Store Connect API `.p8` 以 Base64 写入 GitHub Actions Secrets，同时配置 Key ID 与 Issuer ID。
3. 通过 `Release macOS` 生成并验收新版本 Draft；通过独立 `Publish verified macOS draft` 工作流公开。

上述 CI Secrets 与发布链已完成实际验证；后续版本继续按 `docs/09-github-and-apple-release.md` 执行，不在本地直接公开产物。

## 尚未完成的非发布项

- Harness 缺少已验证的稳定任务事件接口，因此通知功能按方案延期，不使用 DOM 文本猜测。
- Intel 原生机器上的 x64 E2E；当前用户设备与交付目标为 Apple Silicon。
- Desktop Companion 非宠物阶段与宠物平台 Phase 6A–6C 已完成。Phase 6D 的隔离 Player、客观证据底座与完整角色帧序列候选播放链已落地，但 runtime 尚未冻结；下一步对当前九动作开发预览做侧栏实机与慢放人工验收，修正不自然的完整姿态后再运行 Creator Gate 和 packaged benchmark。Rive 与分层 rig 只保留失败/技术探针，不再向用户索取 `.riv` 或分层工程。任何宠物失败都必须继续与余额、Workspace Review、Harness 和更新隔离。
