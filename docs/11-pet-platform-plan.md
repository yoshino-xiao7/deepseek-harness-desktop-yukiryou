---
status: accepted
implementation: phase-6d-in-progress
updated: 2026-08-20
animation-runtime: pending-spike
package-format: draft
---

# 宠物平台完整实现方案

## 文档定位

本文是 Desktop Companion 宠物能力的权威设计，细化 [`10-desktop-companion-plan.md`](10-desktop-companion-plan.md) 的 Phase 6，并定义 Phase 7 宠物制作 Skill。产品需求和安全边界已经接受；Phase 6A–6C 已实现，Phase 6D 正在修正为 creator-first 选型。动画运行时、最终包格式和官方宠物视觉素材仍未冻结，现有 Rive 代码只代表隔离 Player 的技术探针，不代表产品选型。

本文把宠物视为一个可扩展的**声明式资产平台**，而不是写死在 renderer 里的单个动画。首版仍只交付一只官方宠物和一个 production player，但设置、导入、校验、持久化和运行时接口从第一天就按“内置资产 + 用户资产”设计。

## 已确认的产品决定

1. 设置弹窗新增“宠物”页面，展示项目内置和用户导入的宠物资产；用户可以启用、切换、导入和移除自己的宠物。
2. 用户可自定义角色形象及每个语义动作的视觉设计，但宠物包不能执行代码、改变应用状态机、访问 Workspace 或发起网络请求。
3. 宠物活动区位于 Companion 右栏顶部，文件变更区位于其下方并占据剩余空间。
4. Companion 可见时有最小宽度；拖到最小宽度后继续向右无效，不会顺势关闭。完全隐藏只由右上角开关或等价键盘命令触发。
5. 右栏右边缘固定，用户从左边界向左拖动可放大，向右拖动可缩小到最小值。
6. 动画必须按时间连续采样并具有完整状态过渡；拒绝只轮播少量关键姿势造成的跳帧、闪变和“纸片切换”效果。
7. 普通用户的制作 Interface 固定为“角色参考图 + 自然语言动作要求”。更多视角和分层素材可以提高质量，但不能强制用户学习动画编辑器、骨骼绑定、状态机、代码、引擎命名或付费导出流程。
8. 第一版只维护一个正式动画运行时。候选必须先证明项目维护的自动化制作流程能从上述 Creator Input 产出可导入样片，再进入 packaged Apple Silicon 性能与画质比较；依赖手工专有编辑器导出的候选直接淘汰。
9. Phase 6D 形成唯一 runtime 与包格式 release candidate，Phase 6E 使用同一受支持制作流程完成官方宠物并达到产品满意度后才冻结 v1；不得为了赶进度同时长期维护多套 player。
10. Phase 7 把 Phase 6D 已验证的 Authoring PoC 产品化为 Pet Authoring Skill；不能等格式冻结后才第一次验证用户是否做得出来。
11. 宠物能力失败时只隐藏宠物活动区或回退内置宠物，不影响 Workspace Review、Harness、账户余额或更新。
12. 用户制作宠物不得要求配置 DeepSeek 之外的 Runway、OpenAI 或其他模型供应商 Key，也不得要求另开计费账号；额外第三方凭据是一票否决项。项目内部研究探针不等于产品制作能力。

## 术语与边界

**Pet Library（宠物资产库）**：应用自有目录中的内置宠物和已安装用户宠物集合。它不在 Runtime Home 或 Workspace 中。

**Pet Package（宠物包）**：扩展名为 `.yukipet` 的声明式本地资产包。它包含清单、缩略图和唯一受支持动画运行时的资产，不是插件，也不能携带脚本。

**Built-in Pet（内置宠物）**：随签名应用交付、不可删除的官方宠物。

**Imported Pet（导入宠物）**：用户通过系统文件选择器显式导入、经校验后原子安装的宠物包。

**Active Pet（当前宠物）**：Pet Library 中被选中并允许在 Pet Stage 渲染的唯一宠物。

**Pet Stage（宠物活动区）**：Companion 右栏顶部、具有固定坐标系和裁剪边界的宠物展示区域。

**Semantic Motion（语义动作）**：应用状态机能够请求的动作含义，例如 `standing`、`sleeping` 或 `eating`。用户可以自定义动作如何呈现，但不能改变这些动作何时由应用触发。

**Creator Input（创作者输入）**：用户提供的角色参考图和自然语言动作要求。更多视角、表情或分层素材只是可选质量增强项。

**Supported Authoring Workflow（受支持制作流程）**：项目维护的自动化 Module，从 Creator Input 生成、验证并打包 Pet Package。动画生成、转码、状态映射、命名和 QA 都隐藏在它的 Interface 后面。

**Pet Authoring Skill（宠物制作 Skill）**：受支持制作流程面向 Codex 的交互入口，输出 `.yukipet`、预览和 QA 报告。它不在应用运行时执行，也不要求用户接触动画引擎。

本文避免“无关键帧动画”这一说法。骨骼或矢量动画仍可能由作者设置关键帧；真正的要求是**展示帧连续插值、动作内部连续、状态之间有完整过渡**。

## 目标与非目标

### 目标

- 设置中存在清晰、可管理的宠物资产库。
- 用户不需要修改应用代码或学习专业动画工具，即可从角色参考图和自然语言要求制作并导入自己的宠物。
- 宠物行为只消费 Harness 的受控活动快照，不读取对话正文、Key、文件内容或系统级输入。
- Pet Stage 与文件区共用同一 Companion，但尺寸、裁剪、焦点和完全隐藏语义明确。
- 官方宠物在正常刷新率下具有呼吸、眨眼、重心变化和次级运动，状态切换没有可见跳形。
- 宠物包作为不可信输入进行校验、隔离和原子安装。
- 动画 runtime 代码和 WASM 只能随签名应用固定交付；宠物包只带经选定 Adapter 深度校验的声明式资产，全部离线使用且不依赖 CDN。
- 将引擎细节隐藏在单一 `PetPlayer` Module 内，为测试和未来格式迁移保留 seam。
- 将制作引擎细节隐藏在单一 `PetAuthoring` Module 内；Creator Input 与 `.yukipet` 是稳定 Interface，Rive、Lottie、视频或自有格式只能是内部实现。

### 第一版非目标

- 不允许宠物包携带 JavaScript、HTML、CSS、WebAssembly、runtime binary、shader、原生模块或任意可执行逻辑。
- 不允许宠物包访问 Workspace、Runtime Home、剪贴板、麦克风、摄像头或网络。
- 不提供宠物市场、远程下载、自动更新宠物或在线账号同步。
- 不允许用户定义新的应用状态、工具调用或自动化；只能为受支持的语义动作提供视觉实现。
- 不提供多宠物同时运行、跨窗口漫游、越出 Pet Stage 或系统桌面宠物。
- 不保证只有一张低分辨率图片时也能达到官方角色同等质量；流程可以请求用户追加参考图，但不能要求其自行完成骨骼绑定、状态机或专有编辑器导出。
- 不把 Pet Package 当成 Harness 插件，也不改变固定 Harness Runtime 的交付规则。

## 需求覆盖

| 用户需求 | 设计落点 | 验收证据 |
| --- | --- | --- |
| 设置新增宠物资产 | `Pet Library` 设置页 + 受限 `PetLibraryBridge` | 内置、导入、选择、移除、错误状态 E2E |
| 用户可制作自己的宠物/动作 | Creator Input → Supported Authoring Workflow → `.yukipet` | 非动画专业用户可完成的端到端 PoC、golden packages、导入 round-trip |
| 右栏有最小可见宽度 | `preferredWidth` 与 `open` 分离的纯布局状态 | min clamp、继续右拖不关闭、重开恢复测试 |
| 右上按钮仍可完全隐藏 | 独立 `panel.toggle/close` 命令 | 0 宽关闭、Harness 全宽、焦点恢复 E2E |
| 动作流畅且有生命力 | 连续动画技术验证 + `PetPlayer` + 视觉/性能门 | 真机 frame-time、慢放、状态过渡和 identity QA |
| 后续制作 Skill | Phase 7 产品化 6D 已验证的 Authoring PoC | Skill 只询问角色图与自然语言，输出包、预览与 QA 报告并可直接导入 |

## 当前代码基线与差异

截至 2026-08-20，Phase 6A–6C 与 Phase 6D 的通用技术底座已经落地：

- shared 契约、app-owned Pet Library、受限 Harness bridge、开发 Inbox 和静态资产链路已经实现；未知动画 payload 不会被直接安装为 ready 宠物。
- Companion 已将 `open` 与 `preferredWidth` 分离，支持 340px 最小可见宽度、左边界拖拽、宽度恢复和独立完全隐藏；Pet Stage 已与文件区共存。
- 专用 PetPlayer 隔离、一次性 MessagePort、外部 watchdog、frame-time 指标、trial recorder、fail-closed benchmark contract 和隔离 runtime validator 已形成。
- 现有 Rive Canvas Lite Adapter 只验证 Player 隔离、离线 WASM 和资源生命周期，不代表 production runtime 已选定，也不构成用户制作流程。

当前真正缺口不是再建设一套 Player 外壳，而是先完成 Creator Input 到可导入宠物包的 Authoring PoC，再让通过 Creator Gate 的候选进入 packaged benchmark。后续实现不得退回“让用户提供引擎文件”或“只加一张宠物图片”的路径。

## 架构

```text
Harness Runtime / UI
├── official Session store -> activity snapshot
└── settings.section -> Pet Library settings view
          |
          | metadata and bounded commands only
          v
Desktop Shell main process
├── PetLibrary
│   ├── PetPackageImporter
│   ├── PetPackageValidator
│   └── PetStore
├── PetRecoveryGuard            # main-owned deadline/crash-loop guard
├── DesktopCompanion layout
└── activity projection
          |
          | opaque pet id + validated bytes + semantic activity
          v
Local shell renderer
├── PetDirector
└── PetStageHost              # reserves bounds, DOM bubble, input

Dedicated PetPlayer WebContentsView
└── PetPlayer                 # exactly one production adapter
```

职责必须保持分离：

- `PetLibrary` 决定有哪些宠物、当前选择和安装状态，不了解动画帧。
- `PetPackageValidator` 处理不可信文件和格式兼容性，不了解 Harness Session。
- `PetDirector` 把活动事实、计时器和用户唤醒转换为语义动作，不了解引擎 clip、artboard 或文件路径。
- `PetPlayer` 把语义动作翻译为所选引擎的播放和过渡，不决定业务状态；它运行在专用、无父 DOM、无 Workspace bridge 的隔离 `WebContentsView`。该 view 只加载随签名应用交付的单用途 bootstrap preload，用于一次性转交 MessagePort，不向页面暴露 Electron/Node API。
- `PetStageHost` 只负责可视布局、气泡、输入和无障碍，不读取磁盘，也不直接解析用户动画。
- `DesktopWindow` 的纯布局函数决定 Harness、Preview 与 Companion bounds；renderer 不能直接移动 `WebContentsView`。
- production 默认使用独立的 sandboxed `WebContentsView` 和专用非持久 session/partition；它只加载随签名 App 交付的精确 player entry 与 `pet-player-bootstrap` preload，不与 shell 或 Harness 共用 DOM、业务 preload、session 或 renderer process。bootstrap 只在 isolated world 监听一个固定初始化 channel，严格校验有界的 `{ protocolVersion, realmEpoch, nonce }` 初始化 envelope 和恰好一个 port 后，通过 DOM `window.postMessage` 一次性转交给签名 player entry，随即移除监听；不使用 `contextBridge`，不暴露 `ipcRenderer`、Node、文件、网络、环境变量或任意方法。main 把该 view 的 bounds clamp 在 `PetStageHost` 预留矩形内；可信气泡和输入条位于不被 player view 覆盖的 shell 区域。
- main 只向 player main frame 交付一个有界 `MessagePort`：输入为签名 runtime bytes、已验证 pet bytes、viewport 和枚举 presentation command；输出仅允许 `hello|ready|marker|activation|metrics|heartbeat|failure`。`activation` 只是签名 player chrome 对画布点击/键盘激活的无权限提示，host 限频后最多递增 `wakeGeneration`；player 不能发起文件、网络、Pet Library 或其他 host request。
- Phase 6D 必须证明 player view 看不到 `window.dshDesktop*`、Workspace preview DOM、父页面对象或其他 view 的 session data。任何候选都不能退回 shell main world；若无法在该独立 view 中工作，直接淘汰候选。
- `PetRecoveryGuard` 从 player view 外部执行加载 deadline、heartbeat 与 crash-loop 判定，强制销毁/重建的只能是 PetPlayer view，并隔离坏包。shell、Harness `WebContentsView` 和当前任务均不 reload。

