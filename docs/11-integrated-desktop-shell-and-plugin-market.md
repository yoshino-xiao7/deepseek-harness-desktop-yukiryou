---
status: accepted
implementation: not-started
updated: 2026-08-21
---

# 一体化桌面框架与插件市场改造方案

## 文档目的

本文定义下一阶段的桌面窗口、原生标题栏、可调整面板和插件市场改造。目标是在不重写 Harness 产品能力的前提下，消除当前外层顶栏与 Harness UI 之间的视觉和布局割裂，并为社区插件提供可发现、可解释、可恢复的管理入口。

本文是目标设计，不表示相关能力已经实现。实施过程中如果固定 Runtime 的正式插槽或插件加载契约与本文假设不符，必须在 Phase 0 停止并更新设计，不得退回 DOM selector、页面文案匹配或任意脚本注入。

## 目标平台与发行范围

目标发行平台是：

- macOS：Apple Silicon arm64 为首要基线，Intel x64 是否提供由发布成本和实际需求另行决定。
- Windows：Windows 11 x64 为首要基线，Windows on Arm 暂不承诺。

macOS 与 Windows 继续共享当前 Legacy 产品布局、插件市场合同和 Runtime 插件实现，只在原生窗口、文件系统、进程、签名、安装包与更新 feed 的真实平台 seam 上使用不同 Adapter。完整 Integrated Desktop Frame 只有在上游提供可占位 composition/drag/theme contract 后才恢复实施；不得用 overlay 冒充占位布局。

新架构可以先在 macOS 完成 Phase 0–3，但移除 legacy 模式和宣布正式可用前，必须同时通过 Windows packaged E2E 与发行门。后续功能默认按双平台定义完成标准；“只在开发者 Mac 上可运行”不再视为完整交付。

## 要解决的问题

### 当前桌面框架

当前产品窗口由两个独立 webContents 组成：

1. `BrowserWindow` 的本地 renderer 绘制固定 44px 顶栏、启动/故障页和 Desktop Companion。
2. `WebContentsView` 从 `y = 44` 开始加载 Harness UI。
3. 主进程通过 `setBounds()` 调整 Harness 区域，并通过 IPC 同步主题、侧栏宽度和 Companion 状态。

这种形态带来以下问题：

- 顶栏是额外占用空间的横条，无法成为 Harness 布局的自然延伸。
- Harness 侧栏、标题区和右侧面板分别由不同 renderer 绘制，颜色、动画和尺寸只能事后同步。
- Companion 展开动画需要主进程逐帧修改 `WebContentsView` bounds，布局状态分散在 main、preload 和 renderer。
- 用户只能拖动窗口，不能直接调整侧栏、Companion 和预览面板宽度。
- 本地 chrome 需要理解 Harness 的侧栏宽度和主题细节，形成浅 Module 和脆弱的跨进程 interface。

### 当前插件体验

Harness 的插件列表同时展示系统插件、依赖插件和用户可变插件，但缺少清晰的来源、所有权和操作能力说明。部分插件显示为停用，却不能从界面启用，容易让用户误认为产品状态损坏。

项目还缺少统一的社区插件发现入口。若直接把远程仓库、安装命令或 package manager 暴露给 renderer，会破坏固定 Runtime、最小权限和可恢复升级原则。

## 设计原则

1. **一个产品窗口只承载一个产品 renderer。** Harness UI、桌面 chrome 和 Companion 在同一个 React/CSS 布局树中组合。
2. **启动恢复与产品界面分离。** Loading/Failure 使用独立、短生命周期的本地窗口，不与产品窗口叠加。
3. **Electron main 不理解产品布局。** main 只负责原生窗口、可信导航、生命周期和受限能力桥。
4. **布局复杂性集中在一个深 Module。** 调用方只提交布局命令、读取布局快照，不计算像素 bounds。
5. **Plugin-first，但不要求 plugin-only。** 产品 UI 与 Harness 业务能力优先使用正式 Host/Client 插件 seam；窗口、文件、进程和更新保留在 Electron 原生 Module。
6. **只使用上游支持的加法型 slot。** 固定 rc.8 明确禁止第三方接管 `root`；`details` 与 `conversation.details.tool` 也都是承载官方 UI 的单占用 Slot。`DesktopFramePlugin` 当前只在 `shell.overlay` 注册不可见健康探针；需要改变根布局时必须先获得上游 composition contract，不能复制或禁用官方 `AppFrame`。
7. **插件目录不授予执行权限。** 远程来源只能提供经过 Schema 校验的展示 metadata。
8. **安装必须由 Host 受管。** renderer 不接收文件系统、shell、环境变量或 package manager 能力。
9. **系统插件与用户插件分层。** UI 必须解释“为什么停用”和“谁可以改变它”，不提供无效按钮。
10. **失败关闭且可恢复。** 框架扩展失败时回到兼容窗口；插件安装失败时恢复已知配置，不阻塞核心 Harness。
11. **产品 Module 跨平台，平台差异收敛到 Adapter。** macOS/Windows 共享状态模型、布局算法和测试语义。
12. **双平台独立签名和独立发布门。** 任一平台失败只阻止该平台资产，不允许把另一个平台未经验证的结果视为替代。

## 目标架构

```text
┌────────────── Electron Main ──────────────┐
│ AppCoordinator                            │
│ ├── RecoveryWindow (Loading / Failure)    │
│ └── DesktopProductCarrier                 │
│     ├── LegacyDesktopProductCarrier       │
│     │   └── local renderer + WebContentsView│
│     └── IntegratedDesktopProductCarrier   │
│         └── ProductWindow                 │
│             ├── Mac/WindowsChromeAdapter  │
│             ├── trusted navigation        │
│             └── one Harness webContents   │
└──────────────────┬────────────────────────┘
                   │ loopback Harness UI
                   v
┌──────────── Harness Runtime ──────────────┐
│ DesktopFramePlugin (Integrated only)      │
│ ├── shell.overlay health probe            │
│ ├── invisible compatibility health probe  │
│ └── official AppFrame remains owner       │
│                                           │
│ Product Host/Client Plugins               │
│ ├── Desktop Companion service             │
│ ├── settings / balance                    │
│ └── additive official slots only          │
│                                           │
│ Community Market Host/Client Module       │
│ ├── catalog sources and adapters          │
│ ├── normalized local index                │
│ ├── plugin inventory and policy           │
│ ├── managed installation                  │
│ └── settings tab / launcher / overlay     │
└───────────────────────────────────────────┘
```

