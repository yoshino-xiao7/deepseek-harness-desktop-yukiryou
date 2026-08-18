---
status: accepted
implementation: in-progress
updated: 2026-08-18
---

# Desktop Companion 完整实现方案

## 文档目的

本文冻结下一阶段的产品语义、架构 seam、Module Interface、安全约束、实施顺序与验收门。后续开发以本文为主计划，每个阶段仍需在同一 PR 中同步当前架构、安全模型、测试说明和实现状态。

本文同时记录已接受的目标设计与分阶段实现状态；只有明确标为“已实现”的条目才描述当前能力。

## 已确认的产品决定

1. Harness 左侧栏“设置”上方只显示**当前凭据所属账户余额**，不显示今日消费，不把账户余额称为“Key 余额”。
2. Desktop Shell 增加可展开的 Desktop Companion：上层最终为宠物活动区，下层为变更、文件树和预览入口。
3. 文件、Git 变更和预览先实现；宠物功能最后实现，素材阶段由产品所有者补充角色设定与分层资源。
4. 第一版变更语义是“当前工作区相对 HEAD 的变更”。没有可靠证据时，不得写成“本轮编辑”。
5. Markdown 默认渲染为安全的排版预览，同时提供“源码”切换；不得只显示原始 Markdown 代码。
6. Workspace Review 第一版完全只读，不提供保存、删除、撤销、stage、commit 或自动修复。
7. 核心功能不依赖 Harness DOM selector、按钮文案、加载图标或页面结构猜测。

## 术语

本文沿用 [`CONTEXT.md`](../CONTEXT.md) 中的 Desktop App、Desktop Shell、Harness Runtime、Harness UI、Runtime Home、Runtime Version 和 App Version。

**Desktop Companion**：由 Desktop Shell 承载的桌面专属只读辅助面。包含右栏、Workspace Review、响应式预览，以及最后阶段加入的宠物活动区。它不复制 Harness 的会话、Agent、设置或工具详情 UI。

**Workspace Review**：针对当前 Harness Session 所属 Workspace 的只读文件树、Git 变更摘要、diff 和文件预览能力。

**Workspace Authority**：由 Harness Runtime 的 Workspace registry 对 `sessionId -> canonical Workspace root` 作出的权威解析结果。浏览器上报的绝对路径不构成 Authority。

**Workspace Capability**：Desktop Shell 主进程根据 Workspace Authority 建立的短期、不透明权限。它只在当前 Runtime instance 和 Workspace generation 内有效。

**Review Focus**：窗口宽度不足以同时容纳 Harness、预览和右栏时，暂时隐藏但不卸载 Harness `WebContentsView`，由本地 renderer 显示预览与文件栏的模式。

## 目标与非目标

### 目标

- 在“设置”上方可靠展示当前 DeepSeek 凭据所属账户的官方余额。
- 在不重写 Harness UI 的前提下提供可收起的桌面右栏。
- 为当前 Workspace 提供懒加载文件树、当前 Git 变更、文本/代码/Markdown/图片预览。
- 从 Harness 官方 Session 状态获得当前 Session、Workspace 和 `running` 事实。
- 在窄窗口和宽窗口中都保留可用的 Harness、预览和文件导航体验。
- 将 Key、Workspace Authority、文件读取、Git、Markdown 和动画复杂性集中在少量深 Module 内。
- 所有新增能力可失败关闭；失败不得阻塞 Harness 启动、会话运行和应用更新。

### 非目标

- 不显示或估算今日消费。
- 不显示账户昵称、邮箱或官方接口没有返回的账号身份。
- 不执行文件编辑、撤销、stage、commit、删除或项目修复。
- 不保证第一版能把所有 Workspace 变化准确归因到某一轮 Harness 任务。
- 不用 Desktop Companion 替换 Harness 已有的工具详情 `details` 面板。
- 不支持任意用户替换的 Runtime Version；仍只支持随 App Version 固定交付的版本。
- 不在运行时下载插件、Markdown 执行器、宠物素材或其他可执行代码。
- 不把项目全文、完整 diff、余额或 Key 写入日志、诊断包、localStorage 或 IndexedDB。

## 当前基线与必须解决的差异

### 当前可复用基础

- `DesktopWindow` 已包含本地 `BrowserWindow` renderer 与唯一一个 Harness `WebContentsView`。
- Harness Runtime 已随 App Version 固定交付，并支持随包 profile extension。
- `@dsh-desktop/settings` 已通过官方 `settings.section` 注册外观与关于页。
- 固定 Runtime `0.1.0-rc.7` 已完成 arm64 基线装配、真实 PTY/原生模块、官方 Harness 和 packaged E2E 验证，并提供 `sidebar.footer.action`、`conversation.chat.turnTail`、Session store 与 Workspace registry 等 seam；Companion 实施时仍需为实际使用的 seam 增加独立契约测试。
- 本地顶栏已具备主题快照、renderer 独立恢复和可信 origin 策略。

### 实施前置差异

1. 当前架构文档把本地 renderer 限定为 Loading/Failure；实现前必须把 Desktop Companion 记录为桌面专属只读辅助面的明确扩展，但仍不得复制 Harness 产品 UI。
2. shell/Harness preload 与 Forge entry 已拆分；后续文件能力只能加入 shell preload，禁止回流 Harness preload。
3. `DesktopWindowOptions` 已分别接收 `shellPreloadPath` 与 `harnessPreloadPath`。
4. 当前 `harnessContentBounds()` 永远把 Harness 铺满内容宽度；必须改为由纯布局函数输出完整 layout snapshot。
5. 当前本地 renderer 只有 `startup | failure`，必须扩展为 `startup | failure | harness`，Harness 模式下渲染顶栏与 Desktop Companion。
6. Runtime extension 已统一装配 settings/companion 两包；Workspace 阶段继续沿用该清单 Module。
7. 余额 RPC 已实现每个 Runtime instance 的短期鉴权 token；进程终止前的 PID/启动时间所有权复核仍未实现，不能与 RPC token 混称。
8. 现有部分 E2E 通过 Harness DOM 进行固定版本兼容冒烟；新核心能力必须通过官方 slot/event 契约和本地 `data-testid` 验证，不能增加新的 DOM selector 依赖。

## 关键架构决定

### Desktop Companion 由 Desktop Shell 承载

不创建第二个 `WebContentsView`。现有本地 renderer 在 Harness 让出右侧空间后直接承载 Desktop Companion；预览需要更多空间时进入宽屏 split 或 Review Focus。

原因：

- 避免额外 renderer 生命周期、内存和攻击面。
- 文件内容只进入可信本地 renderer，不进入 Harness 页面。
- 不占用固定 Runtime 中已由工具详情占据的 `details` single slot。
- Harness 崩溃与本地 renderer 崩溃仍可独立恢复。

### 余额留在 Harness Runtime，结果通过受限桥显示

DeepSeek Key 只在 Harness Runtime 的 credential Module 内临时解析。Runtime 的 `AccountBalance` 调用固定官方 endpoint，Desktop Shell 只接收经过 schema 校验的余额 snapshot，再通过 Harness preload 的只读桥交给余额卡。

浏览器、Electron IPC 和 Desktop Shell 永远不接收 Key、Authorization header、原始 Provider response 或 Provider error body。

### Workspace Authority 由 Harness Runtime 决定，文件读取由 Desktop Shell 主进程执行