`MessagePort` 是 capability 边界，不是通用 IPC。协议放在 shared schema 中并固定版本；main 生成 128-bit 随机 `realmEpoch` 和一次性 nonce，在精确 player entry 完成加载后用 `WebFrameMain.postMessage` 向精确 `webContents.id + WebFrameMain` 交付初始化 envelope 与 port；bootstrap preload 只完成上述一次性 renderer 接收、校验和转交。第一条 player-to-main port 消息必须是回显匹配 protocol version、epoch 和 nonce 的 `hello`，否则立即销毁 view。控制消息上限 16 KiB，metrics/heartbeat 上限 4 KiB；player 输出限 128 KiB/s，metrics 最多 2 次/s、heartbeat 1 次/s、marker 最多 20 次/s、activation 最多 4 次/s。每个 realm 只允许 main 在 `hello` 后交付一次已经过主进程校验、最大 64 MiB 的 pet `ArrayBuffer`；当前 Electron `MessagePortMain` 对普通 `ArrayBuffer` 使用有界 structured clone，不宣称零拷贝 transferable。消息必须携带精确 byte length、SHA-256、runtime 与 pet generation，player 在进入 Adapter 前再次校验长度与 hash，且不能再次申请数据。`hello` 只表示端口建立，`start(asset)` 必须等 Adapter 完成创建并返回匹配 generation 的 `ready` 才成功；重复交付、加载失败或 5 秒超时均 fail-closed。所有消息都做严格 schema、未知字段和枚举校验，并绑定 `realmEpoch`、pet generation 与 presentation generation；超限、洪水、旧 generation 或解析失败均 fail-closed。导航、frame 替换、view destroy、切换宠物或 epoch 更新时立即关闭旧 port，旧消息永远不能完成新状态。

实现口径更新（2026-08-20）：上段早期的 5 秒数值已被真机数据替代；生产 `PetPlayerRealm` 的完整 `hello → asset verify/decode → ready` deadline 为 10 秒，超时仍由 main 从外部销毁 realm。一次性 probe 的独立短 deadline 不因此放宽。

## Module Interface

### `PetLibrary`

外部只看到快照、订阅和判别命令，不接触绝对路径或包内部结构。

```ts
type PetAssetSummary = {
  readonly id: string;              // opaque, not a filesystem path
  readonly name: string;
  readonly author: string;
  readonly origin: "built-in" | "imported";
  readonly status: "ready" | "incompatible" | "damaged";
  readonly thumbnailUrl: string;     // controlled dsh-pet: URL only
  readonly thumbnailRevision: string;
  readonly license: string;
  readonly source: string;
};

type PetLibrarySnapshot = {
  readonly enabled: boolean;
  readonly activePetId?: string;
  readonly assets: readonly PetAssetSummary[];
  readonly revision: number;
};

type PetLibraryCommand =
  | { readonly kind: "import"; readonly expectedRevision: number }
  | { readonly kind: "select"; readonly petId: string; readonly expectedRevision: number }
  | { readonly kind: "remove"; readonly petId: string; readonly expectedRevision: number }
  | { readonly kind: "set-enabled"; readonly enabled: boolean; readonly expectedRevision: number };

interface PetLibrary {
  getSnapshot(): PetLibrarySnapshot;
  subscribe(listener: (snapshot: PetLibrarySnapshot) => void): () => void;
  request(command: PetLibraryCommand): Promise<PetLibraryResult>;
}
```

`import` 不接受路径。主进程只把 Harness main frame/origin 当作来源校验，不能据此证明调用一定来自设置页或真实 user activation；它要求窗口可见且聚焦、检查 `expectedRevision`、执行 rate limit，并自行打开系统文件选择器。用户未在系统选择器中确认文件就不能导入；取消返回 `cancelled`，不显示错误。

`remove` 同样不能只相信 Harness 调用。main 显示包含宠物名称的原生确认，确认后先移动到 Pet Store 内的可恢复 Trash 并发布新 revision；7 天后或用户明确清空时才删除。Built-in Pet 永远拒绝 remove。旧 revision、重复 remove、窗口非前台和短时间重复弹窗全部拒绝/合并。

### `PetPackageValidator`

```ts
interface PetPackageValidator {
  validateStagedPackage(input: {
    readonly stagingId: string;
    readonly supportedContract: PetRuntimeContract;
  }): Promise<ValidatedPetPackage | PetPackageRejection>;
}
```

输出必须是包含内容 hash、兼容版本、规范化元数据和已验证入口的不可变结果。调用者不能跳过校验直接安装 staging 内容。

### `PetDirector`

```ts
type HarnessActivity = "disconnected" | "idle" | "running";

type PetState =
  | "standing"
  | "drowsy"
  | "lying-down"
  | "sleeping"
  | "waking"
  | "rubbing-eyes"
  | "work-enter"
  | "eating"
  | "work-exit";

interface PetDirector {
  update(input: {
    readonly activity: HarnessActivity;
    readonly wakeGeneration: number;
    readonly visible: boolean;
    readonly reducedMotion: boolean;
    readonly now: number;
  }): PetPresentation;
  complete(marker: PetCompletionMarker): PetPresentation;
}
```

所有 timer、随机区间、动作完成事件都带 generation。旧 player、旧 Workspace 或 renderer 恢复前的 completion 不得改变当前状态。

### `PetPlayer`

```ts
interface PetPlayer {
  load(asset: ValidatedPetAsset): Promise<PetPlayerReady>;
  present(presentation: PetPresentation): void;
  setVisible(visible: boolean): void;
  resize(viewport: PetViewport): void;
  dispose(): Promise<void>;
}
```

`PetPlayer` 是内部 seam，不作为插件 API。production 中只绑定一个 Adapter；测试使用 deterministic fake。引擎的 artboard、state machine、视频片段或动画名都留在 Adapter 内。

上述接口是 host façade，不表示 shell 直接持有 player 对象。production host 把调用序列化成固定 MessagePort schema；隔离 view 只能返回允许的事件，双方不共享 DOM、对象引用、文件句柄或任意方法名。

### `PetLibraryBridge`

设置页运行在 Harness `WebContentsView`，因此只增加一个新的极窄桥：

```ts
window.dshDesktopPet = {
  getSnapshot(): Promise<PetLibrarySnapshot>;
  subscribe(listener): () => void;
  request(command: PetLibraryCommand): Promise<PetLibraryResult>;
};
```

桥只返回元数据和 `dsh-pet:` 受控缩略图 URL，只接受无路径命令与 opaque `petId`。缩略图协议是有意向可信 Harness origin 可见的静态展示资源，只接受 `thumbnail/<opaque-id>/<revision>` 并只返回已校验、有界的 PNG/WebP；opaque id 不是文件权限，协议本身永远没有 animation/payload route。桥不能读取动画字节、列目录、发送通用 IPC 或访问 shell 的 Workspace Interface。动画 payload 由 main 通过专用 MessagePort 只交给 PetPlayer view。

## 设置中的宠物资产库

### 页面位置

- 继续使用固定 Runtime 的官方 `settings.section` seam。
- 导航顺序：通用设置、模型、插件、Agent 预设、外观、**宠物**、关于。
- 页面标题和全部状态提供中英文文案，视觉 token、字号、圆角、间距和按钮层级复用 Harness 设置页面。

### 页面内容

- 顶部提供“显示宠物”开关与“导入宠物”按钮。
- 资产以卡片/列表展示缩略图、名称、作者、来源、许可、兼容状态和“当前使用”标记。
- 选择 ready 资产后立即写入 `activePetId`，Pet Stage 平滑切换；切换失败保留旧宠物。
- 内置宠物不可删除；Imported Pet 可移除。main 原生确认后，移除当前宠物先回退 ready 内置默认（否则禁用 Stage），再移动到可恢复 Trash；设置页提供撤销入口。
- 不兼容或损坏资产只显示原因分类和移除操作，不能强行启用。
- 设置页使用静态缩略图，不在 Harness renderer 中运行宠物动画。
- 宠物动画的实时预览统一放在 Pet Stage，避免 Harness 页面持有未信任动画字节或第二个 player。

## Companion 尺寸与 Pet Stage

### 状态模型

```ts
type CompanionPanelPreference = {
  readonly open: boolean;
  readonly preferredWidth: number;
};
```

`open` 和 `preferredWidth` 必须分开：

- `open=false` 时实际宽度为 `0`，只由 toggle/close 命令触发。
- `open=true` 时实际宽度始终经过 `[minVisibleWidth, maxVisibleWidth]` clamp。
- 拖拽只改变 `preferredWidth`，永远不改变 `open`。
- 再次打开恢复上一次合法 `preferredWidth`，而不是固定回默认值。

### 初始布局 token

| 项目 | 初始值 | 约束 |
| --- | ---: | --- |
| 可见最小宽度 | 340 px | 到达后继续向右拖动无效 |
| 默认宽度 | 380 px | 首次打开使用 |
| 可见最大宽度 | 560 px | 仍需受主内容最小宽度和窗口宽度二次 clamp |
| resize 命中区 | 8 px | 可见线保持 1 px，命中区向两侧扩展 |
| 键盘步进 | 16 px | `Shift` + 方向键为 48 px |
| 打开/关闭动画 | 220 ms | 与当前 Harness 左栏节奏接近 |
| Pet Stage 高度 | 200–320 px，preferred 260 px | 先让位给文件区，再整体隐藏 |
| 文件区最小高度 | 220 px | 包含 tabs/empty/list 的可用区 |

这些值是实现起点；若 820/980/1320 响应式矩阵的真机视觉验证证明不可用，只能通过同一 layout token 测试统一调整，不能在 CSS、main 和测试中各自硬编码。

### 拖拽语义

- 右边缘固定，左边界是 `role="separator"` 的 resize handle。
- 指针向左移动增加宽度，向右移动减少宽度；到最小值后继续向右不产生位移，也不触发隐藏。
- pointer down 后使用 pointer capture；拖动期间 bounds 逐帧合并更新，不使用 easing，不同步读取文件或 Git。
- pointer up/cancel 才持久化最终 `preferredWidth`。
- separator 支持左右方向键、`aria-valuemin/max/now`、清晰 focus ring 和双击恢复默认宽度。
- 右上角开关始终可用；关闭时 Harness 恢复全宽，重新打开恢复合法宽度和原 tab/selection。

