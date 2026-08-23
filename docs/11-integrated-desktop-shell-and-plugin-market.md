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

Client 只注册一个产品入口：

- `settings.plugins.tab`：完整市场与插件管理页。

市场内部由同一个页面 Module 承载“发现、可安装、已安装、来源”四个视图，并在该 Module 内打开详情、安装预览、确认和结果弹窗。不得再增加侧栏入口、独立页面、`shell.overlay` 入口或 DOM selector 挂载点。入口视觉继续遵循本产品的设置结构，其他市场能力按下述统一合同实现。

#### 完成功能合同

1. **发现**：展示当前来源的完整标准化索引，支持搜索、多分类筛选、排序、分页和详情；详情显示说明、发布者声明、源码仓库、来源、读取时间与明确的信任提示。
2. **可安装**：只展示 Host 从完整索引中 fail closed 生成的结构候选。候选必须具有规范 repository、精确稳定 npm identity 和可验证的来源证据；卡片本身不表示已经通过 npm 或代码安全审核。
3. **已安装**：把官方 Runtime inventory、Market receipt 和当前 direct bundle 状态合并为统一只读快照。只有合法 receipt 仍匹配的受管插件允许卸载；可变 direct bundle 只能在 Loader 合同允许时启用或停用。
4. **来源**：允许用户添加、选择、排序和移除符合版本化目录合同的来源；同一时间只浏览一个来源，不存在静默 fallback、隐式推荐或跨来源混排。
5. **详情与操作**：点击任何卡片打开同一个详情弹窗；Host preview 成功后才转入精确安装确认，失败时保留为只读详情并解释不可安装原因。
6. **安装结果**：受管修改串行执行，成功后明确提供“稍后重启”和“立即重启”；失败不得留下被声明为已安装的 receipt。

功能对齐只约束用户可观察行为与状态语义，不复制外部实现。目录、registry、profile、恢复和 renderer 权限仍必须经过本项目自己的 Module Interface 与测试门。

#### 融合原则

- **吸收成熟的产品体验**：四视图、完整本地索引、多来源管理、统一详情弹窗、安装资格解释、已安装所有权、精确确认和重启引导都作为完成态能力。
- **保留本产品入口与视觉**：市场只存在于“设置 → 插件”，复用当前主题 token、长名称收缩、深浅主题和中英文文案，不增加第二套导航结构。
- **保留更严格的执行边界**：renderer 永远不能提交 package manager、命令、cwd、环境变量或目标路径；Host 也不执行目录命令，只消费经过标准化的 identity。
- **保留固定 Runtime 与不可变发行物**：任何用户插件都不能修改 `.app` 或 bundled Runtime，只能进入专用 mutable profile extension。
- **保留可验证安装图**：preview 固定完整依赖图、tarball integrity 和内容字节；execute 不重新在线解析版本，也不允许运行 lifecycle script。
- **保留有界恢复**：receipt、配置快照、启动健康门、临时禁用和最多一次自动重启必须先于公开安装能力完成。
- **跨平台共用合同**：目录、inventory、receipt 和恢复状态机在 macOS 与 Windows 共用；只有窗口、路径、进程 shim、签名和安装包通过平台 Adapter 分离。
- **分阶段开放**：先交付只读完整市场，再开放 preview，最后才开放受管 mutation；任何阶段未通过恶意响应、崩溃恢复和升级测试都不得提前显示可操作按钮。

#### 目录合同

市场允许多个由用户拥有并保存的目录来源，但同一时间只浏览一个已选择来源。固定 GitHub topic 实现降级为一个内置 Adapter，不再是绕过来源选择的特殊市场后端。标准目录至少包含：

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

自定义来源首版采用单响应 JSON v1：顶层只接受 `schemaVersion: 1`、非空 `revision` 和最多 10,000 条 `items`；每项必须具备稳定 ID、名称、简介、规范 GitHub repository、发布者声明和有界分类，可选 `icon` 必须是无凭据、无自定义端口、无 fragment 的 HTTPS URL。来源提供的 package、命令、脚本、HTML 或其他扩展字段均不进入标准快照，自定义来源项目固定为 `browse-only / custom-source-unverified`；`icon` 原始 URL 也只留在 Host 内部快照，Client 只能取得媒体代理生成的不透明同源引用。来源记录最多 20 个，只保存规范化 HTTPS URL、显示名、启用态和顺序；内置来源不进入可变记录，因此不能被停用或删除。