Harness UI 只上报当前 `sessionId`、`workspaceId`、`running`、Runtime instance 和单调 revision。Desktop Shell 主进程使用内部已鉴权 Runtime seam 复核 Session，并取得 canonical Workspace root；随后建立只存在于主进程内的 Workspace Capability。

文件系统与 Git 实现放在 Desktop Shell 主进程的 `WorkspaceInspector` 内。项目文件不会通过 Harness HTTP route 返回，也不会向 Harness preload 暴露文件接口。

### 变更先以 Workspace 事实为准

初始 ChangeSet 定义为当前 worktree 相对 HEAD 的状态：tracked staged/unstaged 变化与 untracked 文件。非 Git Workspace 仍可使用文件树和预览，只把变更区显示为不可用。

只有 Harness 官方 turn data 明确给出文件位置时，UI 才能写“本轮检测到的文件”；该语义必须同时携带 coverage。Shell 命令、外部编辑器或其他进程造成的变化无法被完整归因时，不得显示“本轮编辑”。

## 目标架构

```text
DeepSeek API
    ^ fixed HTTPS, Key only inside Harness Runtime
    |
Harness Runtime
├── @dsh-desktop/settings
└── @dsh-desktop/companion
    ├── AccountBalance
    ├── WorkspaceAuthority RPC
    └── Harness client adapters
        ├── sidebar.footer.action -> BalanceWidget
        ├── Session store -> context events
        └── conversation.chat.turnTail -> ChangeSummaryCard
             |
             | owned, versioned seam
             v
Desktop Shell main process
├── DesktopCompanion
├── WorkspaceInspector
├── RuntimeCompanionAdapter
└── DesktopWindow layout
             |
             | shell preload: snapshot + discriminated commands only
             v
Local renderer
├── CompanionPanel
├── Change/File views
├── Safe Preview
└── PetDirector (final phase)
```

## 依赖分类与 seam

| 依赖                        | 分类                | seam                           | Production Adapter                                   | Test Adapter                  |
| --------------------------- | ------------------- | ------------------------------ | ---------------------------------------------------- | ----------------------------- |
| DeepSeek balance endpoint   | true external       | `DeepSeekBalancePort`          | 固定 HTTPS Adapter                                   | mock Adapter                  |
| Harness Runtime host/client | remote but owned    | `RuntimeCompanionPort`         | 已鉴权 loopback RPC + 官方 client slot/event Adapter | in-memory Adapter             |
| 文件系统                    | local-substitutable | `WorkspaceInspector` 内部 seam | Node fs Adapter                                      | 临时目录/内存 Adapter         |
| Git                         | local-substitutable | `WorkspaceInspector` 内部 seam | Git argv process Adapter                             | 临时 Git repo/fixture Adapter |
| Markdown                    | in-process          | `SafeMarkdown` Interface       | 结构化 parser + sanitizer                            | 同一实现 + hostile corpus     |
| 宠物行为                    | in-process          | `PetDirector` Interface        | reducer + animation implementation                   | fake clock/random/completion  |

外部调用方不学习 fs、Git、MIME、Markdown AST、Provider response 或动画 clip 名；这些全部留在相应 Module implementation 内，以获得 leverage 和 locality。

## Deep Module 与 Interface

### `AccountBalance`

该 Module 位于 `@dsh-desktop/companion` 的 Harness Runtime host implementation 内，隐藏凭据解析、请求合并、超时、短 TTL、响应上限、schema 校验和错误归类。

```ts
type AccountBalanceAmount = {
  readonly currency: "CNY" | "USD";
  readonly total: string;
  readonly granted: string;
  readonly toppedUp: string;
};

type AccountBalanceSnapshot =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly isAvailable: boolean;
      readonly balances: readonly AccountBalanceAmount[];
      readonly fetchedAt: string;
      readonly stale: boolean;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "credential-unconfigured"
        | "credential-unauthorized"
        | "rate-limited"
        | "network"
        | "invalid-response";
      readonly lastGood?: Extract<
        AccountBalanceSnapshot,
        { readonly status: "ready" }
      >;
    };

interface AccountBalance {
  read(input?: { readonly force?: boolean }): Promise<AccountBalanceSnapshot>;
}
```

Interface 保证：

- 金额始终保留 Provider 返回的 decimal string，不转换为 JS 浮点数。
- CNY 与 USD 分别显示，不自动换算或相加。
- 同一时间只存在一个远程请求；并发 caller 共享结果。
- 自动刷新最短间隔 5 分钟，手动刷新最短间隔 30 秒。
- 网络刷新 5 秒超时；Provider response body 最大 32 KiB。
- 401/403 不重试，429/网络/5xx 使用有界退避。
- 刷新失败时保留 last-good snapshot 并标记 stale，不显示猜测值或 `0`。
- 余额不持久化，日志只记录成功/失败类别，不记录金额。
- 请求目标固定为 `https://api.deepseek.com/user/balance`，禁止重定向和 caller 自定义 URL。

余额卡文案：

- 宽侧栏：`账户余额` + 各币种金额。
- 折叠 rail：钱包图标，tooltip 展示余额。
- 未配置：`尚未配置 DeepSeek API Key`。
- 凭据无效：`当前凭据无效，请前往设置检查`。
- 账户返回不可用：保留金额并展示 `账户当前不可用`。
- 暂时失败：展示 last-good + `可能已过期`，或展示重试入口。

官方依据：[DeepSeek 查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)。实施时必须重新核对官方 schema。

### `RuntimeCompanionPort`

这是 Harness Runtime 与 Desktop Shell 之间的 owned seam。它只提供账户余额和 Workspace Authority，不提供通用 RPC 或文件内容读取。

```ts
type RuntimeCompanionRequest =
  | { readonly kind: "account.balance"; readonly force?: boolean }
  | {
      readonly kind: "workspace.authorize";
      readonly sessionId: string;
      readonly workspaceId?: string;
    };

type WorkspaceAuthority = {
  readonly runtimeInstanceId: string;
  readonly workspaceId: string;
  readonly canonicalRoot: string;
  readonly generation: string;
};

interface RuntimeCompanionPort {
  execute(
    request: RuntimeCompanionRequest,
    signal?: AbortSignal,
  ): Promise<AccountBalanceSnapshot | WorkspaceAuthority>;
}
```

Interface 与 transport 约束：

- App launch 时生成至少 256-bit 随机内部 token；Runtime restart 时轮换。
- token 只通过一个命名明确的 allowlisted child environment variable 传入 Harness Runtime。
- token 不进入 `RuntimeState`、日志、诊断、URL、renderer 或 Harness client bundle。
- Desktop Shell 的 Production Adapter 通过固定 header 发送 token；Host 使用恒定时间比较验证。
- 所有 route 仅允许 loopback、限定 method、限定 `Content-Type`、body 最大 4 KiB、response `no-store`。
- main Adapter 设置 `redirect: 'error'` 和 5 秒超时，不记录 headers/body。
- Runtime restart 会撤销旧 token、旧 `runtimeInstanceId` 与所有 Workspace Capability。
- `workspace.authorize` 只接受有界 ID，并从 Runtime Workspace registry 重新解析 canonical root。
- 如果固定 Runtime 无法提供可验证的 registry seam，则 Workspace Review 保持关闭，绝不接受浏览器上报的绝对路径作为回退。

### Harness event envelope

Harness client Adapter 只把官方 Session store 中的事实上报给 Desktop Shell：