### 响应式关系

- `<980px` 继续使用 overlay；最小宽度约束不挤压 Harness，Pet Stage 仍在 overlay 顶部。
- `980–1319px` 使用 docked `Harness | Companion`；打开文件进入 `Preview | Companion` Review Focus。
- `>=1320px` 根据 layout solver 允许 `Harness | Preview | Companion`。
- `maxVisibleWidth` 由窗口宽度、Harness/Preview 最小宽度和模式动态计算；若动态最大值小于 340px，自动转为 overlay，而不是制造小于最小值的 docked 面板。
- 垂直 layout 单独求解：扣除 toolbar、Companion header、tabs/footer 后，先把 Pet Stage 从 260px 缩到 200px；若仍不能保留 220px 文件区，则完全隐藏 Pet Stage，文件区取得剩余高度。不得把文件 tabs/content 挤到不可操作。
- 固定覆盖当前窗口 `minHeight=600px`，并验证 600/720/900px；因垂直空间隐藏 Stage 不改变 panel `open` 或 preferredWidth。

### Pet Stage

```text
┌──────────────────────────┐
│ Pet Stage                │ 200–320px, clipped
│ character + DOM bubble   │
├──────────────────────────┤
│ 变更 | 文件              │
├──────────────────────────┤
│ tree / list / empty      │ flex: 1
└──────────────────────────┘
```

- 使用固定逻辑 viewBox、底部 baseline 和安全边距；显示尺寸变化只做等比 fit。
- `overflow: clip`、`contain: layout paint size`；角色、头发、尾巴、粒子和气泡均不得越界。
- 气泡由本地 DOM 绘制，不烘焙在角色资产中；`eating` 时显示“疯狂进食 token 中”。
- 点击或键盘激活 Pet Stage 产生一次 `wakeGeneration`；不监听全局键鼠。
- Pet Library 禁用、没有 ready 资产或 player 失败时，Pet Stage 整体收起，文件区占满，不保留空白占位。
- 完全隐藏 Companion 后停止渲染；重新打开时先按最新 Harness activity 对账，再恢复动画。

## 宠物包契约

### 包结构

`.yukipet` 是 ZIP 容器，v1 目标结构如下；Phase 6A–6C 使用 `draft-0`，Phase 6D 产生 `v1-rc`，只有 Phase 6E 官方宠物满意验收后才成为 `v1`，此前不向用户承诺兼容。

```text
pet.yukipet
├── pet.json
├── thumbnail.png | thumbnail.webp
├── payload/                       # 唯一受支持引擎的声明式资产
└── LICENSE.txt                    # 可选，但 license/source 元数据必填
```

`pet.json` 的稳定 envelope：

```json
{
  "schemaVersion": 0,
  "id": "author.pet-name",
  "name": { "zh-CN": "示例宠物", "en": "Example Pet" },
  "author": "author name",
  "license": "SPDX-or-custom",
  "source": "https://example.invalid/or-local-original",
  "runtime": {
    "adapter": "selected-after-phase-6d",
    "adapterContractVersion": 1,
    "assetFormat": { "family": "selected-format", "major": 1 }
  },
  "viewport": { "width": 1024, "height": 640, "baseline": 600 },
  "motions": {
    "standing": {},
    "drowsy": {},
    "lying-down": {},
    "sleeping": {},
    "waking": {},
    "rubbing-eyes": {},
    "work-enter": {},
    "eating": {},
    "work-exit": {}
  },
  "files": [
    {
      "path": "thumbnail.png",
      "role": "thumbnail",
      "mediaType": "image/png",
      "byteLength": 12345,
      "sha256": "64-lowercase-hex"
    },
    {
      "path": "payload/pet.asset",
      "role": "animation",
      "mediaType": "selected-runtime-media-type",
      "byteLength": 45678,
      "sha256": "64-lowercase-hex"
    }
  ],
  "packageContentHash": "64-lowercase-hex"
}
```

除 `pet.json` 自身外，每个 archive regular file 必须且只能在 `files` 中出现一次；inventory 按 NFC 规范化后的 UTF-8 path byte order 排序，path、role、MIME、字节数和 SHA-256 都必须匹配。`packageContentHash` 定义为移除该字段后的 RFC 8785 canonical `pet.json` 的 SHA-256；payload 完整性由 inventory 中每个文件 hash 闭合，避免自引用。

Phase 6D 固定唯一 runtime 候选并产出 runtime/asset-format compatibility 与 motion payload 的 `v1-rc`；Phase 6E 可以根据正式角色的动作、marker、viewport 和视觉验收修改 RC。产品所有者满意后才把 `schemaVersion` 从 `0` 升为 `1`、接受 animation runtime ADR 并开启兼容承诺。`schemaVersion`、`adapterContractVersion` 与 `assetFormat.major` 是不同兼容边界；应用还要在构建清单中固定实际 runtime npm/WASM 版本。v1 validator 只接受一个精确 adapter/asset-format family；字段存在不代表应用同时支持多个 player。

### 动作完整性

- `standing`、`sleeping` 和 `eating` 必须存在。
- 所有过渡动作应由正式宠物包提供；若 v1 允许某项可选，fallback 必须由 manifest 显式声明且经过 validator 验证，不能由 player 猜测 clip 名。
- 用户可以改变动作姿势、节奏、表情和次级运动，但 root anchor、baseline、safe bounds、循环/非循环语义及 completion marker 必须满足契约。
- 每个循环动作有确定入口/出口；不可中断过渡必须提供 authored completion marker。
- 不接受彼此独立生成、身份明显漂移的动作素材作为官方包；用户包出现跳形时 validator 可通过结构校验，但 UI 必须标为“未通过推荐视觉 QA”，不能伪称官方质量。

### 初始硬限制

| 资源 | 硬限制 |
| --- | ---: |
| 压缩包 | 24 MiB |
| 解压后总量 | 96 MiB |
| 文件数 | 64 |
| 单文件 | 64 MiB |
| 单项解压比 | 100:1 |
| 整包解压比 | 40:1 |
| 缩略图 | 1024×1024、1 MiB |
| 路径深度 | 8 |
| 单路径 | 240 UTF-8 bytes |
| manifest | 128 KiB |
| 名称/作者 | 分别 80/120 Unicode scalars |
| license/source | 分别 64/2048 UTF-8 bytes |
| 校验/探测时间 | 5 s，超时拒绝 |

解压必须流式累计计数，到达单项或全局限制立即中止。所有展示元数据规范化为 NFC，拒绝 C0/C1 控制字符、NUL、换行和 Bidi override/isolate 控制字符；UI 只使用框架转义/text node，不解释 HTML。真实运行时选定后，根据官方宠物的质量、包体和真机内存把限制只收紧不放宽；放宽需要安全与性能复审。

## 导入与安装流程

```text
用户点击“导入宠物”
  -> main 检查前台/聚焦窗口 + expectedRevision + rate limit
  -> 系统文件选择器选择单个 .yukipet
  -> 用户在系统选择器中的明确选择构成本次导入授权
  -> 复制到 Pet Store 同卷的随机 sibling staging 目录
  -> archive 结构与硬限制检查
  -> manifest schema/hash/MIME/engine 检查
  -> 隔离 player probe 验证语义动作和 bounds
  -> 生成内容 hash 与规范化元数据
  -> 原子 rename 到 Pet Store
  -> 发布新 PetLibrarySnapshot
```

- 原始绝对路径只在主进程的导入调用栈中短暂存在，不写入设置、日志、诊断或 renderer。
- staging 位于 app-owned Pet Store 下的隐藏 sibling 目录，使用随机名称和 `0600/0700` 权限；写入并同步文件/目录后在同一文件系统内原子 rename，失败和取消后安全清理。不得使用可能跨卷的系统临时目录完成最终 rename。
- 同内容 hash 重复导入返回已有资产，不重复占用空间。
- 同 manifest id 但内容不同的包生成新的内部 opaque id，不覆盖已安装版本；用户明确选择后再切换。
- 安装成功但启用失败时保留包并显示错误，Active Pet 仍为上一只。
- 应用升级只迁移 Pet Library 索引，不改用户原始包；未知未来 schema fail-closed。

上述是 v1 的完整导入流程，不代表 Phase 6B 已具备尚未选定引擎的深层校验能力。6B 只执行到通用 envelope/archive/manifest/hash/MIME/限额 preflight，并把通过项密封到独立、开发态的 Pet Import Inbox；它不执行动画 probe、不原子安装到 Pet Library、不产生 ready Imported Pet。Phase 6D 选定 runtime、实现受信深层 parser 与隔离 probe 后，才允许开发态 Inbox 条目通过完整流程进入 dev Pet Library；Phase 6E 冻结 v1 后才开放生产导入。

## 连续动画技术验证

### 为什么现在不直接冻结引擎

流畅度不只由“60 fps”决定，产品成功也不只由官方宠物画质决定。动画引擎同时影响角色形变、状态混合、资源包体、CPU/GPU、离线加载、CSP、授权和普通用户能否制作自己的宠物。若一个引擎只能由动画师在专有编辑器中手工导出，即使播放效果最好，也不满足本项目的用户生态要求。

Phase 6D 对每个候选先执行 Creator Gate，再执行 Runtime Gate。Creator Gate 使用同一组角色参考图和自然语言动作要求，必须由项目维护的无头 Authoring PoC 自动生成候选样片；不接受“动画师先在编辑器做好，再交给程序播放”作为通过证据。只有 Creator Gate 通过的候选，才使用同一动作脚本、时长、画布、anchor、过渡端点和验收标准进入 packaged benchmark。验证结束后只保留一条 production path：

| 候选 | 优势 | 主要风险 | Spike 结论要求 |
| --- | --- | --- | --- |
| Rive | 骨骼、mesh、曲线、状态机和 blend 适合连续角色动画；runtime 为 MIT，可内存加载、离线提供 WASM | runtime `.riv` 依赖付费编辑器导出，当前无项目可依赖的稳定无头 authoring/export SDK；普通用户无法从 Creator Input 自行产出 | **当前 Creator Gate 未通过，暂停继续投入**。只有项目获得无需用户操作专有编辑器的自动生成与导出路径后才能恢复候选；已有 Canvas Lite 代码仅保留为隔离/校验探针 |
| dotLottie v2 | 开放容器、MIT Web runtime、状态机与子帧插值，JSON/容器工具链比二进制专有工程更容易自动生成 | 复杂人物 mesh、次级运动、身份一致性和真实角色质量需实测；theme expression/OpenUrl 等能力必须静态拒绝 | 先用 Creator Input 做无头生成 PoC；能自动产出九动作、过渡和 QA 后，才比较 Software/WebGL2 playback |
| 透明 WebM 动作包 | Chromium 原生解码，可原样呈现自动生成或渲染出的 30/60fps 动作；生成、转码、分段和打包易于脚本化 | 多动作/过渡会增大包体，交互混合较弱；透明边缘、身份一致性、无缝循环和切换需实测 | **首个 creator-first 验证方向**；Skill PoC 自动生成/接收动作片段、去背景、统一角色、转码、补过渡并打包，过门后再测播放性能 |
| 高密度序列帧 | 完全声明式、容易生成和逐帧验证，不依赖专有运行时；可通过足够密度保持时间连续 | 包体、解码内存和纹理上传压力可能较高，逐帧生成容易身份漂移 | 作为透明 WebM 的开放对照；要求由同一连续源生成，不允许用少量姿势插帧伪装流畅 |