网络策略：

- 只允许 HTTPS，无用户名、密码、fragment 和非标准端口。
- DNS 解析后拒绝 loopback、私网、link-local、multicast 和其他保留地址；固定 GitHub Adapter 可兼容 macOS TUN 代理使用的 `198.18.0.0/15` synthetic address，但 host、443 端口、路径、SNI 和证书校验必须全部保持编译期固定。实际 TCP/TLS 连接绑定到本次已验证 IP，禁止在校验后再次自由解析形成 DNS rebinding/TOCTOU。
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
3. 解析完整 transitive dependency graph；根包和任一依赖都不包含 registry 安装会执行的 `preinstall`、`install` 或 `postinstall`。`prepare` 只在打包、本地/link 或非 registry 来源等语境执行；首版已拒绝这些来源，不能把 registry metadata 中的 `prepare` 误报成 consumer install script。
4. Node、Harness/Cordis 和当前平台兼容。
5. tarball 为官方 HTTPS 地址并提供合法 SHA-512 integrity。
6. package 声明合法 DSH bundle，安装后路径仍位于 package 内。
7. 当前 App Version、Runtime Version、profile generation 和 blocklist 没有变化。
8. 把每个依赖的 name、精确 version、tarball URL、SHA-512 integrity、platform metadata 和 lifecycle scripts 归一化为不可变安装图，并生成 frozen lock；`previewId` 必须绑定该图和所有 tarball 字节，不能在 execute 阶段重新解析版本范围。

当前下版本分支已落地上述第 1 至 6 项以及第 8 项的冻结部分。`DependencyGraphResolver` Module 通过窄 Interface 固定稳定 SemVer、递归验证全图并生成绑定 `platform/arch/Node` 的确定性图 hash；`RuntimeSnapshot` Adapter 从 production lock 只提取顶层 package identity，Peer 检查会拒绝必需包缺失、版本不满足或提供者歧义，并允许显式 optional Peer 缺失。图兼容后，`ArtifactVerifier` Module 才会通过固定 registry Adapter 读取全部实际 tarball，复核 SHA-512、归档结构和真实 `package.json`，拒绝链接、路径穿越、重复路径、包内生命周期脚本、依赖声明漂移、package 自带 `node_modules` 和缺失 bundle，并写入 Runtime Home 内容寻址缓存；frozen lock 绑定 graph hash、依赖链接、全部内容 digest 与实际归档体积。真实 `@bocha-ai/dsh-web-search-bocha@0.1.0` 已完成 4 个包体/47 个文件验证。Renderer 只看到计数、graph/lock hash 与有界公开冲突原因，不接收 URL、缓存路径、原始 lock 或 staging plan。

独立 `ManagedPluginInstaller` Module 已提供窄 `stage({ generation, plan })` Interface：它不联网、不调用 package manager、不执行 lifecycle script，也不切换当前 profile；只从已验证内容缓存逐包重新核对 SHA-512、package identity、依赖声明和体积预算，在隔离目录中构建 `.store/<node>/node_modules/<package>` 多版本布局，按 frozen graph 建立受控依赖链接，再以同文件系统 rename 原子发布不可变 generation。缓存缺失、plan 漂移、路径冲突或写盘失败都会清空临时 staging，已发布且 lock 相同的 generation 可幂等复用，冲突 generation 失败关闭。