```ts
type HarnessDesktopEvent = {
  readonly version: 1;
  readonly runtimeInstanceId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly type: "context.snapshot";
  readonly currentSessionId?: string;
  readonly currentWorkspaceId?: string;
  readonly runningSessionIds: readonly string[];
};

type HarnessReviewIntent = {
  readonly version: 1;
  readonly runtimeInstanceId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly type: "review.open";
  readonly sessionId: string;
  readonly entryId?: string;
  readonly changeSetId?: string;
};
```

Envelope 约束：

- 总 payload 不超过 4 KiB；ID 有长度和字符 allowlist。
- main 只接受当前 Harness `webContents` 的 main frame、可信 origin 和当前 Runtime instance。
- `revision` 必须单调，旧 epoch、旧 instance、旧 revision 和 subframe 消息全部丢弃。
- 每秒最多接收 20 条，UI 合并后最多发布 10 次 snapshot。
- 浏览器 ID 只是 hint；main 必须通过 `RuntimeCompanionPort` 复核 Workspace Authority。
- seam 不可用时功能关闭，不轮询 DOM，不读取按钮、spinner 或页面文本。
- 日志只记录事件类型和稳定错误码，不记录 Session 标题、Workspace 路径或文件名。

### `WorkspaceInspector`

该 Module 位于 Desktop Shell 主进程，隐藏 Workspace Capability、路径 containment、文件类型、分页、缓存、Git argv、输出上限与并发取消。

```ts
type WorkspaceEpoch = string;
type WorkspaceRevision = number;
type EntryId = string;

type WorkspaceInspectorRequest =
  | { readonly kind: "overview" }
  | {
      readonly kind: "children";
      readonly parentId?: EntryId;
      readonly cursor?: string;
    }
  | {
      readonly kind: "preview";
      readonly entryId: EntryId;
      readonly mode: "rendered" | "source" | "diff";
    }
  | { readonly kind: "refresh" };

interface WorkspaceInspector {
  select(authority: WorkspaceAuthority | null): Promise<WorkspaceSnapshot>;
  execute(
    epoch: WorkspaceEpoch,
    revision: WorkspaceRevision,
    request: WorkspaceInspectorRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceInspectorResult>;
  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
  dispose(): Promise<void>;
}
```

Interface 保证：

- canonical root 与 generation 只存在于主进程；renderer 只持有 `EntryId`、相对展示路径、epoch 和 revision。
- `select()` 先取消旧请求、释放 Blob/resource、清空 handles，再安装新 Authority。
- 每次请求校验 Runtime instance、Workspace generation、epoch 和 revision；旧请求返回 `stale-capability`。
- `EntryId` 不具备路径授权语义；每次读取仍重新验证 handle 和 containment。
- 目录按需分页，不启动时递归扫描全仓库，也不启动递归 watcher。
- watcher 仅作为 invalidation hint；最终结果始终重新查询事实。
- 第一版只读常规文件；目录误读、FIFO、socket、device 和 workspace 外 symlink 全部拒绝。
- Workspace 切换、Runtime restart、renderer recovery 或 Authority 失败时清空 preview。

### `DesktopCompanion`

这是 AppCoordinator 与 DesktopWindow 使用的主 Module。它协调面板状态、Harness context、WorkspaceInspector、请求取消和 renderer snapshot，不解析 Git、Markdown 或 Provider response。

```ts
type CompanionCommand =
  | { readonly kind: "panel.toggle" }
  | { readonly kind: "panel.close" }
  | { readonly kind: "workspace.refresh" }
  | { readonly kind: "tree.expand"; readonly entryId: EntryId }
  | {
      readonly kind: "file.open";
      readonly entryId: EntryId;
      readonly mode?: "rendered" | "source" | "diff";
    }
  | { readonly kind: "preview.close" }
  | { readonly kind: "pet.wake" };

interface DesktopCompanion {
  connect(input: {
    readonly origin: string;
    readonly runtimeInstanceId: string;
  }): Promise<void>;
  accept(event: HarnessDesktopEvent | HarnessReviewIntent): void;
  dispatch(command: CompanionCommand): Promise<void>;
  getSnapshot(): CompanionSnapshot;
  subscribe(listener: (snapshot: CompanionSnapshot) => void): () => void;
  dispose(): Promise<void>;
}
```

Interface 保证：

- `connect()` 幂等；连接改变时先撤销旧 Capability 和在途请求。
- `dispatch()` 只接受判别联合，不接受 URL、绝对路径、shell 命令或任意 JSON operation。
- `accept()` 只处理已经过 sender/schema/rate validation 的 owned event。
- snapshot 是 renderer 唯一事实来源；renderer 不自行拼接路径、Git ref 或窗口 bounds。
- 任意子 Module 失败都转成稳定 UI state，不向 renderer 发送原始 stack 或绝对路径。
- Companion 失败不会改变 Harness Runtime lifecycle；面板可以关闭并恢复 Harness 全宽。

### shell preload Interface

只有可信本地 renderer 能看到：

```ts
interface ShellCompanionBridge {
  getSnapshot(): CompanionSnapshot;
  subscribe(listener: (snapshot: CompanionSnapshot) => void): () => void;
  dispatch(command: CompanionCommand): Promise<void>;
}
```

Harness preload 不得暴露该 Interface。Harness preload 只保留：

- 现有更新 snapshot 与 `check | install` 固定命令。
- 有界的 context event 上报。
- 有界的 review intent 上报。
- 账户余额的只读 snapshot/subscribe 与无参数 refresh 命令。
- 现有顶栏宽度/外观窄桥；新增核心功能不得复用其 DOM selector 做业务判断。

## Workspace Review 数据语义

### Workspace 与 Capability

1. Harness client Adapter 发布当前 Session/Workspace ID。
2. main 校验 sender、Runtime instance、epoch 和 revision。
3. `RuntimeCompanionPort` 通过 Workspace registry 解析 canonical root。
4. main 建立 Workspace Capability，生成新的 Workspace epoch。
5. Renderer 获取 root node 与相对显示信息，不获取 canonical root。
6. Session/Workspace/Runtime 改变时，旧 epoch、handles、preview 和异步结果全部失效。

### 文件树

- 目录优先、文件其次，同类按本地化名称排序。
- 每页最多 500 个条目，响应最大 256 KiB。
- 默认不展开 `.git`、`node_modules` 与其他明显构建缓存；用户仍可通过显式配置决定是否显示被 ignore 的普通文件。
- 最大树深度 20；超过时显示有界错误，不递归。
- 文件名中的换行、制表和控制字符必须转义显示；解析使用 NUL-safe 数据源。
- symlink 可以显示元信息，但第一版不打开 symlink 目标。
- 不把上次选中文件或文件内容持久化到桌面偏好。

### ChangeSet

```ts
type ChangeSetSource =
  | { readonly kind: "git-workspace"; readonly baseline: "HEAD" }
  | {
      readonly kind: "turn-observed";
      readonly turnSeq: number;
      readonly coverage: "authoritative" | "partial";
    };
```

- 默认文案：`当前工作区变更`。
- Git 状态包含 added、modified、deleted、renamed、copied、untracked、conflicted。
- staged 与 unstaged 最终合成为相对 HEAD 的每文件展示状态；详情仍可区分来源。
- untracked 文本文件可显示 additions；二进制或超限文件显示 `binary`/`unknown`，不伪造数字。
- unborn HEAD 显示 `尚无 HEAD 基线`，不把整个 Workspace 自动算成普通 diff。
- 非 Git、Git 不可用或 safe-directory 拒绝时，文件树继续工作。
- rich turn-tail 卡片只读；点击文件仅打开 Desktop Companion review。
- 第一版不实现卡片上的撤销、审核通过、stage 或 commit 操作。