Live2D 和 Spine 暂不进入首版候选：Live2D 将可持续添加模型的应用纳入 Expandable Application 边界，需要发布前审查及相应 Publication License；Spine runtime 集成期间需要有效 Editor license、附带 Runtime License，并保持 editor/runtime 导出版本匹配。项目在取得各自产品形态的书面确认并重新评审前不集成。Animated WebP 只可用于缩略图、短非语义循环或首帧静态回退，不承担主状态机。

Creator Input Contract、无头 Skill 生成、安全、许可和全离线都是否决门。只有全部通过后，才比较自然度、frame-time/missed frames、内存、包体、生成耗时和可选精修成本；不得用优秀画质抵消用户制作门失败，也不得在看到结果后临时改指标偏向某个候选。

### Spike 最小素材

不等待最终角色，但必须从统一 Creator Input 自动生成一套无品牌技术样片；不得人工在候选编辑器中补做决定性动画：

- 站立呼吸 + 3 次不同间隔眨眼，20 秒。
- 站立 → 犯困 → 趴睡的完整过渡。
- 睡眠 → 唤醒 → 起身 → 揉眼 → 站立的完整过渡。
- 任意 idle → 坐下进食 → 起身返回的运行状态。
- 头发、裙摆或尾巴至少一种次级运动。
- 透明边缘、底部 anchor 和最远运动 bounds。

### Creator Gate

候选必须先满足以下条件，才允许消耗 packaged benchmark 时间：

1. 最低输入只有一组角色参考图和自然语言动作要求；可请求追加参考以提高 identity，但不能要求用户提供 rig、状态机、动画工程或按引擎命名的文件。
2. 项目维护的命令/Module 能在无人操作专业编辑器的情况下生成九种语义动作、必要过渡、缩略图、manifest、hash 和 QA 报告。
3. 用户不需要购买某个专有动画编辑器才能生成可导入包；可选人工精修不得成为最低可用路径。
4. 同一 Creator Input 可确定重跑，失败要指出缺少的参考或具体 QA 问题，不能只返回不可解释的坏动画。
5. 生成结果通过 identity、动作完整性、透明边缘、循环、anchor、bounds 和包体自动检查，并能由应用 validator round-trip 导入。
6. 至少由一名没有动画软件经验的测试者只按 Skill 提示完成一次端到端制作，过程中不接触底层 runtime 名称。
7. 应用和 Skill 的用户 Interface 不出现第三方模型 Key、账号或计费配置；制作能力必须来自本地 Module、项目交付的内置资产，或宿主已提供且无需用户另配凭据的能力。

任一项失败即淘汰候选。Creator Gate 不是评分项，不能用官方宠物画质、运行性能或专业动画师效率抵消。

### Runtime 入选门

只有同时满足以下条件，候选才能成为 Phase 6E 使用的唯一 production runtime candidate，生成 `.yukipet v1-rc` 和 proposed animation runtime ADR：

1. 打包后的 arm64 Electron 应用全离线启动和切换，不产生 CDN/远程资产请求。
2. 60 Hz 真机中连续播放 30 分钟，无可见闪白、跳形、anchor 漂移或音画线程阻塞。
3. 所有语义动作、不可中断 marker、快速 run/idle、睡眠中运行和用户唤醒可确定重放。
4. Companion 完全隐藏后停止呈现，增量 CPU 接近静止；反复隐藏/打开和切换 100 次无持续内存/GPU 增长。
5. `prefers-reduced-motion`、窗口 resize、renderer recovery 和系统休眠恢复正确。
6. runtime 许可允许应用分发和用户导入，第三方 notice 完整。
7. 安全评审确认不需要任意脚本、远程 URL、`file://` 或 Node 权限，并能在专用 PetPlayer `WebContentsView` 中运行。

Rive 当前因缺少满足本项目要求的无头生成/导出路径而停在 Creator Gate 之前，不再作为默认下一步。已有 Canvas Lite 探针仍须维持无 scripting/audio/text/layout：创建任何 `Rive`/`RiveFile` 前调用 `RuntimeLoader.setWasmBinary(localArrayBuffer)` 与 `RuntimeLoader.setWasmFallbackUrl(null)`，设置 `enableRiveAssetCDN:false`，只使用已验证的 `buffer`/`RiveFile`，不得提供 `src` URL；它只用于复用隔离 Player 和 validator 测试，不能据此形成 production 决策。

完整 `webgl2` runtime 包含 scripting，而官方高层 API 当前没有足够的检查接口证明任意 `.riv` 不含脚本。因此 `canvas-lite` 质量失败时不能自动降级为 `webgl2`：只有找到并验证可信 parser 能在 runtime 加载前拒绝 scripting，`webgl2` 才能继续候选；否则 Rive 整体淘汰。首版不允许通过另立 ADR 绕过“声明式、无脚本”产品不变量。若选用需要 WASM eval 的 runtime，只能在专用 PetPlayer document 的精确 CSP 中增加最低限度的 `wasm-unsafe-eval`，绝不增加 `unsafe-eval`；父 shell 与 Harness CSP 均不得因宠物放宽。

dotLottie 若继续候选，导入器必须静态拒绝 theme `expression`、OpenUrl action、remote asset 和任何外部行为，或完全不加载包内状态机。所有候选格式内的 state machine 只能是 `PetDirector` 命令驱动的表现层实现：不得自行接收 pointer 事件、改变应用语义状态或触发外部副作用。

这是一条所有候选共用的入选门：必须有受信、版本固定的 parser 在 runtime 加载前递归证明 payload 不含外部/data URL 引用、URL action、自定义 host event、脚本/表达式、音频、外部字体、SVG 文件、任意 shader、嵌套未知容器或包来源回调。player 不注册也不执行 asset-defined callback。任何格式做不到“先深验、后加载”就直接淘汰，CSP、sandbox 和 `window.open` 拒绝只做第二层防线。

## 行为状态机

```text
standing -> drowsy -> lying-down -> sleeping
sleeping --user wake--> waking -> rubbing-eyes -> standing
sleeping --task run--> waking -> work-enter -> eating
idle state --task run--> work-enter -> eating
eating --all idle, 800ms debounce--> work-exit -> standing
```

### 行为规则

- `blink` 是 standing/drowsy 中的独立表现层，不改变主语义状态；随机间隔使用可注入随机源。
- 站立 5–13 秒随机眨眼；连续闲置 60–120 秒后开始犯困。区间在测试中固定，在产品中避免机械重复。
- 用户只能通过 Pet Stage 的点击、Enter 或 Space 唤醒；签名 player chrome 将画布激活归一化为无权限、有限速的 `activation`，可信 Stage Host 同时保留可访问的唤醒控件。不监控系统级键鼠，动画资产自身也不能定义交互命令。
- 任一已知 Harness Session `running=true` 时 `runningCount > 0`，最终进入 `eating`。
- 睡眠中开始运行时先播放可辨识的醒来动作，再进入工作；为响应任务可跳过揉眼，但不能瞬移到坐姿。
- `runningCount` 归零后防抖 800 ms；期间重新运行继续 eating，不反复起坐。
- 不可中断动作只在 authored marker 转换；过期 completion generation 被忽略。
- renderer 隐藏、系统睡眠或长时间掉帧后不追赶所有中间帧；恢复时按最新 authoritative state 和安全过渡对账。
- disconnected 不伪装为 running；保持低活动 standing 或静态回退。

### 流畅度定义

“流畅”同时要求：

- 展示帧按 elapsed time 连续采样，不以 `setInterval` 逐张换姿势。
- 状态过渡有 authored transition 或可验证的 blend，不直接切换不相容姿势。
- 呼吸、重心、头发、衣摆、尾巴等至少一类次级运动连续存在，角色不会像贴纸静止。
- 循环首尾 root、baseline、scale 和色彩连续。
- resize 不重启动画，宽度变化中角色 anchor 不漂移。
- 60 fps 不是唯一门槛；即使帧率达标，明显形变错误、闪变或机械节奏仍阻塞发布。

## 性能、视觉与无障碍门禁

性能预算在 Phase 6D 形成 RC，Phase 6E 用正式宠物复测并在满意验收时冻结；初始目标为：

| 指标 | 初始目标 |
| --- | --- |
| 可见呈现 | 相对实测 refresh period：P95 <=1.25×period，同时记录 P99；`>2×period` 帧占比 <=0.1%，且不连续超过 2 帧 |
| idle 增量 CPU | 参考机平均 <=2%，峰值和耗电在报告中单列 |
| 隐藏增量 CPU | stop rendering 后接近基线噪声 |
| active decoded assets | <=64 MiB；只解码当前宠物 |
| 切换稳定性 | 100 次切换/隐藏无单调内存或 GPU 增长 |
| 包加载 | 常规包 <=500 ms；5 s 硬超时 |

视觉 QA 同时产出：

- canonical model sheet、颜色表和不可变化清单。
- 每个动作的 1x 与 0.25x 实时预览，以及慢放录制。
- 动作入口、出口、最远 bounds、baseline 和 root anchor overlay。
- 站立、睡眠、进食循环的首尾差异检查。
- 30 分钟真实应用录屏与 frame-time/CPU/内存报告。
- light/dark/system、340/380/560px 面板宽度和 820/980/1320px 窗口矩阵。

每份性能报告必须固定并记录 App/Electron/Chromium/runtime 版本、机器型号、macOS、DPR、逻辑画布尺寸、renderer backend、是否插电及采样工具；不同候选只在相同基线条件下比较。

自动检查 alpha bounds、画布尺寸、anchor、manifest、hash、缺失动作和超限资源；角色身份、动作自然度和“有生命力”必须由产品所有者进行人工验收。自动化不能替代该验收。

`prefers-reduced-motion` 下使用静态站立或极低幅呼吸与低频眨眼，状态通过气泡/标签保留含义，不播放长距离起卧和高频 token 粒子。

## 安全模型

宠物包是来自用户磁盘的不可信输入，即使文件名和缩略图看起来正常。

### 导入边界

- 只允许系统文件选择器选中的单个 `.yukipet`；不接受 browser 提供的路径。
- 拒绝绝对路径、`..`、NUL、Unicode/case-fold 重复、过深路径、symlink、hardlink、device 和特殊文件。
- 解压前检查 central directory；限制压缩包、解压量、文件数、单文件和压缩比，防止 Zip Slip 与压缩炸弹。
- 所有文件必须在 allowlist 内，实际 MIME 与声明一致；未知文件和 future schema 默认拒绝。
- manifest 使用结构化 schema parser；每个 payload 文件记录 SHA-256 和大小。`license` 与 `source` 只作为展示/归属元数据，不会由应用自动联网读取。
- 结构校验后的动画语义 probe 不在 Harness 或 Electron main 中执行；Phase 6D 必须为所选 runtime 固定一个只含单用途 MessagePort bootstrap preload、无页面 Electron/Node API、无网络、用后销毁的隔离 probe Adapter。5 秒 deadline 由 main 的独立计时器持有，超时后从外部强制销毁 probe 承载进程/WebContents，不能只在被测 renderer 内 `Promise.race`。
- 内置宠物随签名应用验证；Imported Pet 安装在 Application Support 的 app-owned 目录，不进入 Runtime Home 或 Workspace。
- 安装采用 staging + 完整验证 + 原子 rename；验证失败的内容不出现在 Pet Library。