预检会把来源、精确 package identity、bundle、integrity、graph hash 与 lock hash 绑定成确定性的 opaque profile generation。Runtime Host 的 `ManagedPreviewVault` 私藏 frozen plan，只通过每次 Runtime 启动轮换且恒定时间比较的 token RPC 向 Electron main 发行短时一次性 capability；main 的 `RuntimeMarketClient` 对响应大小和 schema 失败关闭，`ManagedInstallTransaction` 只保存该 capability，并在首次写盘前消费自己的 token，顺序固定为远程 `stage -> PluginProfileBootstrap.prepare`。过期、重放、generation 不匹配和并发 mutation 均失败关闭，plan 从不进入 renderer 或 main。安装图同时冻结 package 的真实 peer 声明、provider、精确版本和 Runtime snapshot hash；installer 把 graph Peer 链接到 generation 内精确节点，只把 Runtime Peer 链接到 bundled `node_modules` 中名称/版本匹配且 realpath 未逃逸的包。

`PluginProfileBootstrap` Module 在 Electron 启动 Harness 之前提供原子 `prepare/commit/recover`、receipt、临时 blocklist、未知编辑拒绝和中断恢复。它按 receipt 的 generation 从 `user-plugins/generations/<generation>/node_modules` 解析 bundle；AppCoordinator 先运行进程外 Bootstrap，再只把 receipt 授权、未被 blocklist 禁用且 realpath 仍位于对应 generation 内的 bundle 作为最后一组 `--patch` 传给 Runtime。受限 preload/IPC 的 Interface 只允许 Renderer 提交目录 identity 和一次性 previewId，main 负责 Runtime token 认证、限流、摘要投影、系统原生确认和单事务互斥；用户确认后会再次检查预览期限与 Runtime 身份，成功装配才安排试运行重启。Renderer 永远拿不到 staging Interface 或可复用的执行凭据。公开 Runtime inspection 的 `executionReady` 继续为 `false`，内部 Bootstrap 的 `mutationReady` 已为 `true`；这一区分保证网页不能绕开 main 原生确认门，同时让受管事务可以落地。

execute 只消费 preview 阶段已校验并缓存的内容寻址 tarball，使用 frozen lock、offline 模式与 `--ignore-scripts` 安装。若缓存缺失、integrity 改变或依赖图与 preview 不一致，必须要求重新 preview；不能回退为在线重新解析。包含原生模块的插件还必须验证目标 `os/arch/libc` 和 tarball 内已有的预编译 artifact；任何依赖安装脚本下载或构建原生代码的包首版直接拒绝。首发只允许与当前发行匹配的 `darwin-arm64` 或 `win32-x64` 目标，不在用户机器上临时下载编译工具链或执行源码构建。

受管安装链应用硬预算：依赖节点最多 256 个，单个 tarball 压缩体积最多 32 MiB、全图压缩体积最多 128 MiB，解包后总计最多 512 MiB/20,000 个常规文件，依赖深度最多 16，归一化相对路径最多 240 UTF-8 bytes。verifier 会先在内存中有界解包并写入内容寻址缓存，staging 再按冻结的压缩、tar、文件和内容体积逐项复核。`ArtifactCache` Module 现在提供 512 MiB 硬配额、256 MiB 剩余磁盘保留、串行 cache mutation、读取时完整性复核与 LRU touch；只删除没有 verifier lease、有效 preview、pending 或 receipt 引用的对象，引用文件损坏和 digest 形状异常均停止回收。registry metadata 与 tarball fetch 继承目录网络策略：DNS pin、每跳 redirect 重验、连接/首字节/总超时、响应上限和 TLS hostname 校验均不可绕过。

tar 解包在新建的 staging 根中完成，只接受 canonical package 前缀下的常规文件和目录；拒绝绝对路径、`..`、重复/大小写碰撞路径、NUL、超长路径、device/FIFO/socket、symlink、hardlink 与 package 自带 `node_modules`。生成目录和父路径拒绝 symlink；文件以受限 mode 和 `wx` 写入，依赖链接只由冻结图生成，最终通过同文件系统 rename 原子发布。任何预算或结构违规都会删除 staging 并失败关闭。公开 execute 前仍需补齐 preview 引用释放、磁盘余量与 Windows junction 的真实平台验收。

Renderer 只提交 `{ sourceRecordId, itemId }` 获取短时、一次性的 `previewId`，再提交 `previewId` 执行。它不能选择 package manager、cwd、argv、环境变量或目标路径。