### Git implementation 约束

- 只使用固定 Git executable 和 argv 数组，`shell: false`。
- `cwd` 只能是已验证 Workspace root。
- 使用 `--no-pager`、`--no-ext-diff`、`porcelain v2 -z`、`diff --numstat -z` 和 literal pathspec。
- 设置 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`，禁用 fsmonitor。
- 不启用 hooks、external diff、textconv、pager 或 submodule 内递归命令。
- 不覆盖 Git 的 `safe.directory` 拒绝。
- Git status/numstat 3 秒超时、stdout 8 MiB 上限；单文件 diff 2 MiB 或 20,000 行上限。
- 超限杀死本 Module 创建的子进程并返回 `truncated`/`timeout`，不得卡住 main process。

## Preview 设计

### 判别结果

```ts
type InspectorDocument =
  | {
      readonly kind: "markdown";
      readonly source: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "text";
      readonly text: string;
      readonly language?: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "image";
      readonly resourceId: string;
      readonly mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      readonly width?: number;
      readonly height?: number;
    }
  | {
      readonly kind: "diff";
      readonly file: DiffFile;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "unsupported";
      readonly reason:
        | "binary"
        | "special-file"
        | "too-large"
        | "invalid-encoding"
        | "unsafe-type";
    };
```

### 支持矩阵

| 类型                                     | 初始行为                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| `.md` / `.mdx`                           | 安全 Markdown；MDX 只按 Markdown/text 处理，不执行 JSX |
| 常见源码、JSON、YAML、TOML、日志、纯文本 | 转义后的 text/code preview                             |
| PNG/JPEG/WebP/GIF                        | 有界本地图片 preview                                   |
| SVG                                      | 仅源码，不直接嵌入执行                                 |
| PDF、音视频、Office、未知 binary         | 显示元信息和 unsupported，不内嵌                       |
| Git diff                                 | 结构化 hunk preview                                    |

### Markdown 安全规则

- 使用结构化 parser 构建 AST，再由 app-owned `SafeMarkdown` 渲染；禁止以字符串替换方式实现 Markdown。
- raw HTML、MDX、iframe、script、style、事件属性、SVG 执行内容全部关闭。
- 禁止 `javascript:`、`file:`、`data:`、`vbscript:`、`srcdoc`。
- 远程图片默认不加载，避免打开仓库文档时静默发出网络请求。
- HTTPS 链接只在用户点击后交给系统浏览器；不在主窗口导航。
- Workspace 相对链接重新进入 WorkspaceInspector，并重新执行 Capability 与 containment 校验。
- 代码块只高亮，不执行 Mermaid、插件、宏或任意代码。
- 默认使用 DOM text node/框架转义；禁止把项目内容直接赋给 `innerHTML`。
- 本地 CSP 保持 `default-src 'self'`；图片仅增加最小 `img-src 'self' blob:`，不加入 `unsafe-inline`、`unsafe-eval` 或任意网络源。
- Markdown 最大 1 MiB，普通 text/code 最大 2 MiB。

### 文件读取规则

- 先验证 Workspace Capability、epoch、revision、EntryId 与相对路径。
- `realpath` 最终目标必须仍在 canonical root 内。
- MVP 拒绝打开 symlink；普通文件使用 no-follow 语义并在打开后 `fstat`。
- 读取前后比较 stat revision；并发变化返回 `file-changed`，不拼接两个版本内容。
- 图片压缩字节最大 10 MiB、最大 32 MP、单边最大 16,384 px。
- 图片字节通过有界 IPC 生成可撤销 Blob URL；不使用 `file://`。
- preview LRU 总内存上限 64 MiB；Workspace 切换、Runtime restart 或 renderer recovery 时清空。
- 项目文件内容不进入 Desktop Shell 日志、Harness 日志、诊断包或持久缓存。

## Desktop Companion UI

### 余额卡

- 注册到官方 `sidebar.footer.action`，视觉上位于 Settings 上方。
- wide 模式占满 footer action 行；rail 模式为单图标。
- loading 使用稳定 skeleton，不把未加载误显示成零。
- 点击卡片展开轻量详情：币种分项、赠金/充值余额、上次更新时间与刷新。
- 点击卡片不打开网页、不暴露 Key，也不进入 Desktop Companion 右栏。
- Runtime extension/slot 契约不可用时卡片不注册，Settings 保持原样。

### 面板入口

- 主入口位于本地 44px toolbar 右侧，使用按钮而不是依赖 Harness header DOM。
- Harness client 可另外注册 `conversation.session.header.utilities` 入口；它只发送 `panel.toggle` intent，不拥有面板状态。
- 按钮提供 `aria-label`、`aria-pressed`、键盘 focus 和 tooltip。
- 面板关闭时 Harness 恢复全部可用宽度。

### 右栏结构

宠物上线前不预留空白区域，文件区占满右栏。宠物最后阶段上线后：

```text
┌────────────────────┐
│ Pet Activity       │ 220-260px，可折叠
├────────────────────┤
│ 变更 | 文件        │
├────────────────────┤
│ lazy tree / list   │ flex: 1
└────────────────────┘
```

默认尺寸：

- Inspector 默认 360px，最小 320px，最大 440px。
- Preview 最小 480px。
- Harness 可用中心区域目标最小 640px。
- 用户拖动只提交期望 Inspector 宽度；最终 bounds 始终由 main 的纯布局函数计算并 clamp。

### 响应式布局

| 可用内容宽度 | Panel 状态 | 打开文件后的行为                                                                       |
| ------------ | ---------- | -------------------------------------------------------------------------------------- |
| `>= 1320px`  | docked     | `Harness                                                                               | Preview                           | Inspector` 宽屏 split   |
| `980-1319px` | docked     | 默认 `Harness                                                                          | Inspector`；打开文件进入 `Preview | Inspector` Review Focus |
| `< 980px`    | overlay    | Inspector 覆盖在 Harness 右侧；打开文件进入单栏 Review Focus，可在 preview/tree 间切换 |

Review Focus 只隐藏 Harness view，不 reload、不停止任务。退出 review 后恢复原会话、焦点和滚动状态。窗口缩放跨阈值时保留 selection，但必须经过纯 layout state transition，不允许 renderer 直接操纵 `WebContentsView`。

### 文件/预览交互

- 右栏默认进入“变更”；非 Git Workspace 默认进入“文件”。
- 展开目录时显示 loading row；失败只影响该节点。
- 单击文件打开 preview，双击不得产生不同的文件权限行为。
- Markdown 默认 rendered；顶部提供 rendered/source 切换。
- diff 顶部显示 baseline、文件状态、additions/deletions 和 truncated 状态。
- Preview 的返回、关闭、刷新均是明确命令；Escape 只关闭当前最上层 review，不退出应用。
- Workspace 改变时立即清空旧树和 preview，显示新 Workspace loading。
- 辅助技术可以读出文件名、状态和 `+/-`，颜色不是唯一状态信号。

## 宠物最终阶段设计

宠物不会阻塞前述任何阶段。其资产缺失、损坏或性能不达标时，Desktop Companion 继续只显示 Workspace Review。

### 素材输入门

开始宠物实现前，产品所有者提供并冻结：