### 运行边界

- 动画只在 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true` 的专用 PetPlayer `WebContentsView` 中运行。唯一 preload 是随签名应用交付的 one-shot MessagePort bootstrap；它不使用 `contextBridge`，页面主世界仍检测不到 Electron、Node、shell/Harness bridge 或任意 IPC API。其非持久 session/partition 与 shell、Harness 隔离，CSP 为 `default-src 'none'`、`connect-src 'none'`，只为随签名 App 交付的精确 player entry 开放所需的本地 `script-src`/`worker-src`/`img-src`/`media-src`；父 shell 与 Harness CSP 不作修改。
- PetPlayer 专用 session 在请求层拒绝 `http:`、`https:`、`ws:`、`wss:`，只允许精确的签名 app scheme 入口；同时拒绝导航、`window.open`、download 和 permission request。请求若无法归属到当前登记的 player `webContents + main frame + realmEpoch` 就 fail-closed；该过滤器绝不能全局套用到 Harness、更新器或 shell session。sandbox/CSP 本身都不单独被当作断网机制。
- 禁止 JS/HTML/CSS、WebAssembly/runtime binary、脚本状态、打开 URL、音频、Hosted/CDN asset、外部字体、SVG 文件、任意 shader 和原生扩展；player JS/WASM 只能来自签名 App Version。
- renderer 通过 opaque id 和受控 bridge/protocol 获取已验证内容，不使用 `file://`，不见绝对路径。
- Harness 设置页只见经过清洗的元数据和缩略图，不见动画 payload。
- 正常 player 错误先请求 `dispose` 并回退；若 player 卡死、崩溃或停止 heartbeat，不能依赖其自救。main-owned `PetRecoveryGuard` 用独立计时器关闭 port、销毁并重建专用 PetPlayer view，在当前 app run 内隔离该 Imported Pet，再回退内置宠物或隐藏 Pet Stage。shell toolbar、Companion chrome、Harness 和任务不受重建影响，也不能形成 crash loop。
- 日志和诊断只记录错误码、schema/engine 版本、资源计数和 hash 前缀，不包含用户素材、绝对源路径或动画字节。

### 稳定错误码

| 错误码 | 含义 | UI 行为 |
| --- | --- | --- |
| `pet-import-cancelled` | 用户取消选择 | 静默结束 |
| `pet-package-invalid` | ZIP/manifest/MIME/hash 不合法 | 显示“宠物包无效” |
| `pet-package-unsafe` | traversal、link、script、remote asset 等 | 拒绝并说明安全分类 |
| `pet-package-too-large` | 任一硬限制超出 | 显示具体上限 |
| `pet-package-incompatible` | schema/engine/runtime 不兼容 | 保留或移除，不允许启用 |
| `pet-player-unavailable` | runtime 初始化或 probe 失败 | 保留旧宠物/隐藏 Stage |
| `pet-selection-missing` | active id 丢失或包损坏 | 回退 ready 内置包，否则隐藏 Stage |

## 持久化与降级

应用设置只保存：

```json
{
  "companion": {
    "open": true,
    "preferredWidth": 380,
    "activeTab": "changes"
  },
  "pet": {
    "enabled": true,
    "activePetId": "opaque-id"
  }
}
```

- 不保存导入源路径、动画状态、Workspace root 或用户素材字节。
- Pet Library 有独立版本化索引；索引可从 app-owned store 重建。
- 内置默认包随签名应用交付并优先作为回退；若其签名/资源验证或 player 加载也失败，则隐藏 Pet Stage，绝不能把“内置”当作无条件可用。用户包损坏时 fail-closed，不自动删除，等待用户移除或重新导入。
- renderer recovery 后重新订阅 snapshot、加载 active pet、按最新 activity 恢复，不回放过期 completion。
- 旧版本不认识 pet 字段时忽略；新版本无法读取 future schema 时禁用对应包，不阻塞应用启动。

## 精确代码落点

```text
src/
├── shared/
│   ├── desktop-companion.ts         # open + preferredWidth + layout commands
│   ├── pet-library.ts               # snapshots/commands/results
│   ├── pet-package.ts               # manifest/runtime contract/errors
│   ├── pet-authoring.ts             # Creator Input + Creator Gate evidence
│   └── pet-frame-sequence-bundle.ts # validated main → isolated Player bytes
├── main/
│   ├── pet/
│   │   ├── pet-authoring-workflow.ts # input bytes → adapter → package preflight → evidence
│   │   ├── frame-sequence-authoring-adapter.ts # generator Port → atlas package
│   │   ├── pet-package-builder.ts   # bounded deterministic stored ZIP
│   │   ├── pet-import-inbox.ts      # dev-only quarantined preflight results
│   │   ├── pet-library.ts
│   │   ├── pet-package-importer.ts
│   │   ├── pet-package-validator.ts
│   │   ├── pet-player-view.ts       # dedicated session/view/port lifecycle
│   │   ├── pet-recovery-guard.ts
│   │   └── pet-store.ts
│   └── window/
│       └── desktop-window-layout.ts  # min/max/overlay/docked pure solver
├── preload/
│   ├── index.ts                      # Harness preload; metadata-only PetLibraryBridge
│   ├── shell.ts                      # Stage host snapshot/commands; no animation payload
│   └── pet-player-bootstrap.ts       # one-shot MessagePort handoff; no exposed API
└── renderer/
    ├── pet/
    │   ├── pet-director.ts
    │   ├── pet-stage-host.ts
    │   └── pet-player-host.ts        # bounds + MessagePort facade, no payload parsing
    └── pet-player/
        ├── index.html                # dedicated sandboxed view document
        ├── pet-player.ts
        ├── frame-sequence-canvas2d-adapter.ts
        └── adapters/                 # exactly one production adapter after spike

runtime/
└── desktop-settings-plugin/
    └── client.js                     # appearance + pet library + about

resources/
└── pets/
    └── built-in.yukipet              # signed, immutable default

tests/
├── fixtures/pets/
│   ├── golden/
│   └── hostile/
└── e2e/
```

共享 contract 不导出 fs path、引擎对象或任意 command payload；`AppCoordinator` 只组合 Module 和 lifecycle，不解析 ZIP、驱动动画或计算手势宽度。

## 分阶段实施

### Phase 6A：契约、安全与测试夹具

状态：**已完成；不需要角色素材**。

- 接受稳定领域术语与安全不变量，发布 Module Interface、布局状态和 Semantic Motion Contract 的 `draft-0`，不承诺兼容。
- 定义 `.yukipet draft-0` envelope、硬限制、错误码和 hostile fixtures。
- 实现纯 manifest/archive preflight validator 与 Pet Library fake。
- 接受“宠物是声明式数据包，不是插件”的 ADR。

实现记录：`src/shared/pet-package.ts` 固定 `draft-0` 限额、语义动作和判别错误；`src/main/pet/pet-package-preflight.ts` 使用流式 ZIP reader 在安装前检查路径、条目类型、数量、压缩/展开预算、manifest 严格 schema、规范化清单、内容哈希、缩略图格式/像素上限与禁止载荷；`src/shared/pet-library.ts` 固定无路径命令、revision 冲突和 built-in 不可删除语义。hostile/golden archive 由单元测试确定性生成，不作为可被产品代码误装的仓库资产。

退出条件：所有路径、archive、schema、hash、限额和命令边界可由单元测试确定重放。

### Phase 6B：资产库、设置页与开发态 Envelope Preflight

状态：**已完成；不需要最终角色素材**。

- 实现内置资产与索引使用的 PetStore/PetLibrary，以及系统文件选择器、同卷 staging、通用 envelope preflight 和独立开发态 Pet Import Inbox。
- 通过 `settings.section` 增加中英文宠物资产页和 metadata-only Harness bridge。
- 内置资产的选择/不可删除/重启恢复/损坏回退，以及导入取消、通用拒绝和“已进入开发 Inbox、等待 runtime 验证”完成 E2E。
- Phase 6B 当时在 player 尚未冻结时只显示静态缩略图；该临时状态已被 Phase 6D 的内置开发预览替代。
- 通过 preflight 的 draft archive 只原子密封到独立 dev Inbox/namespace，不安装到 Pet Library、不标记为 ready、不读取动画 payload；它只在开发 capability 下可见，不向公开版本开放，也不得自动迁移到正式 Pet Library。

实现记录：应用自有 `pets/` 目录具备原子 `library.json`、revision 串行化、内置资产不可删除语义与独立 `dev-inbox/`；Inbox 使用同卷 staging、文件 `fsync` 和原子 rename，只恢复有界元数据。Harness preload 提供 metadata-only Pet Library bridge，设置页通过官方 `settings.section` 提供中英文“宠物”资产页、启用开关、资产状态与开发 Inbox。开发构建可由主进程系统选择器导入，公开打包默认 `canImport=false`；通用 preflight 失败、用户取消和读取异常均返回有界结果。`dsh-pet://thumbnail/<id>/<revision>` 只命中主进程预注册文件，拒绝查询、穿越、软链接、错误 MIME、超尺寸和未知 revision；内置开发预览缩略图与 `.yukipet` 随签名应用交付，后者仍须启动时完成深层 preparation 才进入 ready。React 主世界缓存桥保证 `useSyncExternalStore` 快照身份稳定；真实 arm64 打包 E2E 已验证宠物页、缩略图、隔离 Player Canvas 和生产导入禁用状态。

退出条件：通用 archive/envelope 威胁全部 fail-closed；引擎专属 payload 明确保持 quarantined/unknown 而非伪装为已验证；设置页不能读取路径或 payload，资产管理不影响 Harness。

### Phase 6C：右栏尺寸与 Pet Stage 空壳

状态：**已完成；不需要最终角色素材**。

- 把 `open` 与 `preferredWidth` 分离，增加 min/max clamp 和 resize intent。
- 完成 docked/overlay/Review Focus 纯布局矩阵、pointer/keyboard separator 和持久化。
- 增加无动画的 Pet Stage 容器、裁剪、气泡层和启用/禁用降级。

实现记录：`DesktopCompanionSnapshot` 已拆分 `open` 与 `preferredWidth`，共享 solver 统一 340/380/560px token 和 docked/overlay/Review Focus 动态上限；主进程仅在 toggle/resize-end 原子保存 `desktop.json`。本地 shell 提供 8px `role=separator`，支持指针 capture、方向键、Shift 步进、双击复位和 ARIA 范围；拖动实时更新 bounds 而不走开关动画。Pet Stage 只消费 metadata-only 快照并显示签名静态缩略图，使用 `overflow: clip`/contain、独立 DOM 气泡层和底部状态文案，不加载任何动画 payload。单元测试覆盖 clamp、100 次状态循环和偏好恢复；真实 arm64 E2E 覆盖最小宽度不关闭、开关恢复、Stage 缩略图、真实 pointer 380→460→340px，以及 600/720/900px 下 200/200/260px Stage 与 220px 文件区下限。应用的 600px 最小窗口高度保证当前布局无需进入低于文件区下限的不可用状态。

退出条件：最小宽度不能继续缩小且不会关闭；右上 toggle 可完全隐藏；重新打开恢复宽度；文件区始终可用。

### Phase 6D：连续动画技术验证与 v1 Release Candidate

状态：**进行中，已按 creator-first 原则纠偏；不等待最终角色素材**。