npm SHA-512 integrity 只证明下载字节与 registry metadata 一致，不证明发布者身份、代码安全或官方背书。目录中的 publisher/repository 字段是来源声明，UI 必须与已验证事实分开显示；若未来引入 Sigstore、registry provenance 或独立签名策略，应作为额外验证层和版本化 policy 交付，不能提前写成当前保证。

受管版本更新不得建立独立更新器。首次安装、同版本重装和版本更新共用 `ManagedPreviewVault -> ManagedInstallTransaction -> PluginProfileBootstrap`；更新 preview 绑定当前 receipt 的 package/version/generation，执行前若 receipt 漂移则失败关闭。更新试运行失败时只 blocklist 失败的新 generation，恢复快照中的旧 receipt，并在下一次 launch plan 中重新加载旧稳定 generation；不得按 package 名把旧版本一并禁用。

Legacy 产品文档导航采用“复位残留导航 + 15 秒单次超时 + 最多一次同源重试”的有界策略。每次尝试前先 `stop()` 并导航到 `about:blank`，再加载同一可信 origin，避免第二次尝试复用已经悬挂的同 URL 导航。主文档完成事件或对应 `loadURL()` 正常完成都可结束当次等待；产品 `WebContents` 显式关闭 `backgroundThrottling`，保证隐藏视图在冷启动阶段仍能推进导航与 Agent Runtime。第一次超时不能直接把已经 ready 的 Runtime 误报为 `spawn-failed`；第二次仍不完成时才进入恢复链，因而不会重新引入无限等待。

#### 安装位置与恢复

不得修改 `.app` 内的只读 bundled Runtime。用户插件安装到 Runtime Home 中专用的 mutable profile extension：

```text
~/Library/Application Support/<ProductName>/runtime/
├── bundled-links/                 # 指向当前 App Version 的只读运行时
├── user-plugins/
│   ├── .staging/                   # 失败时清理的同盘临时目录
│   └── generations/
│       └── gen-<sha256>/
│           ├── .dsh-generation.json
│           └── node_modules/       # root link + .store 多版本依赖布局
└── plugin-management/
    ├── receipts.json
    ├── blocklist.json
    ├── load-state.json
    └── recovery/
```

安装前仅对固定白名单配置文件建立原子快照；成功后记录 package、版本、integrity、bundle、来源和 profile generation receipt。下一次启动只有在 Host 和 Renderer 都报告健康后才提交安装。如果启动失败或超时：

- 在未知第三方修改不存在时恢复白名单配置。
- 将本次插件加入临时禁用集合。
- 最多自动重启一次。
- 保存本地诊断，但不上传、不记录凭据和远程响应正文。
- `node_modules` 不承诺事务回滚；恢复语义必须在 UI 和文档中准确说明。