- 透明背景、完整脚部与尾巴的 canonical full-body source，建议至少 3000x3000。
- 正面、3/4、侧面参考与固定头身比、眼距、服装、调色板。
- neutral、困倦、闭眼、惊醒、揉眼、开心进食表情。
- 优先提供分层 PSD/Clip Studio：头、前后发、眼皮、嘴、手臂、腿、裙摆、尾巴、饭碗、token 粒子分层。
- 角色不可变化清单与可接受的动作夸张范围。

如果有分层资源，优先从同一 rig 制作全部动作；如果只有 flattened source，则制作由同一 canonical reference 约束的 coherent sprite animation family。不得逐帧独立生成角色图。

### `PetDirector` Interface

```ts
type HarnessActivity = "disconnected" | "idle" | "running" | "waiting-user";

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
    readonly wakeRequested: boolean;
    readonly visible: boolean;
    readonly reducedMotion: boolean;
  }): PetPresentation;
}
```

状态机：

```text
standing -> drowsy -> lying-down -> sleeping
sleeping -> waking -> rubbing-eyes -> standing
idle state + running -> work-enter -> eating
eating + idle -> work-exit -> standing
```

行为约束：

- blink 是独立 overlay，不改变主 motion state。
- 站立 5-13 秒随机眨眼；连续闲置 60-120 秒后进入 drowsy。
- 用户只通过点击/键盘激活宠物活动区明确唤醒；不监控系统级输入。
- 任一 Harness Session `running=true` 时 `runningCount > 0`，宠物最终进入 eating。
- `runningCount` 归零后防抖 800ms，再播放完整 work-exit。
- 不可中断 clip 只在 authored marker 转换；过期 completion 带 generation 并被丢弃。
- 气泡只在 eating 中显示“疯狂进食 token 中”，作为 DOM overlay，不烘焙进素材。
- 活动区使用固定 viewBox、`overflow: clip`、`contain: layout paint size`；角色和气泡都不能越界。
- 页面隐藏时暂停绘制，恢复时按最新 authoritative activity 对账。
- `prefers-reduced-motion` 使用关键姿势与淡入淡出，但保留状态含义。

性能与 QA：

- 可见动画目标 >=55 fps；idle CPU 目标 <1%。
- decoded pet assets 总预算 32 MiB；素材离线随包。
- 每个 clip 输出 contact sheet 与 1x/0.25x 动画预览。
- 自动检查每帧 alpha bounds、baseline、scale 和首尾 root anchor。
- 同一角色头身比、眼距、服装颜色和标志性配件不得漂移。
- 相邻 clip 首尾 anchor 目标差 <=1px；明显跳形或身份漂移阻塞发布。
- 宠物资源损坏降级为静态角色或完全隐藏，不影响余额、文件、Harness 或更新。

## 安全模型增量

### 新增资产

- 账户余额与账户可用状态。
- Workspace 路径、文件名、文件内容和 Git diff。
- Session/Workspace identity 与 running 状态。
- Runtime companion token 与 Workspace Capability。
- preview 内存、Blob URL 和本地 renderer 状态。

### 新增不可信输入

- 工作区内所有文件、Markdown、图片、奇异文件名、symlink 和 `.git/config`。
- Git stdout/stderr、超大仓库和并发变化中的文件系统。
- DeepSeek network response 与错误正文。
- Harness 页面脚本、模型输出和非随包插件。
- renderer 发出的 command 与 Harness 发出的 event envelope。

### 发布阻塞门槛

- shell 与 Harness preload 未完全拆分。
- Harness 页面能访问任意文件/通用 IPC Interface。
- Key 出现在 browser、IPC、URL、日志、诊断、缓存或错误正文。
- 浏览器上报的绝对路径可以绕过 Runtime Workspace Authority。
- path traversal、symlink escape、特殊文件或 stale Capability 能读到 Workspace 外内容。
- Markdown 可以执行脚本、调用 preload、静默联网或导航主窗口。
- Git 能执行 hooks、pager、external diff、textconv、fsmonitor helper 或 shell interpolation。
- Companion 失败会阻塞 Harness 启动/运行，或关闭面板后不能恢复全宽 Harness。
- 项目文件内容或余额被写入日志、诊断包或持久缓存。

## 统一错误模型

| 错误码                            | 场景                                | UI 行为                                  |
| --------------------------------- | ----------------------------------- | ---------------------------------------- |
| `credential-unconfigured`         | 未配置 Key                          | 引导前往设置                             |
| `credential-unauthorized`         | Key 无效/撤销                       | 提示检查凭据，不重试                     |
| `account-unavailable`             | Provider 返回账户不可用             | 显示余额并标不可用                       |
| `balance-temporarily-unavailable` | timeout/429/5xx/offline             | 显示 stale 或重试                        |
| `balance-invalid-response`        | response/schema 异常                | 不显示猜测值                             |
| `runtime-companion-unavailable`   | owned seam 不可用/版本不兼容        | 隐藏余额卡与 Companion，Harness 正常运行 |
| `workspace-unavailable`           | 无活动 Workspace                    | 文件区空状态                             |
| `stale-capability`                | Runtime/Workspace generation 改变   | 清空树和 preview，重新握手               |
| `outside-workspace`               | 绝对路径、`..`、NUL、symlink escape | 拒绝，不泄露真实目标                     |
| `not-found` / `file-changed`      | 并发删除/改名/变化                  | 刷新父目录，可重试                       |
| `permission-denied`               | 文件不可读                          | 锁定状态                                 |
| `unsupported-file`                | binary/特殊文件/编码无效            | 显示元信息                               |
| `too-large`                       | 文件或结果超限                      | 显示上限，不继续读取                     |
| `git-unavailable`                 | 非 Git、Git 缺失、安全拒绝          | 文件树继续工作                           |
| `git-no-baseline`                 | unborn HEAD                         | 显示无 HEAD 基线                         |
| `git-timeout` / `git-truncated`   | Git 超时/输出过大                   | 显示部分结果和刷新                       |
| `pet-assets-unavailable`          | 素材缺失/校验失败                   | 静态降级或隐藏宠物                       |

所有错误给 renderer 的 detail 只允许稳定分类与相对展示路径，禁止原始 OS stack、绝对路径、Provider body 或 shell stderr 原文。

## 性能与资源预算

P95 在支持的 Apple Silicon 真机测量；CI 验证硬上限和不失控。

| 操作                         | 产品预算                   | 硬上限/降级                               |
| ---------------------------- | -------------------------- | ----------------------------------------- |
| 余额缓存读取                 | <=20ms                     | 不进入启动关键路径                        |
| 余额网络刷新                 | <=5s timeout               | 单飞；自动 5 分钟、手动 30 秒限频         |
| Harness event 到 UI snapshot | <=100ms                    | 4 KiB/event、20 events/s                  |
| 单目录列表                   | <=200ms（500 项内）        | 500 项/page、256 KiB response             |
| Markdown/text 打开           | <=300ms（512 KiB fixture） | Markdown 1 MiB、text 2 MiB                |
| 图片预览                     | <=300ms（常规图片）        | 10 MiB、32 MP、单边 16384px               |
| Git status/numstat           | <=1s（常规仓库）           | 3s timeout、8 MiB stdout                  |
| 单文件 diff                  | <=500ms（常规文件）        | 2 MiB 或 20,000 行                        |
| Panel resize/scroll          | >=55 fps                   | 不同步递归扫描、不在 renderer 解析大 diff |
| Inspector 增量内存           | <=64 MiB                   | LRU；Workspace 切换清空                   |
| Pet 增量 decoded assets      | <=32 MiB                   | 离屏暂停、损坏降级                        |