Integrated 模式就绪时，`ProductWindow` 直接加载 Harness origin，不创建或持有 Harness `WebContentsView`。迁移期的 Legacy carrier 仍保留当前本地 renderer + `WebContentsView` 整条窗口路径；它位于 Electron main，不伪装成 Runtime 插件。`RecoveryWindow` 只显示本地静态资源，不加载社区内容，也不持有 Workspace 能力。

`DesktopProductCarrier` 是 Electron main 中唯一知道“legacy 双 webContents / integrated 单 webContents”差异的 Module；`DesktopFramePlugin` 只负责 Integrated 模式的正式加法型 Desktop seam 与健康报告，不拥有 rc.8 根布局。所有业务插件只能依赖正式 Host/Client services 与加法型 slots，不得引用 carrier、Frame implementation、DOM selector 或根布局私有状态。

## 架构决定

### 1. DesktopProductCarrier 隔离窗口载体切换

`DesktopWindow` 拆为 `RecoveryWindow` 与一个 carrier seam：

- `RecoveryWindow`：负责 `starting | failed`，提供重试、日志和诊断导出。
- `LegacyDesktopProductCarrier`：拥有当前本地产品 renderer 与 Harness `WebContentsView`，只用于迁移和紧急回退。
- `IntegratedDesktopProductCarrier`：内部使用 `ProductWindow` 直接加载可信 Harness origin，负责隐藏/恢复、导航策略和 renderer 恢复。

两个窗口在正常流程中不同时可见。Runtime ready 后创建或显示 `ProductWindow`，完成首帧和健康握手后关闭 `RecoveryWindow`；Runtime 失败或产品 renderer 无法恢复时执行反向切换。

```ts
type ProductWindowState =
  | { readonly kind: "hidden" }
  | { readonly kind: "loading"; readonly origin: string }
  | { readonly kind: "ready"; readonly origin: string }
  | { readonly kind: "crashed"; readonly reason: string };

interface DesktopProductCarrier {
  readonly mode: "legacy" | "integrated";
  load(origin: string): Promise<void>;
  reveal(): void;
  reload(): void;
  subscribe(listener: (state: ProductWindowState) => void): () => void;
  dispose(): void;
}
```

Carrier interface 保证：

- `load()` 只接受当前 `RuntimeSupervisor` 已确认的 loopback origin。
- Integrated carrier 只存在一个产品 main frame 和一个 preload，不创建附加 `WebContentsView`；Legacy carrier 如实保留双 webContents，不违反同一 interface。
- Integrated `ready` 需要同时满足 Electron `did-finish-load` 与 Desktop Frame Client 健康报告；Legacy `ready` 使用现有 shell/Harness 双健康契约。
- 外部导航始终交给系统浏览器，非可信 frame 导航失败关闭。
- 本地恢复页面和 Harness 产品页面不共享 preload。

Integrated carrier 的 `ProductWindow` 接受构造期解析出的 `WindowChromeAdapter`，调用方不直接拼接平台窗口参数：

```ts
type DesktopPlatform = "darwin" | "win32";

type WindowChromeDescriptor = {
  readonly platform: DesktopPlatform;
  readonly captionHeight: number;
  readonly leadingSafeWidth: number;
  readonly trailingSafeWidth: number;
  readonly material: "vibrancy" | "mica" | "opaque";
};

interface WindowChromeAdapter {
  createOptions(base: ProductWindowBaseOptions): BrowserWindowConstructorOptions;
  describe(): WindowChromeDescriptor;
  refreshMaterial(window: BrowserWindow, scheme: "light" | "dark"): void;
}
```

这是一个真实 seam：macOS 与 Windows 分别有 production Adapter，测试提供只返回结构化描述的 fake Adapter。平台 Adapter 只能决定 Electron 原生窗口参数与 caption 安全区，不能决定 Sidebar、Companion 或 Preview 的产品布局。

### 2. DesktopFramePlugin 隔离 Runtime 的 Integrated seam

新增 `runtime/desktop-frame-plugin/`，把它定义为版本化的 Integrated 兼容性探针。Phase 0 已实机确认 rc.8 的 `root` 是官方 `AppFrame` 独占的单 Slot：同优先级注册会失败，低优先级覆盖又无法合法复用其 entry-owned 子 Slot，因此本项目不替换 `root`。`details` 与 `conversation.details.tool` 同样不能加法使用。曾用 `shell.overlay` 承载 Workspace Review 的实机原型出现遮挡对话、无法提供自然拖动区、主题不一致和预览功能退化，现已撤回；该插件只保留不可见的版本化健康探针，不再承载产品 UI。

两个回退层必须分开：

- Electron main 通过 `LegacyDesktopProductCarrier | IntegratedDesktopProductCarrier` 切换整条窗口载体。
- Runtime 只有 Integrated 模式加载 `DesktopFramePlugin`；两种模式都保留官方默认 `AppFrame`，Legacy 另外保留现有本地 renderer。

未来官方提供稳定 Electron composition/carrier interface 后，以 `NativeElectronProductCarrier` 替换本地 Integrated carrier；只有上游同时提供受支持的 root composition contract，才重新评估完整 Desktop Frame。业务插件 interface 保持不变。

main 与 Frame 之间只共享一个序列化健康合同，不共享 `activate()` 或 Electron 对象：

```ts
type DesktopFrameCapabilities = {
  readonly integratedChrome: boolean;
  readonly resizablePanels: boolean;
  readonly shellOverlay: boolean;
};

type DesktopFrameHealth = {
  readonly protocolVersion: 1;
  readonly status: "ready" | "incompatible";
  readonly capabilities: DesktopFrameCapabilities;
};
```

业务插件不得根据 carrier 类型分支，只能根据正式 slot/service 是否存在决定是否贡献 UI；缺少 slot 时失败关闭。

目标 DOM 结构：

```text
DesktopFrame
├── CaptionRow
├── SidebarSurface
│   └── Harness sidebar slot
├── ConversationSurface
│   └── Harness conversation slot
├── CompanionSurface
│   └── Workspace Review
├── PreviewSurface
└── OverlaySurface
    └── Harness/desktop overlay slots
```