恢复不能依赖可能导致崩溃的 Market Host 自救。`PluginProfileBootstrap` 已实现为 Electron main 中独立于 Harness 的前置 Module：它只操作 Runtime Home 下固定、版本化、限制大小且拒绝 symlink 的 `plugin-management` 状态文件，并提供安装 `prepare`、精确 `prepareRemoval`/`prepareEnabled`/`prepareRollback`、`commit`、`recover` 和只读 inventory。安装 prepare 会自行重算并核对绑定 bundle/graph/lock 的 generation；卸载、启停与回滚 prepare 则冻结当前 receipt 集合与目标 package/version/generation。所有动作都会在原子发布带 `install | remove | set-enabled | rollback` 类型的 pending 前保留 recovery snapshot。`prepareRuntimeLaunch` 只允许 pending 从 `prepared` 原子进入一次 `trial-launched`：安装将候选加入 launch plan，卸载或停用安全移除 Bootstrap 自有 profile 链接并排除目标，启用则恢复链接并加入目标，回滚则只切换到上一已验证 generation。`commit` 只接受已经试启动且 receipt 状态未漂移的事务；`recover` 只接受事务前或事务自身可推导的中间状态，遇到未知编辑失败关闭。正常升级只保留一个上一已验证版本；成功回滚会消费该回滚点，失败或中断恢复当前版本、receipt 与 profile 链接。安装失败恢复 receipt 并临时 blocklist 候选；卸载和启停失败恢复 receipt、启用状态与 profile 链接，且不 blocklist 原有健康插件。用户重新完成核验并确认安装，或明确启用、回滚已停用/阻断的 receipt generation 时，可发起一次受控重试：试运行期间临时解除阻断，失败恢复旧 blocklist，成功才永久清除。每次启动由 Bootstrap 从 receipt、`enabled` 与 blocklist 生成窄 launch plan，逐个 realpath 验证 bundle 未逃逸受管 `node_modules`，然后 AppCoordinator 才把这些路径作为桌面 overlay 之后的最终 `--patch` 启动 Runtime。rc.8 同组条目并发启动，所以这里明确不依赖插件配置行顺序。Runtime Host 的受保护 Companion route ready 与 Product Renderer 的文档/Frame health 均完成后，AppCoordinator 才 commit；任一失败会 recover 并消费同一个全局恢复预算，随后完整重启。Legacy carrier 对产品文档导航另设 15 秒超时：新建空白视图直接加载；Runtime 重启且旧文档仍在时，首次加载前以及超时重试前都会 `stop()` 并导航到 `about:blank`，被中止旧导航产生的预期 `ERR_ABORTED` 不会误判为失败。若进程在标记 trial 后直接中断，下一次 `prepareRuntimeLaunch` 会先恢复而不会再次加载未确认的配置。receipt 受管安装、启用、停用、上一版本回滚和卸载入口均已闭环。

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
| `ManagedPluginInstaller` | `stage(generation, frozenPlan)` | 缓存复核、安全解包、多版本依赖布局、失败清理和 generation 原子发布 |
| `ManagedPreviewVault` | authenticated Host RPC | frozen plan 私藏、短时 staging capability、过期/重放防护 |
| `ManagedInstallTransaction` | `issue(stagingCapability)` / `execute(previewId)` | main 侧一次性 token、远程 staging Adapter 与 mutation 串行化 |
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
│   ├── artifact-verifier.js
│   ├── managed-installer.js
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

## 双平台打包与发行

### macOS 发行

- 产物：签名并公证的 DMG 与 ZIP。
- 签名：Developer ID Application。
- 公证：Apple notary service，最终产物验证 ticket、Gatekeeper 和 quarantine 安装。
- 更新 feed 与资产名显式包含 `darwin-arm64`。

### Windows 发行

- 产物：同一 GitHub Release 公开版本化的向导式 NSIS `Setup.exe` 与便携 ZIP；不再生成或依赖 Squirrel `-full.nupkg`/`RELEASES`。
- 生命周期：NSIS 安装器按当前用户安装并允许修改目录；CI 以指定隔离目录验证安装、修复和卸载，主应用入口无需处理 Squirrel 启动事件。
- 签名：早期 Beta 不接入 Authenticode；Release Notes 必须明确未签名和 SmartScreen 风险，并提供独立 SHA-256。用户规模需要时再把签名作为附加发行门，不追溯覆盖旧资产。
- 安装验证：全新 Windows runner 验证 EXE 首装、同版本修复、卸载、用户数据保留、开始菜单入口和实际启动；便携 ZIP 解压后也必须从精确产物启动并恢复会话。
- 安全验证：检查来源 commit、安装包/ZIP hash、可执行文件和原生 `.node` 架构；未签名状态不得被描述为 Windows 信任背书。
- 自动更新不作为首个未签名 Beta 的承诺；资产名显式包含 `win32-x64`，不得与 macOS 共用模糊名称。

推荐发布拓扑：