MVP 不做递归 watcher。手动刷新、窗口重新聚焦和 turn completion 触发 invalidation，Git 查询至少 debounce 500ms。

## 精确代码落点

### Runtime extension

```text
runtime/
├── desktop-settings-plugin/          # 保留外观/关于
├── desktop-companion-plugin/
│   ├── package.json
│   ├── index.js                      # AccountBalance + authenticated host RPC
│   ├── client.js                     # slots/session adapters
│   └── contract.js
└── desktop-extensions.patch.yml      # 组合 settings + companion
```

已落地调整：

- `src/main/runtime/runtime-extension.ts`：深化为 `ensureBundledRuntimeExtensions()`，按清单复制/链接多个随包 extension。
- `src/main/runtime/runtime-extension.test.ts`：多 extension、幂等、错误 symlink/non-link、目标校验。
- `scripts/vendor-runtime.ts`：复制 companion package 和统一 patch，进入 runtime manifest/验证链。
- `src/main/runtime/runtime-command.ts` 及测试：使用统一 patch。
- `tests/integration/bundled-harness.test.ts`：验证 package、host RPC、client bundle 与 slot 契约。

### 双 preload

```text
src/
├── shell-preload-entry.ts
├── harness-preload-entry.ts
└── preload/
    ├── shell.ts
    └── harness.ts
```

需要调整：

- `forge.config.ts`：构建两个 preload entry。
- `src/main/app-coordinator.ts`：分别解析两个产物路径。
- `src/main/window/desktop-window-options.ts`：本地 BrowserWindow 使用 shell preload。
- `src/main/window/desktop-window.ts`：Harness `WebContentsView` 使用 Harness preload。
- 迁移完成后删除旧 `src/preload/index.ts` 和 `src/preload-entry.ts`，不保留并行实现。

### Shared contract

```text
src/shared/
├── companion-bridge.ts
├── harness-companion-events.ts
├── account-balance-bridge.ts
└── *.test.ts
```

所有 IPC/bridge validator 与 discriminated union 置于 shared；main 和 preload 都必须调用同一 validator。不得增加 `send(channel, any)` 或通用 event emitter。

### Main process

```text
src/main/companion/
├── desktop-companion.ts
├── runtime-companion-adapter.ts
├── workspace-inspector.ts
├── workspace-capability.ts
├── node-workspace-fs-adapter.ts
├── git-process-adapter.ts
├── file-classifier.ts
└── *.test.ts
```

`AppCoordinator` 只负责组合、connect/dispose 与 lifecycle，不解析 Git、读取文件、计算 bounds、渲染 Markdown 或驱动宠物帧。

### DesktopWindow 与 renderer

```text
src/main/window/
├── desktop-window.ts
├── desktop-window-layout.ts
└── desktop-window-layout.test.ts

src/renderer/companion/
├── companion-view.ts
├── companion.css
├── change-summary-view.ts
├── file-tree-view.ts
├── file-preview-view.ts
├── safe-markdown.ts
└── pet/                            # 最后阶段才创建
```

需要调整：

- `src/renderer/index.html`：增加 Harness mode 和 Companion root。
- `src/renderer/index.ts`：从单纯启动页脚本深化为 local shell state adapter。
- `src/renderer/styles.css`：加入 app-owned allowlisted companion tokens；不新增并行的重复样式入口。
- `src/main/window/desktop-window-layout.ts`：返回完整 layout snapshot，而不是只返回 Harness bounds。
- `src/main/window/desktop-window-options.ts`：按响应式模式重新验证 min width。

## 分阶段实施计划

每个阶段形成独立可评审 PR；不得把 preload 隔离、安全预览与宠物资产压进同一个发布。

### Phase 0：契约、安全 seam 与文档同步

状态：**已实现**。双 preload、统一 extension 装配、shared validators、实例 token、authenticated RPC、Workspace context envelope、registry authority、revision/rate 和 sender/main-frame 验证均已落地。

目标：在无用户可见文件能力时先建立安全基础。

- 新增 `@dsh-desktop/companion` skeleton 和统一 extension 装配清单。
- 拆分 shell/Harness preload 与两个 Forge entry。
- 定义 shared bridge validator、owned event envelope 和 Runtime RPC contract。
- 实现每个 Runtime instance 的内部 token、allowlisted child env 和 authenticated host RPC。
- 通过真实 pinned Runtime 验证 credential、Workspace registry、所需 slots 和 Session store seam。
- 把 Desktop Companion 的产品例外同步到产品范围、架构、安全、测试与 appearance 文档。

退出条件：

- Harness 页面检测不到 shell bridge，local renderer 检测不到 Harness 通用能力。
- 错误 sender、subframe、旧 revision、旧 Runtime instance、超限 payload 和事件洪水测试通过。
- Runtime registry/auth seam 有真实契约测试；否则 Workspace phases 不得开始。
- 当前 `pnpm check`、packaged E2E 和安全门槛全部通过。

### Phase 1：账户余额

状态：**已实现并随 `v0.2.0-beta.1` 发布**。官方 `sidebar.footer.action` 卡片、宽栏/rail、缺少凭据与失败状态、手动刷新、single-flight、TTL、超时、body/schema 上限、last-good stale 以及打包 E2E 已落地；不包含今日消费。

目标：独立交付设置上方账户余额，不依赖右栏。

- 实现 Runtime `AccountBalance` 与 mockable true-external Adapter。
- 主进程通过 authenticated RPC 拉取 sanitized snapshot。
- Harness preload 提供只读 balance snapshot/subscribe/refresh。
- client Adapter 注册 `sidebar.footer.action` balance card。
- 支持 wide/rail、loading、missing credential、unauthorized、account unavailable、stale 和 retry。

退出条件：

- UI 只写“账户余额”或“当前凭据所属账户余额”，不存在今日消费。
- Key 在 browser、IPC、URL、日志、诊断、缓存和错误正文中的泄露测试为零。
- 余额查询不延长 Harness 首次可交互路径。
- 请求合并、timeout、限频、response size 和 schema hard limit 生效。

### Phase 2：Desktop Companion 空壳与 Workspace Capability

状态：**已实现并随 `v0.2.0-beta.1` 发布**。本地 toolbar 入口、右栏、wide review/Review Focus 布局、官方 Session/Workspace snapshot、Runtime registry 复核和 opaque Workspace Capability 已落地；浏览器不能选择 root 或传绝对路径。宠物前收尾把窗口最小宽度调整为 820px，使 `<980px` overlay 模式真实可达并纳入固定布局矩阵。

目标：建立面板、响应式布局和当前 Workspace Authority，暂不读取文件。

- 本地 renderer 增加 harness mode、toolbar toggle 和空面板。
- `DesktopWindow` 增加 closed/docked/overlay/review-focus/wide-review state。
- Harness client 从官方 Session store 发布 context snapshot。
- main 复核 Workspace Authority 并建立 Capability。
- Runtime restart、Session/Workspace 切换与 renderer recovery 清理旧状态。

退出条件：

- 820、980、1180、1480 宽度以及 DPR 1/2 的 layout 测试通过。
- Browser message 不能选择任意绝对路径。
- Panel 关闭恢复全宽 Harness；Review Focus 往返不 reload Harness。
- 现有工具详情、设置、更新入口和 renderer 独立恢复无回归。