`DesktopLayout` 隐藏断点、最小宽度、面板互斥、持久化和 resize 手势：

```ts
type DesktopLayoutCommand =
  | { readonly kind: "viewport.resize"; readonly width: number }
  | { readonly kind: "sidebar.toggle" }
  | { readonly kind: "sidebar.resize"; readonly width: number }
  | { readonly kind: "companion.toggle" }
  | { readonly kind: "companion.resize"; readonly width: number }
  | { readonly kind: "preview.open" }
  | { readonly kind: "preview.close" }
  | { readonly kind: "preview.resize"; readonly width: number };

type DesktopLayoutSnapshot = {
  readonly mode: "wide" | "compact" | "review-focus";
  readonly sidebar: { readonly open: boolean; readonly width: number };
  readonly center: { readonly width: number };
  readonly companion: { readonly open: boolean; readonly width: number };
  readonly preview: { readonly open: boolean; readonly width: number };
};

interface DesktopLayout {
  execute(command: DesktopLayoutCommand): DesktopLayoutSnapshot;
  getSnapshot(): DesktopLayoutSnapshot;
  subscribe(listener: () => void): () => void;
}
```

建议初始约束：

| 区域 | 默认 | 最小 | 最大 |
| --- | ---: | ---: | ---: |
| 展开侧栏 | 280px | 264px | 420px |
| Companion | 340px | 300px | 480px |
| Preview | 520px | 360px | 640px |
| 中间会话区 | 自动 | 640px | 不限 |

布局优先保证中间会话区。当空间不足时依次关闭 Preview、折叠侧栏，最后进入 `review-focus`；禁止把会话区挤成不可用宽度。

面板分隔处使用 8px 透明 hit target 和 1px 可见分隔线。Pointer down 后使用 Pointer Capture，移动期间只更新 CSS Grid column，Pointer up 后再持久化最终宽度。不得在 resize 手势中调用 Electron IPC 或 `setBounds()`。

### 3. 原生标题栏与窗口拖动

#### macOS

macOS 产品窗口使用：

```ts
{
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 16, y: 16 },
  transparent: true,
  backgroundColor: "#00000000",
  vibrancy: "sidebar",
  visualEffectState: "followWindow"
}
```

Desktop Frame 使用平台常量，而不是在页面中散落 magic number：

```ts
const MACOS_CAPTION_HEIGHT = 32;
const MACOS_SIDEBAR_CONTENT_INSET = 20;
const MACOS_TRAFFIC_LIGHT_SAFE_WIDTH = 80;
```

#### Windows

Windows 11 产品窗口使用原生 caption buttons overlay，不在 renderer 中重画最小化、最大化和关闭按钮：

```ts
{
  titleBarStyle: "hidden",
  titleBarOverlay: {
    color: "#00000000",
    symbolColor: "#7f858f",
    height: 32
  },
  backgroundColor: "#00000000",
  backgroundMaterial: "mica",
  roundedCorners: true,
  thickFrame: true,
  hasShadow: true,
  autoHideMenuBar: true
}
```

Windows 平台常量：

```ts
const WINDOWS_CAPTION_HEIGHT = 32;
const WINDOWS_CAPTION_CONTROLS_FALLBACK_WIDTH = 138;
```

实际可拖区域优先使用 Window Controls Overlay 暴露的 CSS `env(titlebar-area-x)`、`env(titlebar-area-y)`、`env(titlebar-area-width)` 与 `env(titlebar-area-height)`，不能把 138px 当成 100–200% DPI 下的真实按钮宽度；常量只用于 env 不可用时的保守 fallback。`titleBarOverlay` 不可用、远程桌面关闭材料效果、系统节能或辅助功能策略禁用透明效果时，`WindowsWindowChromeAdapter` 降级为不透明主题背景；布局与命中区域不能依赖 Mica 一定存在。Windows 10 不是首发支持目标，但降级路径不得崩溃或产生不可点击的 caption controls。

拖动区规则：

- Sidebar 顶部仅从交通灯安全区右侧开始拖动。
- Conversation、Companion 和 Preview 顶部的无交互空白可拖动。
- Windows 拖动区必须避开右侧原生最小化、最大化和关闭按钮安全区。
- `button`、`input`、`textarea`、`select`、`a`、resize handle、`[role=button]` 和 modal 全部为 `no-drag`。
- modal 打开时禁用其覆盖范围下方的 drag hit region，避免拖窗抢占点击。
- 拖动 hit region 用伪元素表达，不增加可聚焦或可访问性树节点。
- `prefers-reduced-motion` 下关闭面板宽度动画，但保留 resize 行为。

标题区颜色直接使用 Harness 主题令牌。迁移完成后删除 `appearance-sync` 和 `sidebar-width-sync` 两条跨 webContents 同步通道，因为它们的复杂性已经消失在统一布局内部。

macOS 和 Windows 的 CSS 只根据 `WindowChromeDescriptor` 提供的有限 `data-desktop-platform` 与 CSS variables 变化；Client 不读取 Electron 对象，也不获得通用平台能力。

### 4. Desktop Companion 迁入统一 Frame

`DesktopCompanion`、`WorkspaceInspector` 和 Workspace Authority 的主进程安全规则保持不变；只改变呈现位置和命令 transport：

- Workspace canonical root、Git 和文件读取仍在 Electron main。
- Renderer 只持有不透明 `EntryId`、相对展示路径和有界内容结果。
- Harness Client 通过受限 preload 调用现有 discriminated commands。
- 禁止把任意路径、任意 IPC channel 或文件系统对象暴露给插件代码。

由于 Desktop Frame 与其他 Client 插件共享 renderer，预览内容必须视为对该 renderer 内所有已加载 Client 插件可见。恶意 Client 插件还可能调用该 renderer 已暴露的产品 preload bridge，取得 overview/opaque EntryId 并遍历当前已授权 Workspace；opaque ID 只阻止任意路径输入，不在同一 realm 的插件之间形成权限隔离。启用社区插件后，UI 在首次展示 Workspace Preview 前必须明确说明这一点。Phase 0 若无法从官方 seam 获得不可伪造的 first-party caller isolation，就不得声称 Client 插件受到 DOM、bridge 或 Workspace capability 隔离。