```text
version tag
├── macOS build -> sign -> remote verify -> notarize -> final verify
├── Windows build -> EXE + portable ZIP -> clean-runner lifecycle/launch verify
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
- 插件管理 Phase 0 已开始复用 rc.8 官方 `pluginInventory.list()` 只读快照，并通过加法型 `settings.plugins.tab` 提供来源、状态和不可操作原因说明。该阶段所有动作集合保持为空：不联网、不安装、不修改 Loader；系统/依赖标签只表示部署来源，不宣称安全隔离。
- 只读目录已建立独立 `DesktopMarketPlugin` Module：Host 通过 `Catalog.read({ sourceId, refresh })` 隐藏来源扫描、固定数据版本、schema 标准化、5 分钟内存缓存、24 小时持久缓存和同源并发请求合并。`CatalogSnapshotStore` Adapter 只在受信任的 Runtime Home 固定子目录读写枚举来源，使用同目录临时文件原子替换；载入快照按白名单 schema 重建而不信任磁盘 JSON，损坏、错源、未来时间、符号链接或超限文件均失败关闭。完整来源必须遍历全部分页后一次性发布索引；来源报告总数、规范化索引数和完整性状态分别保留。只能返回有限窗口的来源明确标为 `truncated`，不得产生可安装候选。Client 通过同一官方设置 Slot 提供四视图、搜索、分类、分页、详情、来源选择及缓存新鲜度提示。目录没有 mutation 接口或可执行字段，并已在真实 TUN 网络、深色主题与长名称列表中完成开发版冒烟。

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
- 在唯一设置入口内实现发现、可安装、已安装、来源四视图及统一详情弹窗；Phase 4 的可安装仅展示结构资格与不可安装原因，不执行 profile mutation。
- 首版不执行安装；明确显示系统、受管和外部所有权及停用原因。

当前增量：四视图、统一详情、三种内置来源、完整分页索引、固定 provider revision、完整性/截断状态、结构化可安装候选、搜索/分类/分页、刷新/仓库跳转、installed inventory 说明、Host 持久化索引、失效缓存显式降级，以及自定义来源的添加/排序/停用/移除和原子恢复均已完成。媒体代理也已落地：目录中的远程图片 URL 只保存在 Host 快照中，Client 只收到不透明同源引用；Host 对每次跳转重新执行 DNS/IP 策略，限制响应类型与体积，再用 sharp 限制像素并重编码为无元数据 WebP。dshfind 与 1024Store 当前没有图片字段，因此继续使用文字占位；GitHub Topic 头像和自定义 JSON v1 的可选 `icon` 字段走代理。

退出门：断网、无来源、恶意响应、超限响应和失效缓存均有明确且安全的 UI 状态。

### Phase 5：受管安装、启停、卸载与恢复

- 把 Phase 4 的结构候选接入 npm preview/execute、精确确认、receipt、profile mutation 串行化和 blocklist。
- 实现用户插件加载清单及 fail-closed 启用/停用；receipt 拥有的插件与外部 direct bundle 保持不同所有权语义。
- 实现启动健康验证、配置恢复、单次自动重启和安全模式。
- 将在线安装标为实验能力，完成至少一个 beta 周期后再默认开放。

当前增量：安全预检已经贯通根包 metadata、完整传递依赖图、Runtime Peer 和真实 tarball。Renderer 只能提交 `{ sourceRecordId, itemId }`，Host 从已验证目录快照重新取得精确 identity；`DependencyGraphResolver`、`RuntimeSnapshot` 和 `ArtifactVerifier` 三个 Module 依次冻结版本、Peer provider、Runtime snapshot、包体与真实 `package.json`，然后写入内容寻址缓存并生成 frozen lock hash。`ManagedPluginInstaller.stage()` 已能从该缓存离线、无脚本地构建多版本隔离依赖布局，按冻结 provider 链接 graph/Runtime Peer，失败清理临时目录并原子发布不可变 generation。Host `ManagedPreviewVault`、token 认证 RPC、main `RuntimeMarketClient` 和 `ManagedInstallTransaction` 已贯通内部 transport 与 `stage -> prepare` 次序；无 token 的真实 rc.8 请求已验证返回 403，过期、重放、candidate 替换、并发和失败重试语义均有测试。AppCoordinator 已在每次 Runtime ready 后重新绑定 token、origin 和本地一次性 preview capability；产品 preload 提供受限预览、执行、只读 inventory 与精确启停、回滚、卸载方法，产品桥限制请求速率和共享 mutation 并发，main 再把 inspection 与 profile 状态投影成固定白名单摘要。精确原生确认后才允许 staging 与 Bootstrap prepare；开发版重启 Runtime，正式包重启应用。`ArtifactCache` 已用硬配额、磁盘余量、LRU 和 verifier/preview/pending/receipt（含上一验证版本）引用完成回收 seam，staging 返回的 cache digest 会经 main 严格校验后进入 Bootstrap 状态。独立 `PluginProfileBootstrap` 已实现原子 pending、receipt、blocklist、generation-scoped 受管 launch plan、只能消费一次的试启动和启动前恢复；pending 现区分 `install | remove | set-enabled | rollback`。`ManagedPluginRemoval`、`ManagedPluginActivation` 与 `ManagedPluginRollback` 仅接受当前 receipt 的精确 package/version/generation；升级保留一个上一健康 generation，回滚直接复用已核验包体并在成功后消费回滚点。卸载与停用试启动会移除 Bootstrap 自有 profile 链接并生成不含目标插件的新 launch plan，启用或回滚则恢复对应链接，双健康后才提交 receipt 变化，失败或中断恢复 receipt、启用状态、链接和原配置。包体与 generation 不在交互中直接删除，而由引用感知的缓存回收处理。显式安装、启用或回滚重试可在事务内临时解除 blocklist，并保留失败恢复语义。AppCoordinator 在启动 Runtime 前完成所有状态读取与 realpath containment 校验，把允许的 bundle 作为最终 `--patch`，并只在 Host 与 Product Renderer 双健康后 commit。Legacy 产品导航用主文档完成事件或对应 `loadURL()` 正常完成收敛；失败重试会先用 `about:blank` 真正复位空白或陈旧的 WebContentsView，隐藏视图关闭后台节流，再进入同一恢复链。公开 Host inspection 的 `executionReady` 继续固定为 `false`，页面不能绕过 main 直接执行 profile mutation。已安装页把 rc.8 Runtime inventory 与校验后的 receipt/blocklist 摘要合并，精确区分系统、依赖、受管和外部插件，并显示受管版本、格式化时间、实际加载状态、上一可回滚版本与自动恢复记录；只有 receipt 所有者提供启用/停用、上一版本回滚和安全卸载。

真实失败演练已经通过：开发目录提供健康基线 `@dsh-desktop/development-install-fixture@1.0.3` 和顶层立即抛错的更新候选 `1.0.4-failure.1`，二者走与社区包相同的目录身份、安全预检、包体缓存、原生确认、staging、Bootstrap 与重启链。失败候选让真实 Harness Loader 在 ready 前退出后，Host 恢复基线 receipt/profile、以 `runtime-unhealthy` 阻断失败 generation，并只执行一次恢复重启；随后 Runtime 与产品文档均恢复健康，已安装页显示基线版本和自动恢复记录。开发 adapter 按来源边界路由全部 fixture identity，正式 vendor/verify 策略仍保证测试 fixture 不进入发行包。

退出门：任何失败路径都不能修改 bundled Runtime，不能执行目录命令，不能进入无限重启。

### Phase 6：移除 legacy 模式

- 完成升级、长期运行、renderer crash、Runtime crash 和恶意插件 fixture 验证。
- 完成 Windows 11 x64 的安装 EXE、便携 ZIP、卸载和 packaged smoke 流水线；跨版本升级与自动更新作为后续门禁，Authenticode 按实际分发规模接入。
- 将 `isUpdaterSupported()` 扩展为显式支持 `darwin-arm64 | win32-x64`，并分别验证 feed URL 与资产选择。
- Forge 配置按平台选择 `.icns`/`.ico`、DMG/ZIP 和签名参数；Windows 安装 EXE 由 electron-builder 从 Forge 的同一预打包目录生成，macOS 专用 `extendInfo` 不进入 Windows 包。
- 删除 `LegacyDesktopProductCarrier`、其 `WebContentsView` 产品路径和环境开关。
- 同步架构、安全、开发、测试、当前状态和发布说明。

当前增量：发行壳的 Windows seam 已建立。Forge 的图标基址不带扩展名，由 Electron Packager 针对 macOS/Windows 分别解析 `.icns`/`.ico`；Windows ZIP Maker 生成便携包，electron-builder NSIS 从同一预打包目录生成允许选择安装位置的向导式 EXE，DMG 继续只属于 macOS。Windows 使用稳定的 `com.yukiryou.deepseek.yukiryou` AppUserModelID 与 `DeepSeek YukiRyou.exe`。更新器目标白名单为 `darwin-arm64 | win32-x64`：macOS 保持签名更新链，Windows 读取 GitHub 正式 Release 并提供安装 EXE 下载入口。Linux、macOS x64、Windows arm64 和开发态仍关闭。七尺寸 Windows ICO 由现有品牌 PNG 通过仓库脚本生成；Packager 对目标目录使用覆盖语义。

Runtime 门禁现已完成代码侧扩展。schema 2 manifest 用 `darwin-arm64 | darwin-x64 | win32-x64` 完整 target 绑定 Node 归档和 SHA-256，不再让同一个 `x64` 键含糊代表宿主平台。`RuntimePlatformLayout` 统一提供 Node executable、npm CLI、PATH 根、node-pty prebuild/native files 和 PTY smoke command；应用启动也从该合同解析 Windows 的 `node/node.exe`。vendor 强制目标平台等于执行主机，Windows runner 使用锁定 Node ZIP、`npm_config_os=win32` 与 `npm_config_cpu=x64` 进行真实原生依赖装配，保留 ConPTY 所需的两个 `.node`、DLL 与 OpenConsole，裁剪其他平台及 PDB。verify 在 Windows 读取 PE header 确认 x64，并用目标 Node 实际加载 DSH、pnpm、node-pty、Sharp 和 Koffi；Darwin 的 lipo、spawn-helper execute bit 和 zsh smoke 保持原样。macOS arm64 与 Windows x64 都由各自宿主验证，跨主机装配会在网络和写盘前失败关闭。

Windows CI 候选门禁现已落地为可复用工作流。它在 `windows-latest` x64 runner 上先执行 lint、typecheck、完整单元与集成测试，再由干净 job 执行 host-native Runtime vendor/verify，并同时生成 NSIS EXE 与便携 ZIP；随后分别从打包目录和解压后的精确 ZIP 启动/重启应用。候选冻结器要求唯一品牌 `Setup.exe` 和精确版本 portable ZIP，并生成带 package version、`win32-x64` target、Git commit、逐文件字节数和 SHA-256 的 manifest。普通 PR 只上传短期候选；桌面发行工作流复用同一门禁，把版本化 EXE、便携 ZIP 和独立 SHA-256 清单加入与 macOS 相同的 Draft Release。

冻结候选之后，CI 还会运行真实 NSIS 生命周期门禁：以 `/S /D=<隔离目录>` 执行 `Setup.exe`，从实际安装路径启动应用并复跑会话恢复测试，然后执行同版本修复安装、再次启动和静默卸载。状态文件只允许指向工作区内的隔离安装目录，恢复步骤不会清理任意系统安装位置。这个门禁刻意把当前能力称为“修复安装”而非“覆盖升级”；跨版本升级和独立 Windows 11 客户端验收继续作为后续质量工作，不阻塞明确标注未签名的早期 Beta。

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
| 安装 | DMG、ZIP | 向导式 NSIS Setup.exe、便携 ZIP |
| 原生 chrome | hiddenInset、traffic lights、vibrancy | titleBarOverlay、caption buttons、Mica/opaque |
| 签名 | Developer ID + notarization | 早期 Beta 未签名并披露；后续可选 Authenticode |
| 必测升级 | 上一公开版本覆盖安装 | 首版验证同版本修复；跨版本升级后续补齐 |
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
10. macOS 具备签名、公证、升级、启动和更新验证回执；Windows 未签名 Beta 具备来源/hash、EXE 生命周期和便携 ZIP 启动回执，并明确披露尚未完成的跨版本更新边界。
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
- [electron-builder NSIS configuration](https://www.electron.build/nsis.html)
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