- 先用统一的角色参考图与自然语言要求实现 Authoring PoC；未通过 Creator Gate 的格式不进入 packaged benchmark。
- 优先验证透明 WebM 动作包与高密度序列帧的自动生成、身份 QA、过渡补全和 `.yukipet` 打包；dotLottie 在无头生成人物动作可行后进入，Rive 暂停。
- 对通过 Creator Gate 的候选在 packaged arm64 Electron 中做同指标播放 spike。
- 测量视觉质量、frame-time、CPU/GPU、内存、包体、隐藏暂停、恢复、离线、CSP、许可和制作流程。
- 只选择一个 production runtime candidate，删除未选候选的实验代码和依赖。
- 为唯一候选实现版本固定的深层 parser、语义/bounds probe 与完整 `PetPackageValidator`；只有全量验证通过的 Inbox 条目才可原子晋升到 dev Pet Library，并覆盖 hostile payload 与 player load/dispose E2E。

当前实现记录：候选比较口径位于 `src/shared/pet-runtime-evaluation.ts`。本次纠偏把 `creatorInputContract`、`headlessSkillGeneration` 与 `zeroExtraCredentials` 设为一票否决门，与 packaged arm64、完全离线、加载前深验、专用 Player 隔离、语义重放、生命周期稳定、reduced-motion、分发许可和制作记录并列。只有全部通过的候选才按自然度、frame-time、资源稳定、包体和通过硬门后的相对制作效率排序；领先差小于 2 分只标记“需要人工复核”，不自动选型。`pnpm pet:spike` 已显示新增硬门，unknown 不会被当作 pass。

Creator-first Module 已开始落地：`src/shared/pet-authoring.ts` 把公开输入限制为参考图元数据与自然语言，拒绝引擎文件字段；`PetAuthoringWorkflow` 校验每份参考图实际字节、大小和 SHA-256，向候选 Adapter 只传内存副本，并将 Adapter 输出重新送入现有 `.yukipet` preflight。只有零用户引擎资产、零专有编辑器、零手工编辑步骤、零额外第三方凭据、九类动作完整且 identity/透明边缘/bounds/transition QA 全部过门时，才生成可进入后续 benchmark 的 evidence。当前只注册透明 WebM 与高密度序列帧为 Authoring PoC 候选，尚未宣称任何候选通过。

高密度序列帧候选已接入首个端到端 Adapter 骨架：`FrameSequenceGenerator` 是唯一生成 Port，接收上述内存 Creator Input；`FrameSequenceAuthoringAdapter` 负责验证九类 motion atlas 的唯一性、实际图片尺寸、grid、帧数、时长与 QA，并自动生成 timeline、manifest、inventory、SHA-256 和确定性 stored ZIP。产物随后再次经过正式 package preflight，缺动作、重复动作、尺寸不符、非法缩略图或超限包都会 fail-closed。当前测试生成器只证明 Module/打包/导入链闭合，尚未提供真实角色生成能力，因此 `headlessSkillGeneration` 仍保持 unknown，不得把该骨架计为 Creator Gate 已通过。

生成与视觉验收是两个独立内部 seam：`FrameSequenceGenerator` 只能返回缩略图和动作图集，不能携带 QA 结论；独立的 `FrameSequenceVisualQa` Adapter 接收 Creator Input、参考图内存副本和已经完成结构校验的 generation 副本，再返回 identity、透明边缘、Stage bounds 与 transition continuity 证据。QA 证据必须同时绑定本次 Creator Input SHA-256、本次 generation 确定性指纹以及 evaluator 的版本化身份；旧 generation、其他角色或来源不明的证据一律拒绝。QA Adapter 即使修改收到的字节，也不能改变随后进入正式 preflight 的原始生成结果。`PetAuthoringWorkflow` 仍是调用者唯一 Interface，并在最后统一执行 Creator Gate。测试分别替换生成与 QA Adapter，验证生成器无法自我批准、陈旧证据不能重放、QA 不能篡改最终包；真实生成和真实视觉 QA Adapter 均未接入前，候选状态保持 unknown。

长时间生成对用户只暴露四段稳定进度：准备角色、确定主形象、生成动作、孵化打包。内部九类动作可以逐项上报完成，但不暴露模型、临时路径、prompt、重试或编辑器概念；百分比由 `PetAuthoringProgressTracker` 统一计算并保持单调，Adapter 不能自行伪造 100%。成功、失败和取消都有唯一终态，观察者抛错不会改变制作结果。生成器与视觉 QA 分别获得独立 Creator Input/参考图字节副本，QA 不持有进度控制能力，避免生成器修改参考图后影响独立验收。该进度契约后续可直接供设置页或 Phase 7 Skill 消费，而不把内部 Visual Job Graph 变成用户学习成本。

`FrameSequenceGenerationOrchestrator` 已把真实模型调用前的复杂度收进单一内部 Module：先生成 canonical main look 作为身份锚点，再以最多三个并发作业生成 standing、drowsy、lying-down、sleeping、waking、rubbing-eyes、work-enter、eating、work-exit 九类独立动作。每个作业接收用户自然语言、原始参考图的独立副本、canonical look 的独立副本和固定动作语义/60fps/时长/192×208 cell 约束；最终 1,320 帧保持在 Player 的 1,440 帧硬预算内。瞬时失败最多重试一次，策略拒绝、非法请求和非法输出不重试；用户取消或任一动作失败会停止尚未开始的作业。并发完成顺序不会改变最终语义顺序，Backend 的安全 id/version 会进入 generation 指纹并与 QA 证据绑定。生产模型、本地模型和测试 fake 只需替换 `PetVisualGenerationBackend` Adapter，调用者仍只使用 `PetAuthoringWorkflow`。