### 5. 插件市场作为 Runtime Module

新增 `runtime/desktop-market-plugin/`，包含 Host 与 Client 两部分。Electron main 不解析目录、不请求 registry、不运行 package manager，也不持有市场状态。

Client 注册以下 surface：

- `settings.plugins.tab`：完整市场与插件管理页。
- `sidebar.footer.action`：市场入口。
- `shell.overlay`：发现、详情与确认弹窗。

若固定 Runtime 缺少某个 surface，Phase 0 必须选择已有正式 seam；不得通过 DOM append 或 selector 挂载核心入口。

#### 目录合同

市场允许多个保存的目录来源，但同一时间只浏览一个已选择来源。标准目录至少包含：

```ts
type CatalogItem = {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly repository?: string;
  readonly package?: {
    readonly name: string;
    readonly version: string;
  };
  readonly categories: readonly string[];
  readonly publisher?: { readonly name: string };
  readonly provenance: {
    readonly sourceId: string;
    readonly providerId: string;
    readonly observedAt: string;
  };
};
```

远程目录响应必须经过版本化 JSON Schema 校验和标准化。Adapter 只映射数据，不能返回 JavaScript、HTML、shell 命令或可执行安装参数。

网络策略：

- 只允许 HTTPS，无用户名、密码、fragment 和非标准端口。
- DNS 解析后拒绝 loopback、私网、link-local、multicast 和其他保留地址；实际 TCP/TLS 连接必须绑定到本次已验证 IP，同时保留原 hostname 做 SNI 与证书校验，禁止在校验后再次自由解析形成 DNS rebinding/TOCTOU。
- redirect 每跳重新解析、校验并绑定目标 IP，最多 3 跳。
- 单响应最大 2 MiB，连接、首字节和总请求分别设置超时。
- 图片由 Host 校验和代理；renderer 不直接请求任意远程图片。
- 完整索引最多 10,000 条，分页和重复 ID fail closed。
- 搜索、分类和 UI 分页基于本地标准化索引；默认缓存 5 分钟，用户刷新绕过缓存。

#### 插件状态模型

插件列表必须区分所有权，而不是只显示“启用/停用”：

```ts
type PluginInventoryItem = {
  readonly id: string;
  readonly displayName: string;
  readonly ownership: "system" | "managed" | "external";
  readonly state: "active" | "disabled" | "unavailable" | "incompatible";
  readonly mutable: boolean;
  readonly reason?:
    | "host-policy"
    | "dependency-only"
    | "missing-capability"
    | "version-conflict"
    | "startup-recovery";
  readonly allowedActions: readonly (
    | "enable"
    | "disable"
    | "update"
    | "uninstall"
  )[];
};
```

UI 规则：

- 系统插件可以展示，但始终只读，并显示用途与停用原因。
- 依赖插件标记为“由系统管理”，不显示无效的启用按钮。
- 市场受管插件只有 receipt 与本地状态匹配时才允许卸载。
- 外部插件可以在加载清单允许时启用/停用，但市场永远不声称拥有卸载权。
- 所有状态变化都提示“重启后生效”或明确的即时生效语义。

插件的 capability/权限标签只做信息披露，不是执行时权限沙箱。Cordis `inject`、Client slot 与目录 metadata 都不会阻止恶意包直接使用它能够导入的 Node、浏览器或进程内能力。安装确认必须明确：Host 插件与 Harness 位于同一 Node 进程并以当前 OS 用户权限执行；Client 插件与 Harness UI 共享 renderer，可读取该 renderer 中可见的数据、调用页面可用的桌面桥并遍历当前授权 Workspace。首版不得使用“已隔离”“最小权限运行”或“经过安全审核”等措辞。

#### 受管安装

第一版受管安装只接受 npm registry 上的精确稳定版本。拒绝 Git URL、branch、commit、release archive、tag、版本范围和 prerelease。

安装 preview 由 Host 完成以下复核：

1. 目录 package 身份、repository 与 registry metadata 一致。
2. 版本是精确稳定 SemVer，且没有 deprecated 标记。
3. 解析完整 transitive dependency graph；根包和任一依赖都不包含 `preinstall`、`install`、`postinstall` 或 `prepare`。
4. Node、Harness/Cordis 和当前平台兼容。
5. tarball 为官方 HTTPS 地址并提供合法 SHA-512 integrity。
6. package 声明合法 DSH bundle，安装后路径仍位于 package 内。
7. 当前 App Version、Runtime Version、profile generation 和 blocklist 没有变化。
8. 把每个依赖的 name、精确 version、tarball URL、SHA-512 integrity、platform metadata 和 lifecycle scripts 归一化为不可变安装图，并生成 frozen lock；`previewId` 必须绑定该图和所有 tarball 字节，不能在 execute 阶段重新解析版本范围。

execute 只消费 preview 阶段已校验并缓存的内容寻址 tarball，使用 frozen lock、offline 模式与 `--ignore-scripts` 安装。若缓存缺失、integrity 改变或依赖图与 preview 不一致，必须要求重新 preview；不能回退为在线重新解析。包含原生模块的插件还必须验证目标 `os/arch/libc` 和 tarball 内已有的预编译 artifact；任何依赖安装脚本下载或构建原生代码的包首版直接拒绝。首发只允许与当前发行匹配的 `darwin-arm64` 或 `win32-x64` 目标，不在用户机器上临时下载编译工具链或执行源码构建。

`ManagedPluginInstaller` 在 preview 前应用硬预算：依赖节点最多 256 个，单个 tarball 压缩体积最多 32 MiB、全图压缩体积最多 128 MiB，解包后总计最多 512 MiB/20,000 个常规文件，依赖深度最多 16，归一化相对路径最多 240 UTF-8 bytes。下载和解包必须流式计数并在写盘前检查剩余磁盘预算；内容寻址缓存设总配额，只能 LRU 删除没有 receipt/preview 引用的对象。registry metadata 与 tarball fetch 继承目录网络策略：DNS pin、每跳 redirect 重验、连接/首字节/总超时、响应上限和 TLS hostname 校验均不可绕过。