### Phase 3：文件树与安全预览

状态：**已实现**。已提供 500 条上限的懒加载树、深度/缓存目录限制、2 MiB 文本/10 MiB 图片限制、非法 UTF-8 拒绝、常见图片 16384px 单边/32MP 像素门、Markdown 默认排版与源码切换、常见图片和纯文本预览。文件通过 `O_NOFOLLOW` 句柄读取并校验读取前后 identity/revision，拒绝 symlink 换位并报告并发变化；SafeMarkdown hostile corpus 已覆盖 HTML、SVG/MathML、iframe/object、远程/data 图片、脚本/file 链接、事件属性、深层列表与 fenced script 的 inert-text 语义。安全的 Markdown 相对文件链接使用当前文件 opaque node 作为解析锚点，主进程重新执行 containment 和文件类型检查；预览按文件 revision 缓存到 64 MiB LRU，Workspace Authority 替换即随 Inspector 释放。Workspace 切换同时清理重放 preview 及 renderer 内容。

目标：完成 Workspace Review 的核心价值。

- 实现 Capability-scoped lazy tree、分页、refresh 和 stale cancellation。
- 实现 text/code、Markdown rendered/source 与受控图片 preview。
- 实现 SafeMarkdown、relative link re-entry、Blob lifecycle 和 preview LRU。
- 增加特殊文件、大小、编码、symlink、并发改名与 hostile Markdown fixtures。

退出条件：

- traversal、symlink、特殊文件、大小和图片像素负向矩阵通过。
- Markdown hostile corpus 无脚本执行、preload 调用、静默网络和主窗口导航。
- 文件内容不进入日志、诊断包、持久缓存或 Harness page。
- 本地性能预算、Workspace 切换清理与 renderer recovery 通过。

### Phase 4：Git 变更、diff 与 review 集成

状态：**已实现**。右栏显示当前 worktree 相对 HEAD 的目录化状态和 numstat，点击变更显示带双侧行号、hunk 与未修改行折叠的真实单文件 diff，点击文件显示当前内容；历史轮次 Markdown 审核保留当时 mutation 的有界 old/new 片段并转换为红删绿增 diff，不回退为当前 Markdown 排版预览。Git 使用固定 argv、无 shell/无 prompt/无 optional lock、禁用 external diff 与 fsmonitor，并有超时和输出上限。逐轮卡片使用 rc.7 `conversationEvents` 对成功 mutation 工具事件建立 turn-local 事实，不从结束文案或当前 worktree 反推归因。由于 rc.7 `conversation.chat.turnTail` 是 first-match chain 且禁止跨插件导入 UI 值，Desktop profile 关闭官方独立 registration，由 Companion 在同一正式 slot 中保留相同的“产物”路径按钮行为并在下方组合新卡；不做 DOM 注入。

目标：实现类似 Codex 的只读变更卡和旁侧审阅体验。

- 实现 Git status/numstat/diff Adapter 和 ChangeSet projection。
- 支持 rename、delete、conflict、untracked、binary、unborn HEAD、非 Git。
- Harness client 注册 `conversation.chat.turnTail` rich change card。
- 点击卡片/文件发送 review intent，Desktop Companion 打开对应 preview。
- 完成 wide split、Review Focus、tree/preview navigation 和 accessibility。

退出条件：

- 恶意 fsmonitor、external diff、textconv、pager 和 hook fixture 均未执行。
- Git 无 shell、无 prompt、无 optional lock，超时和输出限制生效。
- 没有 turn attribution 证据时 UI 只显示“当前工作区变更”。
- 非 Git Workspace 仍可正常使用文件树与 preview。
- 完整 `pnpm check`、packaged E2E、renderer recovery 与发布安全测试通过。

### Phase 5：稳定性、发布与文档收口

状态：**已实现并随 `v0.2.1-beta.1` 公开发布**。预览硬化、100 次审核/工作区切换/面板收放状态压力、2500 次长会话 working-set profile、旧 Runtime Home 升级、完整单元/集成、arm64 打包 E2E、异机候选安装、30 分钟真实打包应用 soak、Apple 公证与最终 DMG/ZIP 异机复验均已通过。独立 5 小时扩展 soak 保留为手动和每周低峰非阻塞门禁。宠物前收尾进一步完成 820/980/1180/1480 响应式矩阵、Markdown 相对链接安全重入和 64 MiB revision-aware preview LRU。

目标：让前四阶段可以独立作为无宠物版本发布。

- 完成 100 次 open/close/switch/review stress 和长会话 memory profile。
- 验证 Runtime crash/restart、toolbar renderer crash、Harness renderer crash 和离线恢复。
- 验证从上一公开版本升级，不迁移或删除 Runtime Home。
- 更新产品范围、架构、安全、测试、当前状态、release notes 和第三方许可证。
- 默认启用前完成 Apple Silicon 真机性能矩阵。

退出条件：

- Companion fail-closed；关闭或故障时 Harness 能完整工作。
- 所有安全发布门槛无例外。
- 余额、Workspace Review 可在不含宠物的 App Version 中公开交付。

### Phase 6：宠物素材与动画

状态：**等待产品所有者提供并冻结角色素材，尚未开始实现**。

目标：在核心能力稳定后增加完整宠物体验。

- 冻结 canonical character source、identity checklist 和动作清单。
- 选择并只实现一条 production animation 路径；不同时维护多套运行时。
- 实现 PetDirector、clip manifest、bounds validator、状态机与 reduced motion。
- 完成 standing/blink/drowsy/lie-down/sleep/wake/rub-eyes/work-enter/eating/work-exit。
- 生成 contact sheets、动画预览、视觉基准和 asset manifest hash。

退出条件：

- fake clock 覆盖所有 transition、stale timer、快速 run/idle 和 renderer restore。
- 所有行为与气泡不越出活动区，无 identity/scale/baseline 跳变。
- 帧率、CPU、内存和隐藏暂停预算通过。
- 宠物失败不影响余额、Workspace Review、Harness 或更新。

## Feature gating 与回滚

- 不引入远程 feature flag 后台。能力由 App Version 内的固定 capability handshake 决定。
- Runtime companion handshake 失败时，余额卡不注册、右栏入口隐藏、Harness 全宽运行。
- Phase 1 余额与 Phase 2-4 Workspace Review 可独立启用；宠物 capability 独立且最后启用。
- `desktop.json` 只新增向后兼容的 panel open/width/tab 偏好；不保存 canonical root、EntryId、文件内容或余额。
- 未知新字段被旧版本忽略；迁移失败回到默认 panel closed，不改 Runtime Home。
- App Version 原子更新仍同时固定 Runtime Version 和 companion extension，不支持在线单独升级插件。
- 如需紧急回滚，可发布关闭 companion capability 的 App Version；用户 Session、Workspace 和 Runtime Home 不需要迁移。

## 测试矩阵