首个真实远端动作源探针采用 [Runway Gen‑4.5 图生视频](https://docs.dev.runwayml.com/api/)，而不采用官方已标记 [Legacy 的 Sora 2](https://developers.openai.com/api/docs/models/sora-2)。`RunwayPetVideoAdapter` 固定 `X-Runway-Version: 2024-11-06`、`gen4.5` 和方形 960×960 图生视频，以 canonical look 的本地字节 Data URI 和不超过 1,000 UTF-16 code units 的动作 prompt 创建 2–10 秒任务；按 [Runway task 指南](https://docs.dev.runwayml.com/api-details/sdks/) 要求不快于 5 秒轮询，支持 PENDING/RUNNING/THROTTLED、取消和 10 分钟有界超时。输出只接受单一无凭据 HTTPS URL、`video/mp4` 和 64 MiB 上限，下载完成或失败后 best-effort 删除远端任务；429/5xx 才作为可重试瞬时错误，`SAFETY.*` 明确成为不可重试策略拒绝。Adapter 不读取 DeepSeek 凭据、不进入公开应用默认路径，也不会仅因存在代码就发出网络请求或计费。Runway 输出不带可直接信任的透明通道，因此它只能提供 motion clip；必须经过下一步本地确定性解码、绿幕/alpha 清理、60fps 重采样和 atlas QA 后才能满足 `PetVisualGenerationBackend`，当前不能计为 Creator Gate 通过。

`ClipBasedPetVisualBackend` 已把 `PetMainLookAdapter`、`PetMotionClipAdapter` 与 `PetMotionClipRasterizer` 封装成单一深 Module；三者的安全 id/version 会形成稳定 pipeline 指纹，随后继续进入 generation 与视觉 QA 指纹，调用者不感知供应商、视频或 chroma-key 细节。Backend 只接受一个 canonical look、最长 10 秒且不超过 64 MiB 的 MP4，并要求 rasterizer 返回与动作规格完全一致的 atlas 和可验证证据。证据必须证明至少 90% 目标帧是真实不同帧，透明边缘、跨帧定位和活动区边界全部通过；把 24/30fps 画面机械复制成 60fps 会 fail closed。尚未实现的部分被收窄为无 preload、无网络的独立 media worker：它负责 Chromium 本地解码、绿幕转 alpha、稳定缩放/基线、编码和逐帧证据，不能在 shell 或 PetPlayer 展示 realm 中处理不可信视频。

转换算法本身已先从浏览器承载层中拆出并完成确定性测试：固定绿色背景使用软阈值转 alpha，半透明边缘同步抑制绿色溢色；纯背景、畸形尺寸和超限帧均拒绝。布局采用两遍策略，第一遍只收集所有帧的前景 bounds，再对全片 union bounds 计算一次裁切、缩放和底部 baseline；第二遍所有帧复用同一 transform 写入 192×208 cell。禁止逐帧自适应裁切，因为它会制造肉眼可见的缩放呼吸和站位跳动。media worker 只负责受限视频解码、调用该纯算法和 PNG/WebP 编码，不得另行实现一套视觉规则。

`browser-motion-rasterizer` 已实现 media worker 内部执行体：MP4 只以内存 `Blob` URL 交给 Chromium，源视频限制为最长 10.5 秒、单边不超过 2048px，输出 atlas 限制为 16M pixels；完整时间轴被单调映射成目标帧且末帧不会越过 duration。第一遍对去背景后的每帧计算 SHA-256，因此解码器反复返回同一源帧会反映为较低 `uniqueFrameCount`，不能用插值时间戳掩盖；第二遍才分配 atlas 并编码透明 PNG。无论成功、失败或取消，都会暂停并断开 video、撤销 object URL、把两个 canvas 归零释放内存。该执行体已由独立 Vite entry、单用途 bootstrap preload 和每作业销毁的隐藏 realm 承载，不具备 IPC、文件或网络能力。

独立承载层现已实现。`ChromiumPetMotionRasterizer` 每个动作创建一个不可见、无父页面、无 Node、非持久随机 partition 的 BrowserWindow；专用 bootstrap preload 只接收一次主进程转交的 MessagePort，不向 main world 暴露 Electron API。renderer 只接受一个带 realm epoch 与 job generation 的 `rasterize`，只可返回一个有界 `result/failure`；主进程还验证 nonce、精确字段集合、64 MiB clip/atlas 上限和动作规格。session 拒绝权限、下载、弹窗、跨入口导航和非入口资源请求，90 秒 watchdog 位于 main，即使视频解码或 Canvas 卡死也会从外部 destroy realm。成功、失败、取消、端口关闭与 render-process-gone 都走同一清理路径。独立 Vite production entry 已构建通过；下一门是用本地确定性 MP4 fixture 在打包 Electron 中完成真正解码往返，而不是用 Node fake 代替 Chromium codec 验证。

该真实媒体门已通过。专用 `--pet-media-worker-smoke-test` 在打包 arm64 App 内使用 Chromium 150 Canvas/MediaRecorder 离线生成 120-frame 绿幕 H.264 MP4，再调用正式 `ChromiumPetMotionRasterizer`；最新实测输入 13,356 bytes、输出透明 PNG atlas 469,151 bytes，90 个目标帧中 85 个 SHA-256 不同，三项 rasterization QA 全部 pass。测试发现并修复了三个只会在真机链路出现的问题：录制窗口过早销毁会使 OpenH264 以 139 退出；smoke Promise 拒绝原先会误报 exit 0；Electron 43 从 renderer 向 MessagePortMain transfer ArrayBuffer 会丢弃结果 payload。最终实现保留 64 MiB 上限但采用结构化复制，并由 marker + 非零失败退出码提供发布门禁。

`IndependentFrameSequenceVisualQa` 已实现独立 QA 的主流程与客观部分。每个 atlas 必须由版本化 `PetAtlasFrameDecoder` 解成精确 192×208 RGBA cells；逐帧计算 alpha 前景、边缘接触、4px Stage 安全留白、质心、面积和归一化像素差。所有相邻帧都受质心步幅、面积突变和像素突变上限约束，standing/sleeping/eating 还检查末帧→首帧的严格 loop closure；空白帧必然使 bounds 与 continuity 失败。身份一致性没有用这些像素启发式代替，而是从每个动作确定性抽取至多五帧，交给另一个版本化 `PetIdentityEvaluationAdapter` 与原始角色参考图比较。decoder、身份模型和 objective-v1 共同形成 evaluator 指纹，返回证据继续绑定 Creator Input SHA-256 与 generation SHA-256。`ChromiumPetMotionRasterizer` 已同时实现 decoder Adapter：共享同一个隔离 media worker 生命周期，但使用独立判别作业；协议限制 PNG/WebP、固定 192×208 cell、最多 240 帧和 38.3 MiB RGBA，浏览器确认实际图片尺寸后按 row-major 解码，主进程再复制成彼此不共享的帧。打包 smoke 已完成 `MP4 → PNG atlas → 90 RGBA frames` 真机往返。

2026-08-20 产品复核否决了“用户配置 Runway/OpenAI Key”的制作路径。`extraProviderCredentialRequired:false` 与 runtime 的 `zeroExtraCredentials` 现为一票否决门：正式应用和未来 Pet Authoring Skill 的公开 Interface 只能接收角色参考图、自然语言和无敏感性的显示元数据，不得出现第三方 Key、模型账号、计费项目或专业动画资产。此前的 `createCreatorFirstPetAuthoringAdapter` 组合工厂已删除，避免 key-based 探针被误注册为生产制作 Adapter。

`RunwayPetVideoAdapter` 与 `OpenAiPetIdentityAdapter` 仅保留为隔离媒体转换和 QA contract 的开发研究探针；它们能证明 Module seam、输入输出门禁和真机解码，但需要额外凭据，所以不能获得 `zeroExtraCredentials`/Creator Gate pass，也不能决定 runtime。正式候选改为两条零额外 Key 路径：第一，应用内本地制作 Module 从普通角色图生成/装配声明式层、连续插值 motion 和包；第二，Phase 7 Pet Authoring Skill 使用宿主已经提供的图像能力完成素材生成、分层、动作构建和验证，用户不再配置任何模型供应商 Key。两条路径都必须产出同一个开放 `.yukipet` 数据包并经过相同 validator；若本地自动制作达不到动作质量，保持 Phase 6D 未通过，不能回退到要求用户购买或配置第三方服务。

仓库内现已建立实验性 `skills/yukiryou-pet-authoring/`，用于在 Phase 6D 提前验证真实 Creator 体验，而不是提前发布 Phase 7。它复用 Codex 宿主提供的 `imagegen`，公开输入仍只有一张主参考图、可选补充图和自然语言；宿主图像能力不可用时必须停止，禁止转向要求用户配置 Key 的 fallback。Skill 的机器可读动作契约由测试与应用九类 60fps motion spec 对齐，稀疏姿势、重复帧和简单 alpha cross-fade 不能作为合格产物。只有它实际生成官方宠物、通过 Creator Gate 和产品验收后，才可按 Phase 7 条件整理为公开 Skill。

零额外 Key 的首个本地密集动画候选现已落地为 Apple Vision Optical Flow Revision 1 工具链。Skill 内部生成的透明关键姿势由本地工具进行双向光流形变和亚像素采样，自动输出动作要求的全部帧、16 列 PNG atlas 与版本化 synthesis evidence；用户不接触关键姿势、编译命令或动画参数。确定性冒烟已验证透明平移的 9 帧连续性，完整流水线已验证 `standing` 的 240 帧与 3072×3120 atlas。该结果仅证明零 Key 技术链闭合，不等于正式角色达到产品视觉门；角色面部、肢体、头发/尾巴次级运动和所有状态过渡仍须 Creator Gate 与产品验收。Objective QA 现同时检查最小时间密度，静态帧复制即使名义上标记为 60fps 也会失败。

正式角色试制进一步缩小了该候选的适用范围：`standing` 的眨眼/呼吸 240 帧通过人工抽检，但 `drowsy` 的抱臂→垂手在两次不同密度关键姿势实验中均产生手臂、头饰和鲸尾重影，已按 Creator Gate 归档为失败证据。随后试制的自动分层 Canvas2D rig 虽能连续插值，但正式角色出现明显的零件拼装感与侧栏重开后的错位，产品验收不通过；该候选不得接入内置宠物。新的正式角色路径只使用完整角色姿态：大动作先生成足够密集且身份一致的完整人物中间姿态，相邻姿态通过轮廓与解剖门后才允许密集补帧。用户仍不制作关键帧、图层或骨骼。

分层候选的 runtime、validator 与安全隔离代码仅作为失败实验保留，不再代表产品选型。正式角色重新使用 `frame-sequence-canvas2d` 的统一 `load/present/dispose` Interface：每个展示帧都是完整角色，不在运行时拼装身体部件；Player 仍按 elapsed time 取样，隐藏时停止调度，换包或销毁释放全部 ImageBitmap。新的制作门要求九类 motion 的首尾依赖、完整人物姿态密度、相邻帧解剖连续性和侧栏隐藏/重开视觉回归全部通过，才允许替换当前开发预览包。

正式参考图的自动分层实验已经结束：虽然 12 部件 rig declaration 能通过结构 validator，但真实侧栏出现明显的零件拼装感和重开错位，产品验收不通过，因此不得再作为内置候选。替代路径已经从同一角色参考生成九段完整人物姿态族，并用单向轮廓形变补成密集完整帧；运行时每一帧都是完整角色，不做身体部件组装。生成底稿保留 60fps/1,320 帧，开发包按 30 个独立画面/秒交付 660 帧并由 60Hz rAF 播放；编码器逐格复核非空与相邻帧变化，打包器再校验尺寸、grid、帧数和时长。内置包以“开发预览”进入 Pet Library，仍需对完整姿态的解剖连续性、边缘形变、状态衔接和长时间自然度做人工慢放验收，在 Creator Gate 与产品批准前不能称为官方宠物完成。

主进程的 frame-sequence 深层 preparation 与隔离播放链已经接通：它只接受精确的 `frame-sequence-canvas2d` Adapter 与 `frame-sequence-atlas v1`，在任何字节进入 Player 前解析 timeline、复核九类 motion 路径与 inventory、比对图片实际尺寸，并限制单动作 frame/grid、整包 64 MP decoded pixels 与 1,440 帧预算。验证结果被编码成无路径、无 ZIP、无任意 JSON 的版本化 `YKFS0001` 内部 bundle，复用 SHA-256、一次性 MessagePort、generation 和 watchdog 边界交给专用 Player。Canvas2D Adapter 启动时只解码并复核 standing 图集，其他动作首次进入时按需解码，切换成功即释放上一张 ImageBitmap；按真实 rAF elapsed time 计算展示帧，隐藏时取消调度，reduced-motion 只画 standing 静态帧。真实 arm64 smoke 测得 ready 4,925ms，因此外部 watchdog 保持有界但由 5 秒调整为 10 秒。正式 runtime validator/probe 现已能接受该候选，但这只证明播放链闭合；动作自然度与 Creator Gate 继续保持未通过。

专用 Player 的隔离载体与有界通信已形成，并已接入首个候选 Adapter：`PetPlayerRealm` 对调用者只暴露 `start/present/dispose`，内部固定独立非持久 partition、`sandbox/contextIsolation/webSecurity`、零 Workspace bridge、拒绝权限/下载/新窗口/非入口导航，并在 packaged `file:` 模式只允许签名 player 目录内资源；开发态只允许同一个 loopback origin。专用 renderer 和严格 CSP 已进入 Forge 构建；签名 preload 不暴露全局 API，只接受主进程一次性移交的 `MessagePort`。每次 realm 使用随机 128-bit epoch/nonce 完成 5 秒 hello 握手，导航、崩溃、超时和 dispose 都从 realm 外部撤销旧端口。协议严格校验 exact-key schema、pet/presentation generation、16 KiB 单消息、128 KiB/s 总预算，以及 heartbeat/metrics/marker/activation 的独立频率；播放器以真实 `requestAnimationFrame` 时间戳按实测刷新周期上报 P95/P99、超过两倍周期比例、连续掉帧和 Long Task，隐藏 Stage 后停止采样。Player 不在窗口创建时预热；只有已验证的 ready 资产被选中时才惰性创建，完全隐藏会停止呈现与帧采样，停用或切换资产会销毁 realm。开发预览默认启用，因此 Beta 正常进入 Harness 后会创建第三个隔离 renderer；E2E 已改用精确 `/main_window/` 与 `/pet_player/` 身份识别，不再依赖“所有 file: 页面都是 toolbar”的旧假设，并验证退出清理。

客观 benchmark 使用独立、严格版本化的 evidence contract，固定候选实现、打包应用与 Electron 版本、arm64 环境、canonical 场景、Creator Input SHA-256、viewport、预热/采样时长和切换次数；各候选成品分别记录自己的 Pet Asset SHA-256，不错误要求不同格式二进制相同。每条记录必须包含真实 frame-time、CPU、隐藏 CPU、内存、Long Task、网络与生命周期试次；缺失字段、未知字段、路径/私密字段或跨候选口径不一致都会 fail-closed。自动汇总只产生可测量指标以及 `packagedArm64/offline/lifecycleStability` 三项客观门禁，不根据这些数据虚构自然度、制作效率、工具成本或 Skill 自动化分数。出现任何网络请求、崩溃、watchdog 重启、Player 自报 runtime failure 或切换次数不足时，该记录不得自动进入评分卡。

`PetRuntimeTrialRecorder` 已把 guarded Player `metrics/failure`、可见与隐藏 process samples、远程请求观测、切换、崩溃和 watchdog 收敛为单一 trial Module。分段帧数据按总采样窗口、实测刷新周期中位数和最坏 P95/P99/丢帧值聚合；CPU 使用分区均值，内存保留峰值和首尾变化，Long Task 累加。帧、可见 CPU、隐藏 CPU或完整网络观测任一缺失时只返回 `incomplete`，绝不补零或写入 evidence。该模块只负责确定性记录，下一步由 packaged benchmark runner 提供真实 process/network samples 和动作脚本调度。

Rive Canvas Lite 是首个接入统一 seam 的技术探针，但不是已选 production runtime。Spike 固定 `@rive-app/canvas-lite@2.40.0`，Adapter 的外部 Interface 只有 `load/present/dispose`；Rive 的状态机、WASM、暂停和清理留在实现内部。该实现已经证明专用 realm、一次性资产交付、双端 SHA-256、CSP、离线 WASM、隐藏暂停和 cleanup seam 可工作，因此保留为基础设施回归探针；但它无法证明普通用户能从 Creator Input 生成 `.riv`，`headlessSkillGeneration` 必须保持 unknown/fail，禁止继续把“找一份 `.riv`”当作 Phase 6D 下一步。若开放候选通过门禁，PetPlayer Interface 可以替换内部 Adapter，而调用者和用户输入契约不变。

开发导入的深层验证复用同一个隔离边界。当前 `PetRuntimeValidator` 的 Rive 实现只是第一个内部 Adapter：它验证精确 runtime envelope、隔离加载和超时，并把结果写入开发 Inbox，但仍不安装到 Pet Library、不产生 ready 资产。Phase 6D 选出 creator-first 候选后必须替换为该格式的深层 parser/probe；外部 Module Interface、Inbox 语义和安全链保持不变，不能让 Rive 专属字段扩散为用户 Interface。

arm64 Forge 还增加了不修改 `resources/runtime` 的干净打包镜像：只排除“同目录存在规范同名文件”的 macOS 编号冲突副本，其他文件、符号链接和权限语义均保留。当前真机输入保留 33,788 个文件与 13 个符号链接，排除 689 个冲突副本；完整 `.app` 打包和 3 项 packaged E2E 均通过。这个处理只修复构建输入污染，不改变 Runtime 或宠物格式。

- 产出 `.yukipet v1-rc`、player contract RC、硬限制 RC、第三方 notices 和 proposed animation runtime ADR；不开放公共导入兼容承诺。

退出条件：满足全部 runtime 入选门，失败则回到 spike；进入 6E 仍允许因正式角色不满意而修改或淘汰 candidate，不以稀疏姿势轮播作为临时上线方案。

启动时延复测修正（2026-08-20）：打包后冷启动 ready 为 13,123ms，稳定复跑为 6,407ms；前文 10 秒是中间实验值，最终生产启动 watchdog 为有界 20 秒，自动 smoke 仍要求 15 秒内 ready。

### Phase 6E：官方宠物制作与产品验收

状态：**正式主参考与动作需求已收到；6D 候选须先通过真实角色 parts 与动作验收**。

- 产品所有者提供 canonical full-body、角色设定、表情和不可变化清单；更多视角或分层源文件是可选质量增强项。
- 使用 Phase 6D 已通过 Creator Gate 的同一受支持制作流程生成官方宠物；允许人工精修，但必须记录为可选层，不能让用户最低路径依赖专业编辑器。
- 集成 PetDirector、running activity、用户唤醒、DOM 气泡与 renderer recovery。
- 完成视觉、性能、稳定性、安全、打包、签名和公证门禁。
- 根据正式宠物迭代 v1-rc；只有产品所有者明确满意后才冻结 `.yukipet v1`、接受 animation runtime ADR、迁移到正式 Pet Store 并开放用户导入。

退出条件：产品所有者认可角色身份和动作自然度；非动画专业用户已通过同一流程生成另一只可导入宠物；所有自动/人工门禁通过；宠物失败隔离得到验证；`.yukipet v1` 和唯一 production player 此时才形成兼容承诺。

### Phase 7：Pet Authoring Skill

状态：**Phase 6D 先完成 Authoring PoC；Phase 6E/v1 稳定后再把它产品化交付**。

Skill v1 的职责：

- 只向用户请求角色参考图和自然语言动作偏好；必要时解释需要补充哪种参考，而不要求引擎知识。
- 在 Skill 内部调用已验证的生成、转码、状态映射和 QA Module，隐藏命名、marker 与动画格式。
- 自动执行 identity、bounds、anchor、循环、动作完整性、透明边缘和包体检查，并对失败给出可操作反馈。
- 组装 `.yukipet`、缩略图、license/source 元数据、hash、预览和 QA 报告。
- 直接调用应用发布的同一 validator Module/CLI，并锁定 schema、adapter 和 asset-format 版本；fixtures 只用于回归测试，不能替代共享实现。
- 每个 Skill 产物都在 packaged app 中执行一次真实导入 round-trip，成功后才交付。

Skill v1 不允许把专有编辑器操作、rig、状态机或 runtime 导出留给用户。若某候选无法被 Skill 无头生成，它必须在 Phase 6D 被淘汰，而不是把限制写进用户说明。单张参考图可能无法达到官方宠物同等质量，此时 Skill 可以请求更多视角或表情参考并清楚展示 QA 差异，但仍由项目流程完成技术制作。

## 测试矩阵

| 层级 | Pet Library/Package | Layout/Stage | Director/Player |
| --- | --- | --- | --- |
| Module | schema、hash、重复、迁移、内置不可删、active fallback | min/max clamp、open 独立、跨阈值、宽度恢复 | fake clock/random、generation、marker、快速 run/idle |
| 本地集成 | 系统选择器 Adapter、staging、原子 rename、权限、崩溃恢复 | bounds command 合并、renderer reload | 离线加载、dispose、隐藏暂停、坏 payload |
| Electron E2E | 中英文设置、导入取消、选择、删除、重启恢复 | 指针/键盘 resize、最小值、完全隐藏、文件区可用 | wake、sleep/run、bubble、reduced motion |
| 发布安全 | hostile ZIP、路径、link、future schema、remote/script 拒绝 | Harness 不得见动画字节/路径 | 专用 session/CSP/无网络/无 Node；port 握手、大小/速率、epoch/generation 与导航撤销；player crash 只重建该 view |
| 人工真机 | 资产说明清晰、许可可见 | 340/380/560px 与 820/980/1320px 矩阵 | 1x/0.25x/慢放、30 分钟录屏、自然度与身份 QA |

hostile fixtures 至少包含 Zip Slip、压缩炸弹、重复/大小写冲突路径、NFD/NFC 冲突、symlink/hardlink、无效 UTF-8、假 MIME、超大缩略图、hash 不符、未知 runtime/asset format、未来 schema、缺动作、remote asset、脚本动作和故意超时 payload。

## 风险登记

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 过早冻结引擎/格式 | 用户生态、包格式和 Skill 被错误路径锁死 | 6D 只产出 RC/proposed ADR；6E 正式宠物满意后才冻结 v1 |
| 专业工具成本转嫁给用户 | 自定义宠物只能由动画师制作，违背产品目标 | Creator Input/无头 Skill 生成是一票否决门；先 Authoring PoC，后 runtime benchmark |
| 动画看似 60fps 但机械/跳形 | 达不到“像真正宠物”的产品要求 | 时间连续 + 完整过渡 + 次级运动 + 人工慢放验收 |
| 用户包含恶意 archive/脚本 | 路径逃逸、执行、DoS | 声明式 allowlist、staging、限制、隔离 probe、无网络/Node |
| 角色动作间身份漂移 | 视觉割裂 | canonical source、同一 rig/工程、identity checklist |
| 持续动画耗电或泄漏 | 主体验变差 | 单实例、离屏停止、只解码 active、长期 profile |
| 编辑器许可或导出付费 | 用户制作门槛与分发风险 | 强制专有编辑器或付费导出的候选直接淘汰；专业工具只允许作为可选精修 |
| 侧栏拖拽与隐藏混为一体 | 面板意外关闭、难恢复 | `open`/width 分离，拖拽绝不写 open |
| 设置页获得高权限 | Harness renderer 读取本地文件 | metadata-only bridge、main 选择器、opaque id、无 payload |

## 明确拒绝的方案

- 不把当前 Codex 8×11/少量姿势 spritesheet 直接作为 production 动画方案。
- 不逐帧独立生成角色图后用高刷新率掩盖身份漂移。
- 不让拖动到 0px 代表关闭；完全隐藏必须是独立命令。
- 不让 Pet Package 携带 JS/HTML、插件、任意状态机或远程资源。
- 不在 Harness settings renderer 中运行第三方动画或暴露动画字节。
- 不使用 `file://` 或 browser 提供的绝对路径读取用户包。
- 不同时维护 Rive、dotLottie、WebM 等多个 production player。
- 不要求普通用户提供 `.riv`、Lottie 工程、透明视频、序列帧、rig 或状态机；这些都是制作流程的输出或内部实现。
- 不在 Phase 6D 完成 Authoring PoC 前冻结 runtime；不在官方宠物和 v1 尚未稳定时公开发布尚未定型的 Skill。
- 不用无法验证的“高帧率”数字代替自然度、过渡、identity 和耗电验收。

## 完成定义

Phase 6 完成必须同时满足：

1. 设置中的宠物资产库可以安全管理内置和用户宠物，且视觉与 Harness 一致。
2. `.yukipet v1`、唯一 production player、许可和第三方 notices 已冻结。
3. Companion 可见最小宽度、单向拖拽、独立完全隐藏和宽度恢复完全符合需求。
4. Pet Stage 与文件区共存，所有角色、粒子和气泡都不越界。
5. standing/blink/drowsy/lie-down/sleep/wake/rub-eyes/work-enter/eating/work-exit 全部自然、连续且可确定重放。
6. 用户导入包的 archive、schema、MIME、hash、engine、动作和资源限制全部 fail-closed。
7. 隐藏暂停、reduced motion、renderer/runtime 恢复、系统睡眠和切换宠物不泄漏资源。
8. 自动测试、打包真机指标、视觉 QA、签名、公证和故障隔离全部通过。
9. 产品所有者明确认可官方宠物形象稳定、动作自然且“有生命力”。
10. 非动画专业用户只用角色参考图和自然语言要求完成一次端到端制作、验证、打包和导入；过程中不接触底层 runtime 或专有编辑器。

Phase 7 的产品化交付只有在上述条件满足且 v1 经至少一个公开版本验证后才完成；其底层 Authoring PoC 必须在 Phase 6D runtime 选型前已经通过。

## 实施前用户需要提供什么

Phase 6A–6D **不需要用户提供正式角色素材或任何动画工程**。进入 Phase 6E 时，最低 Creator Input 是：

- 一张身份最准确的透明全身主参考，完整包含脚、头发、服装和尾巴；建议至少 3000×3000。
- 一段自然语言说明：角色不能变化的特征、动作性格、允许夸张到什么程度。
- 角色和素材的权利/许可信息。

正面/3/4/侧面、表情参考以及 PSD/Clip Studio 分层文件都属于可选质量增强项。若只有扁平主图，Supported Authoring Workflow 负责分层、动作生成、转码和打包；若自动 QA 认为身份一致性不足，应请求补充具体参考，而不是要求用户学习 rig 或编辑器。

## 技术参考

- Rive bones/meshes/state machines/interpolation: [Bones](https://rive.app/docs/editor/manipulating-shapes/bones), [Meshes](https://rive.app/docs/editor/manipulating-shapes/meshes), [State machines](https://rive.app/docs/runtimes/state-machines), [Interpolation](https://rive.app/docs/editor/animate-mode/interpolation-easing)
- Rive Web offline/runtime loading and renderer choices: [Web runtime](https://rive.app/docs/runtimes/web/web-js), [Runtime parameters](https://rive.app/docs/runtimes/web/rive-parameters), [Preloading WASM](https://rive.app/docs/runtimes/web/preloading-wasm), [Canvas vs WebGL](https://rive.app/docs/runtimes/web/canvas-vs-webgl)
- Rive export/pricing constraints: [Exporting for runtime](https://rive.app/docs/editor/exporting/exporting-for-runtime), [Pricing](https://rive.app/docs/account-admin/pricing)
- dotLottie v2 and runtime: [dotLottie v2 specification](https://dotlottie.io/spec/2.0/), [dotlottie-web](https://github.com/LottieFiles/dotlottie-web), [state-machine security policy](https://github.com/LottieFiles/dotlottie-web/wiki/State-Machines)
- Transparent WebM in Chromium: [Alpha transparency in Chrome video](https://developer.chrome.com/blog/alpha-transparency-in-chrome-video)
- Commercial-runtime review: [Live2D Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/), [Spine Editor License](https://esotericsoftware.com/spine-editor-license), [Spine versioning](https://esotericsoftware.com/spine-versioning)
- Electron local protocol/security: [protocol](https://www.electronjs.org/docs/latest/api/protocol), [security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