tar 解包在新建的不可执行 staging 根中完成，只接受 canonical package 前缀下的常规文件和目录；拒绝绝对路径、`..`、重复/大小写碰撞路径、NUL、超长路径、device/FIFO/socket、symlink 与 hardlink。每个 entry 打开与最终 rename 都重新验证 containment；任何预算或结构违规删除 staging、释放 preview 引用并失败关闭。hostile archive corpus、压缩炸弹、超长路径和 DNS/redirect 竞态属于 Phase 3 阻塞测试。

Renderer 只提交 `{ sourceRecordId, itemId }` 获取短时、一次性的 `previewId`，再提交 `previewId` 执行。它不能选择 package manager、cwd、argv、环境变量或目标路径。

npm SHA-512 integrity 只证明下载字节与 registry metadata 一致，不证明发布者身份、代码安全或官方背书。目录中的 publisher/repository 字段是来源声明，UI 必须与已验证事实分开显示；若未来引入 Sigstore、registry provenance 或独立签名策略，应作为额外验证层和版本化 policy 交付，不能提前写成当前保证。

#### 安装位置与恢复

不得修改 `.app` 内的只读 bundled Runtime。用户插件安装到 Runtime Home 中专用的 mutable profile extension：

```text
~/Library/Application Support/<ProductName>/runtime/
├── bundled-links/                 # 指向当前 App Version 的只读运行时
├── user-plugins/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── pnpm-workspace.yaml
│   └── node_modules/
└── plugin-management/
    ├── receipts.json
    ├── load-state.json
    └── recovery/
```

安装前仅对固定白名单配置文件建立原子快照；成功后记录 package、版本、integrity、bundle、来源和 profile generation receipt。下一次启动只有在 Host 和 Renderer 都报告健康后才提交安装。如果启动失败或超时：

- 在未知第三方修改不存在时恢复白名单配置。
- 将本次插件加入临时禁用集合。
- 最多自动重启一次。
- 保存本地诊断，但不上传、不记录凭据和远程响应正文。
- `node_modules` 不承诺事务回滚；恢复语义必须在 UI 和文档中准确说明。

恢复不能依赖可能导致崩溃的 Market Host 自救。必须随包提供 `PluginProfileBootstrap`：它在任何用户插件加载前运行，且只接受 `prepare(generation)`、`commit(generation)`、`recover(generation, reason)` 三类类型化命令。Electron main 只持有不透明 generation 与全局启动重试预算，不解析目录、package、receipt 或 load-state；实际快照/禁用集合仍由 bootstrap 在 Runtime Home 内管理。Installer 在重启前先写原子 pending generation；AppCoordinator 只有同时收到 Runtime Host 和 Product Renderer 健康报告才调用 commit。若 Runtime 在 Market Host 建立 route 前退出或超时，AppCoordinator 调用 recover 后最多完整重启一次，该次数与全局 Runtime recovery 共用同一个预算，不能形成嵌套无限重试。Phase 0 必须验证 bootstrap 的加载顺序先于全部 user plugin；固定 Runtime 无法保证该顺序时，安装功能保持关闭。

## Module 与 seam

| Module | Interface 所在 seam | 隐藏的实现复杂性 |
| --- | --- | --- |
| `RecoveryWindow` | `AppCoordinator -> RecoveryWindow` | 本地 renderer、诊断动作、恢复窗口生命周期 |
| `DesktopProductCarrier` | `AppCoordinator -> DesktopProductCarrier` | legacy/integrated 选择、双/单 webContents 生命周期与兼容回退 |
| `ProductWindow` | `IntegratedDesktopProductCarrier -> ProductWindow` | BrowserWindow、可信导航、renderer 健康、原生 chrome |
| `DesktopFramePlugin` | Harness `shell.overlay` + 序列化健康合同 | 不可见健康探针、teardown 与兼容性报告；当前不承载产品 UI |
| `DesktopLayout` | 官方 seam 可表达的桌面 surface 内部 | 面板状态、断点、拖动与宽度持久化；不接管 rc.8 root |
| `DesktopCompanion` | Client command/snapshot | 面板状态、Workspace 请求、预览和取消 |
| `Catalog` | Market Host route | 来源、Schema、Adapter、网络限制、缓存和索引 |
| `PluginInventory` | Market Host route | 系统/受管/外部所有权、状态原因、允许动作 |
| `ManagedPluginInstaller` | preview/execute | registry 复核、package manager、receipt、恢复和启动验证 |
| `PluginProfileBootstrap` | AppCoordinator opaque generation commands | 用户插件加载前的 pending/commit/recover、安全模式与单次重试协调 |

目录网络和 npm registry 是 true external 依赖，分别通过受限 HTTP Adapter 接入并使用 mock Adapter 测试。文件系统、package manager 和配置存储是 local-substitutable 依赖，使用临时 Runtime Home 做集成测试。`DesktopLayout` 是纯 in-process Module，不对外暴露 Adapter。

## 官方对齐与长期迁移方向

当前固定 Runtime 仍由桌面应用启动本地 Web Profile。该模式是可交付的兼容层，不定义永久 transport。长期按以下优先级演进：

1. 新业务 UI 使用准确、加法型 slot；注册前验证 slot purpose、scope、kind、owner props 和当前 occupant。
2. 跨插件协作只使用 Cordis service、Host/Client protocol 和序列化 store，不导入其他插件 implementation。
3. 操作系统能力只通过窄、判别联合类型 preload bridge 暴露；禁止通用 IPC、任意 channel、路径或 argv。
4. Electron 载体切换只存在于 `DesktopProductCarrier`，Runtime 的 Integrated 加法型装配只存在于 `DesktopFramePlugin`；两者不得混成一个跨进程 Adapter，也不得扩散到业务插件。
5. 官方提供稳定 Electron Client composition 与 IPC carrier 后，新增 `NativeElectronProductCarrier` 并逐步替换本地 Web Profile transport。
6. 官方没有所需 seam 时，优先提交通用上游能力；无法等待时才使用版本锁定、可撤回的兼容 Adapter。
7. DOM selector、MutationObserver 页面猜测和编译 bundle 字符串修改只允许作为带删除条件的临时补丁，不得成为新功能的默认实现。

正式依据：

- [DeepSeek Harness Client 插件与 slot 规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)
- [DeepSeek Harness Web Client 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)
- [DeepSeek Harness GUI 分层与 Electron carrier 方向](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)