| 层级                | AccountBalance                              | Workspace/文件                         | Git                              | Markdown/Preview               | Harness seam                   | Pet                          |
| ------------------- | ------------------------------------------- | -------------------------------------- | -------------------------------- | ------------------------------ | ------------------------------ | ---------------------------- |
| Module interface    | schema、decimal、cache、single-flight、错误 | Capability、分页、类型、大小、失效     | NUL parser、状态合并、超限       | hostile corpus、URL、深度/大小 | schema、revision、sender、rate | reducer、timer generation    |
| 本地集成            | mock HTTPS，无真实 API                      | 临时 FS、symlink、FIFO、权限、并发改名 | 临时 repo、怪异文件名、submodule | Blob/CSP/无网络                | in-memory Runtime Adapter      | manifest/atlas validator     |
| pinned Runtime 契约 | credential resolve 不泄露 Key               | registry 复核 Session/Workspace        | —                                | client slot 正常装配           | footer/turnTail/session seams  | running 驱动                 |
| Electron E2E        | wide/rail、离线/未配置/stale                | toggle、tree、refresh、切 Workspace    | 变更数、diff、截断               | rendered/source、XSS、链接     | restart 后旧 Capability 失效   | bounds、wake、reduced motion |
| 发布安全            | 无 Key/余额落盘或日志                       | 诊断包无项目内容                       | helper 不执行                    | CSP 不放宽、SVG/remote 拒绝    | 无通用 emit/任意参数           | 无联网素材                   |

### 必须加入的负向 fixtures

- `../outside`、绝对路径、NUL、NFD/Unicode、换行/制表文件名。
- 父目录 symlink、文件 symlink、指向 Workspace 外的 symlink。
- FIFO/socket/device、零字节、二进制、无效 UTF-8、各大小边界。
- `.git/config` 中把 fsmonitor/external diff 设置为写 marker 的脚本，断言 marker 不存在。
- Markdown 含 script、onerror、SVG、iframe、`javascript:`、`file:`、remote image、深层嵌套和超大表格。
- Harness event 的错误 sender、subframe、旧 revision、旧 instance、超长字段和事件洪水。
- Balance mock 的 redirect、401、429、5xx、慢响应、巨大 body、错误 decimal、重复币种。

### 每阶段基础验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

正式候选继续执行现有 package、签名、公证、Gatekeeper、升级和 soak 门禁。

## Issue/PR 建议切分

1. `docs: accept Desktop Companion scope and security model`
2. `runtime: generalize bundled extension assembly`
3. `security: split shell and Harness preloads`
4. `runtime: add authenticated companion RPC and contract tests`
5. `balance: show current credential account balance above Settings`
6. `companion: add panel state and responsive DesktopWindow layout`
7. `companion: publish authoritative Session/Workspace context`
8. `workspace: add capability-scoped lazy file tree`
9. `preview: add safe text and rendered Markdown review`
10. `preview: add bounded image resources and diff view`
11. `git: add current Workspace ChangeSet projection`
12. `harness: add rich turn-tail change card and review intent`
13. `test: harden companion security, recovery and performance gates`
14. `release: ship account balance and Workspace Review without pet`
15. `pet: freeze canonical art and animation manifest`
16. `pet: implement state machine, assets and visual QA`

## 风险登记

| 风险                                | 影响                     | 应对                                                       |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------- |
| Runtime Developer Preview seam 变化 | slot/event/RPC 不兼容    | 固定版本、真实契约测试、fail-closed、原子发布              |
| 共享 preload 误暴露文件能力         | Harness 获得高权限       | Phase 0 强制双 preload；未完成阻塞后续                     |
| Runtime RPC 无真实鉴权              | 本机其他进程调用内部能力 | per-instance token、fixed header、loopback、no-store、限流 |
| 浏览器伪造 Workspace path           | 读取任意本地文件         | 只上报 ID，Runtime registry 复核 canonical root            |
| symlink/TOCTOU 逃逸                 | 读取 Workspace 外内容    | no-follow、fstat、realpath containment、generation         |
| 恶意 Markdown/图片                  | XSS、联网、内存炸弹      | AST、sanitizer、CSP、协议/大小/像素 allowlist              |
| Git 配置执行外部 helper             | 任意命令执行             | 禁用 helper、固定 argv/env、恶意 fixture                   |
| 把 Workspace diff 误称本轮变更      | 错误归因、误导用户       | 明确 source/coverage，没有证据不使用该文案                 |
| 右栏挤压 Harness/tool details       | 中心内容不可用           | 响应式 dock/overlay/Review Focus，一次只显示一个辅助面     |
| 大仓库扫描卡顿                      | main 阻塞、内存增长      | lazy page、无递归 watcher、timeout、LRU、hard limits       |
| 宠物身份漂移或性能不达标            | 视觉质量差、拖慢主体验   | canonical source、同一 rig/atlas、最后阶段、独立 gate      |

## 明确拒绝的方案

- 不替换 Harness `details` single slot；这会破坏官方 tool details。
- 不新增第二个长期驻留 `WebContentsView` 只为右栏或 preview。
- 不把文件能力加入当前共享 preload。
- 不接受 renderer/Harness page 传来的任意绝对路径。
- 不提供任意 channel/JSON IPC 或通用 HTTP 文件 route。
- 不通过 DOM MutationObserver、按钮文案或 spinner 推断 Session/Workspace/running。
- 不使用余额差值、网页抓取或本地 token 估算显示今日消费。
- 不把当前 Workspace diff 冒充精确的本轮编辑。
- 不直接用 `file://`、raw HTML 或可执行 SVG 做 preview。
- 不为宠物生成彼此独立、身份不一致的逐帧角色图。

## 文档同步清单

Phase 0 开始实现时同步：

- `CONTEXT.md`：加入 Desktop Companion、Workspace Review、Workspace Authority/Capability 术语。
- `docs/01-product-scope.md`：允许桌面专属只读辅助面，仍禁止复制 Agent/Harness UI 与写项目。
- `docs/02-architecture.md`：加入 AccountBalance、RuntimeCompanionPort、DesktopCompanion、WorkspaceInspector、双 preload 和响应式 layout。
- `docs/03-security.md`：加入真实 Runtime token、Workspace Capability、path/Markdown/Git/preview 控制，并修正文档与 owner token 现状漂移。
- `docs/04-testing-and-release.md`：加入 Module interface、pinned Runtime contract、hostile fixture、性能和 E2E 门禁。
- `docs/05-implementation-plan.md`：链接本文并按 Phase 0-6 执行，不重写已经完成的历史 Phase。
- `docs/07-current-status.md`：只在功能实际完成后迁移条目；当前仅记录“方案已接受，尚未实现”。
- `docs/08-appearance-extension.md`：为 Companion 增加严格 allowlist 的背景、边框、文字颜色同步，不传任意 CSS/token map。
- `docs/references.md`：加入 balance endpoint 与实施时验证的固定 Runtime seam 依据。
- 每个 App Version 的 release notes：明确上线阶段、限制、回滚与 Runtime Version。

## 总体完成定义

Desktop Companion 主体（不含宠物）完成，必须同时满足：

1. 账户余额语义、错误状态和 Key 隔离全部通过。
2. shell/Harness 双 preload、owned event 和 authenticated Runtime seam 无例外。
3. Workspace Authority、Capability、路径 containment 和 stale cancellation 全部通过。
4. 文件树、当前 Workspace ChangeSet、Markdown/text/image/diff preview 达到功能与性能预算。
5. 恶意 Markdown、Git helper、symlink、特殊文件和大输入负向矩阵通过。
6. 关闭/故障时 Harness 全宽可用；Runtime/renderer 恢复后旧能力失效且状态可重建。
7. 项目文件、Key、余额不进入不允许的存储、日志或诊断。
8. 自动化检查、packaged E2E、Apple Silicon 真机矩阵和发布门禁全部通过。

宠物完成还需额外满足素材输入门、状态机、identity QA、活动区约束与性能预算；宠物未完成不影响主体版本发布。