## 目标代码布局

```text
src/
├── main/
│   ├── window/
│   │   ├── desktop-product-carrier.ts
│   │   ├── legacy-desktop-product-carrier.ts
│   │   ├── integrated-desktop-product-carrier.ts
│   │   ├── product-window.ts
│   │   ├── product-window-options.ts
│   │   ├── mac-window-chrome-adapter.ts
│   │   ├── windows-window-chrome-adapter.ts
│   │   └── recovery-window.ts
│   └── workspace/                  # 保留现有 Workspace 安全实现
├── preload/
│   ├── product.ts
│   └── recovery.ts
└── shared/
    ├── desktop-frame.ts
    └── workspace-review.ts

runtime/
├── desktop-frame-plugin/
│   ├── index.js
│   ├── client.js
│   └── package.json
├── desktop-companion-plugin/
├── desktop-market-plugin/
│   ├── index.js
│   ├── client.js
│   ├── package.json
│   ├── contracts/
│   ├── catalog/
│   ├── inventory/
│   └── install/
└── desktop-extensions.patch.yml

src/renderer/                         # 仅 RecoveryWindow
```

首轮实现可以继续使用当前随 Runtime 装配的 JavaScript 插件格式，不强制引入新的生产构建系统。市场实现增长到难以维护前，应将 Runtime 插件源码迁入独立 TypeScript workspace，再由 vendoring 流程编译进固定 Runtime；不得长期维护超大手写 bundle。

## 双平台 Runtime 与数据路径

Runtime manifest 必须按平台和架构记录独立的 Node、Harness、pnpm 与原生模块闭包，不能让 macOS 构建产物进入 Windows 包，也不能复用未经平台验证的 install 结果。

```text
macOS
~/Library/Application Support/<ProductName>/
└── runtime/...

Windows
%APPDATA%\<ProductName>\
└── runtime\...
```

路径只由 Electron `app.getPath("userData")` 和 Node `path` Module 解析。文档中的分隔符仅作说明，implementation 不手工拼接 `/` 或 `\\`。Workspace containment、symlink/junction、大小写、长路径和 UNC 规则分别通过平台 Adapter 与真实文件系统测试验证。

进程关闭同样按平台实现：macOS 使用已拥有的进程组语义；Windows 使用受所有权记录约束的 process tree/job object Adapter。禁止按进程名进行全局清理。

## 双平台打包、签名与更新

### macOS 发行

- 产物：签名并公证的 DMG 与 ZIP。
- 签名：Developer ID Application。
- 公证：Apple notary service，最终产物验证 ticket、Gatekeeper 和 quarantine 安装。
- 更新 feed 与资产名显式包含 `darwin-arm64`。

### Windows 发行

- 产物：首发固定使用 Electron Forge `@electron-forge/maker-squirrel`，发布 `Setup.exe`、`-full.nupkg` 和 `RELEASES`；便携 ZIP 仅供诊断，不进入自动更新 feed。
- 生命周期：main 入口在 `app.ready` 前处理 Squirrel install/update/uninstall/obsolete 事件，事件处理期间不启动 Harness Runtime。
- 签名：使用组织持有的 Windows Authenticode 代码签名证书；私钥只存在于 CI Secret 或受管签名服务。
- 安装验证：全新 Windows 11 VM 验证安装、覆盖升级、卸载、用户数据保留、开始菜单入口和实际启动。
- 安全验证：检查 Authenticode、SmartScreen 下载链路、安装包 hash、可执行文件和原生 `.node` 架构。
- 更新 feed 与资产名显式包含 `win32-x64`，不得与 macOS 共用模糊资产名。

推荐发布拓扑：

```text
version tag
├── macOS build -> sign -> remote verify -> notarize -> final verify
├── Windows build -> sign -> clean-VM install/upgrade/launch verify
└── release manifest
    ├── commit
    ├── App/Runtime version
    ├── platform + arch
    ├── asset SHA-256
    └── verification receipt
```

同一版本的两条流水线可以并行，但每个资产必须携带自己的验证回执。默认在所有计划资产通过后统一公开 Release；若需要单平台延迟，Release notes 必须明确该平台状态，更新 feed 不能向该平台返回缺失或未验证资产。

## 分阶段实施

### Phase 0：契约验证与可回退原型

- 为固定 rc.8 Runtime 增加 root ownership、sidebar、conversation、overlay 和 settings plugins slots 契约测试。
- 查询并固定每个 slot 的 purpose、kind、scope、owner props、当前 occupant 与子 slot；禁止靠名称猜测。
- 用最小 `DesktopFramePlugin` 验证可用的官方 seam；若 `root` 不支持第三方 composition，则记录红灯并收敛到真正加法型的 `shell.overlay`，不得复制官方布局或占用 `details`。
- 验证设置和余额等 Runtime 业务插件在 Legacy/Integrated 两个 carrier 下都只依赖加法型 slots/services；Companion 的 command/snapshot 合同保持一致，但呈现分别由 legacy 本地 renderer 与 integrated Frame surface 承载。
- 验证产品窗口直接加载 Harness 时 preload、CSP、可信导航和更新桥仍可工作。
- 建立 `MacWindowChromeAdapter` 与 `WindowsWindowChromeAdapter` options 契约测试。
- 在 Windows CI 建立可编译的 Adapter/窗口命中区 prototype 与 Runtime 装配 fixture；这一阶段不承诺完整 Windows 安装包。
- 增加环境开关 `DSH_DESKTOP_CARRIER_MODE=legacy|integrated`，默认保持 `legacy`；Integrated 还必须同时设置内部 `DSH_DESKTOP_INTEGRATED_PROTOTYPE=1`，避免误进入不具备产品适配能力的传输原型。

退出门：所有必需 seam 都有稳定测试证据；否则先缩小功能或更新设计。

#### Phase 0 当前进度（2026-08-21）

已完成第一组不会改变默认产品载体的契约收口：

- 已从固定 rc.8 的 `CLIENT_SLOT_API` 目录提取并锁定 `root`、`sidebar`、`conversation`、`details`、`shell.overlay`、`settings.section` 及桌面业务插件实际使用的 slot 元数据；单占用替换 seam 与加法型 seam 分开测试。
- 已建立只在 Integrated patch 装配的 `DesktopFramePlugin` 最小原型。真实打包运行证明 rc.8 不支持第三方合法替换 `root`，原型已收敛为 `shell.overlay` 健康贡献，保留官方 `AppFrame` 和全部后代 Slot。
- 已用 JavaScript AST 检查当前 Settings、余额与 Companion Client 插件，确保它们只注册 `replaceRisk: none` 的加法型 slot。
- 已建立 `MacWindowChromeAdapter`、`WindowsWindowChromeAdapter` 与不透明材料降级的 options/descriptor 契约；Windows caption controls 的 138px 仅作为 CSS env 不可用时的 fallback。
- 已建立双重保护：空值默认 `legacy`，未知值失败关闭，单独请求 `integrated` 仍回到 Legacy；只有附加内部 prototype 标志才运行打包 E2E。
- 已建立版本化 `DesktopFrameHealth` 序列化合同与 ProductWindow readiness 状态机：Legacy 只等待产品文档完成，Integrated 必须同时收到文档完成和 Frame 健康报告，事件顺序不影响结果，不兼容与跨导航旧信号失败关闭。
- 已把 Harness 的 preload、`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 与 `webSecurity: true` 收敛到所有 Product carrier 共用的安全 Module；现有 Legacy `WebContentsView` 已改为消费该 Interface。
- 已把产品 webContents 的可信导航、HTTPS 外开、权限/下载拒绝、更新命令与状态重放、余额请求竞态、Harness Context 限流去重、Review intent 和 Frame health 收敛到 `HarnessProductBridge` 深 Module；Legacy 与 Integrated 共用该 Module。
- 固定 Runtime 已同时携带但隔离两份装配 patch：Legacy 只加载 Settings/Companion，Integrated 才额外加载 Frame prototype；`runtime:verify` 强制检查 Legacy 不含 Frame、Integrated 必须含 Frame，保证回退只需切换载体而不是改写安装内容。

Integrated 传输原型已完成直接加载 Harness 的 `ProductWindow`、独立 `RecoveryWindow`、共用 Product bridge 与 Frame 健康门。真实 macOS 评审确认它缺少产品所需的占位侧栏、自然拖动区和主题 contract，`shell.overlay` Workspace Review 已撤回。该路径只允许双开关内部 E2E，默认和单开关请求都使用 Legacy；上游 seam 未补齐前不得继续迁移产品 UI或作为生产默认路径。

### Phase 1：ProductWindow 与 RecoveryWindow

- 从 `DesktopWindow` 提取 `ProductWindow` 和 `RecoveryWindow`。
- 实现 Integrated carrier 的 ProductWindow 直接加载 Harness；只从 integrated 路径移除 `WebContentsView`。
- 保留完整 `LegacyDesktopProductCarrier` 作为同一版本内的紧急回退。
- 建立 renderer 健康握手与窗口切换测试。

退出门：macOS 打包应用的 Integrated 模式只存在一个产品 webContents，Legacy 模式仍可完整回退，Loading/Failure 在两种 carrier 下都能独立恢复；Windows Adapter/窗口 prototype 在 CI 通过类型、DPI 命中区和 Runtime fixture 合同。Windows 完整 packaged E2E 是 Phase 6 与删除 legacy 的硬门。

### Phase 2：等待上游 composition seam（暂停）

- 向上游推动可占位 root/frame、原生 drag/no-drag 与主题 token contract；这些 seam 缺失时不在 Integrated 路径呈现 Workspace Review。
- 迁移侧栏与 Companion toggle。
- 增加 sidebar、Companion 和 Preview resize handles。
- 持久化最终面板宽度，验证窄窗、全屏、深浅主题和 reduced motion。
- 在 macOS 打包应用验证 traffic lights/vibrancy；Windows 先在 CI 窗口 prototype 验证 caption overlay、DPI 命中区与不透明降级，Phase 6 再执行完整 packaged E2E。

退出门：顶栏不再额外占用 44px；窗口可从所有规定空白区拖动；交互控件不触发拖窗。

### Phase 3：Companion 呈现迁移与旧链路删除

- 将 Companion/Preview renderer 迁入 Desktop Frame。
- 保留 `WorkspaceInspector`、Authority 和只读能力限制。
- 删除 `harnessContentBounds()` 的逐帧动画、`appearance-sync`、`sidebar-width-sync` 和旧 toolbar DOM。
- 删除被新 Module interface 覆盖的旧浅层测试，改由 ProductWindow/DesktopLayout interface 测试替代。

退出门：main 不再计算产品面板像素；renderer 内部完成所有响应式布局。

### Phase 4：只读插件市场

- 实现版本化目录合同、受限 HTTP、来源存储、完整本地索引和媒体代理。
- 实现发现、详情、来源和已安装 inventory。
- 首版不执行安装；明确显示系统、受管和外部所有权及停用原因。

退出门：断网、无来源、恶意响应、超限响应和失效缓存均有明确且安全的 UI 状态。

### Phase 5：受管安装、启停、卸载与恢复

- 实现 npm preview/execute、receipt、profile mutation 串行化和 blocklist。
- 实现用户插件加载清单及启用/停用。
- 实现启动健康验证、配置恢复、单次自动重启和安全模式。
- 将在线安装标为实验能力，完成至少一个 beta 周期后再默认开放。

退出门：任何失败路径都不能修改 bundled Runtime，不能执行目录命令，不能进入无限重启。

### Phase 6：移除 legacy 模式

- 完成升级、长期运行、renderer crash、Runtime crash 和恶意插件 fixture 验证。
- 完成 Windows 11 x64 的安装、签名、升级、卸载、自动更新和 packaged soak 流水线。
- 将 `isUpdaterSupported()` 扩展为显式支持 `darwin-arm64 | win32-x64`，并分别验证 feed URL 与资产选择。
- Forge 配置按平台选择 `.icns`/`.ico`、DMG/ZIP/Squirrel maker 和签名参数，macOS 专用 `extendInfo` 不进入 Windows 包。
- 删除 `LegacyDesktopProductCarrier`、其 `WebContentsView` 产品路径和环境开关。
- 同步架构、安全、开发、测试、当前状态和发布说明。

## 测试与验收

### 桌面框架

- `ProductWindow` options 验证 hidden inset、透明背景、traffic light 坐标和安全 webPreferences。
- packaged E2E 断言 Harness 主 frame 从产品窗口原点布局，不存在 44px 外层 toolbar。
- 验证 CaptionRow/Sidebar 空白区是 `drag`，所有交互控件和 resize handle 是 `no-drag`。
- 在 820、1024、1440、1920px 宽度验证布局模式和中心最小宽度。
- 连续 resize 2,500 次后无 IPC 增长、listener 泄漏或显著内存增长。
- 深色、浅色、跟随系统、全屏和 reduced motion 均通过截图基线。
- Product renderer crash 后可以恢复当前 Runtime；无法恢复时显示 RecoveryWindow。
- Windows caption buttons 在 100%、125%、150% 和 200% 缩放下均可点击，拖动区不覆盖按钮。
- macOS/Windows 多显示器、全屏/最大化、睡眠恢复和 DPI 改变后布局重新收敛。

### 插件市场

- Schema corpus 覆盖缺字段、额外执行字段、重复 ID、分页循环和超限索引。
- 网络测试覆盖 DNS rebinding、私网 IP、redirect、超时、超大 body 和恶意图片。
- install preview 覆盖版本范围、prerelease、deprecated、lifecycle script、错误仓库、错误 integrity 和越界 bundle。
- 并发安装只允许一个 mutation；过期或重复 `previewId` 必须拒绝。
- receipt 不匹配时拒绝卸载；外部插件不得被市场接管。
- 启动失败 fixture 验证配置恢复、临时禁用、诊断生成和最多一次自动重启。
- App 升级验证用户插件状态保留，但不兼容插件自动进入 `incompatible`，不得阻塞核心 Runtime。
- 同一插件在 `darwin-arm64` 与 `win32-x64` 分别验证兼容 metadata；平台不匹配时不得进入 install preview。

### 发行矩阵

| 维度 | macOS | Windows |
| --- | --- | --- |
| 首发架构 | arm64 | x64 |
| 最低系统 | macOS 14 | Windows 11 |
| 安装 | DMG、ZIP | Squirrel Setup.exe、诊断 ZIP |
| 原生 chrome | hiddenInset、traffic lights、vibrancy | titleBarOverlay、caption buttons、Mica/opaque |
| 签名 | Developer ID + notarization | Authenticode |
| 必测升级 | 上一公开版本覆盖安装 | 上一公开版本安装包升级 |
| 必测显示 | Retina、外接屏、全屏 | 100–200% DPI、多显示器、最大化 |
| Runtime | darwin-arm64 独立闭包 | win32-x64 独立闭包 |

## 完成标准

只有同时满足以下条件，改造才算完成：

1. 产品主窗口只有一个 Harness renderer，不再组合外层 toolbar 与 Harness `WebContentsView`。
2. 标题区与 Harness 主题、侧栏和内容面连续，无固定 44px 视觉断层。
3. 窗口拖动、侧栏/Companion/Preview 调宽和响应式降级均可用且无点击冲突。
4. Electron main 不再同步 Harness 主题色或侧栏像素宽度。
5. 插件列表能解释每个停用项的所有权、原因和可执行动作。
6. 社区目录数据不能直接触发命令、脚本或 package manager。
7. 用户插件永不修改 bundled Runtime，安装和首次启动失败存在有界恢复路径。
8. legacy 路径删除前，集成模式至少经过一个完整 beta 周期和 packaged soak 验证。
9. 同一 Desktop Frame 与市场 Client 在 macOS、Windows 不分叉；平台差异只存在于已列出的 Adapter。
10. macOS 与 Windows 都具备签名、干净机器安装、升级、启动和更新验证回执。
11. `DesktopProductCarrier` 是唯一理解 Electron 载体切换的 main Module，`DesktopFramePlugin` 是唯一理解 Integrated 加法型装配的 Runtime Module；固定 rc.8 的 root 始终归官方 `AppFrame` 所有。
12. 运行时代码不新增 DOM selector、页面 MutationObserver 或编译 bundle 字符串补丁。

## 明确不做

- 不复制或重写 Harness 的会话、Agent、模型、设置和工具详情 UI。
- 不让插件市场、余额、Workspace Review 或 Agent 扩展依赖某一种 carrier 或 Frame implementation。
- 不通过 Git URL、仓库分支、release archive 或远程 shell 命令安装插件。
- 不把插件市场描述为安全审核或官方背书；目录收录只表示可发现。
- 不声称社区插件运行在安全沙箱中；安装后它仍是用户信任的本地代码。
- 不为美观牺牲恢复窗口、可信导航、Workspace containment 或 Runtime 原子升级规则。
- 不在首发 Windows 版本承诺 Windows 10、Windows on Arm、Microsoft Store 或企业 MSI 部署。

## 官方技术依据

- [Electron BrowserWindow：title bar overlay、background material 与窗口参数](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Forge Squirrel.Windows maker](https://js.electronforge.io/modules/_electron_forge_maker_squirrel.html)
- [Electron Forge Windows 代码签名](https://www.electronforge.io/guides/code-signing/code-signing-windows)
- [Electron Forge TypeScript maker 配置](https://www.electronforge.io/config/typescript-configuration)

## 文档影响

本方案获批并进入 Phase 1 后，需要同步修订：

- `02-architecture.md`：以 RecoveryWindow、DesktopProductCarrier 与 Integrated Desktop Frame 的分层替换双 webContents 产品架构。
- `03-security.md`：补充 Client 插件共享 renderer、目录网络、受管安装和启动恢复信任模型。
- `04-testing-and-release.md`：增加一体化框架、目录与插件恢复发布门。
- `09-github-and-apple-release.md`：保留 macOS 专项规则；新增独立 Windows 发布规则文档和双平台 Release 编排说明。
- `07-current-status.md`：按阶段记录实际交付能力。
- `08-appearance-extension.md`：迁移完成后删除跨 webContents chrome 颜色同步合同。
- `10-desktop-companion-plan.md`：将“Companion 由本地 Shell renderer 承载”标记为被本方案替代，保留 Workspace Authority 和只读安全设计。

在 Phase 1 开始前，现有文档继续描述当前实现；不得提前把目标设计写成已完成事实。
