# 系统架构

## 总体形态

```text
┌──────────── DeepSeek YukiRyou.app ─────────────┐
│                                                 │
│  Electron Main Process                         │
│  ┌──────────────┐  ┌─────────────────────────┐ │
│  │AppCoordinator│→ │RuntimeSupervisor        │ │
│  └──────┬───────┘  │spawn / probe / stop     │ │
│         │          └────────────┬────────────┘ │
│         │                       │              │
│  ┌──────▼───────────────────┐ bundled Node+dsh │
│  │DesktopWindow            │          │        │
│  │local draggable toolbar  │          │        │
│  │isolated WebContentsView │◀─ HTTP ──┘        │
│  └─────────────────────────┘ 127.0.0.1:<port>  │
│            ▲ settings.section overlay          │
│                                                 │
│  Runtime Home: ~/Library/Application Support/… │
└─────────────────────────────────────────────────┘
```

桌面应用只有一个外部模块接口：`AppCoordinator.run()` 驱动整个生命周期。复杂性集中在三个深模块中，调用方和测试都只通过各自接口观察行为。

## 技术栈

- Electron + TypeScript，主进程代码使用严格类型检查。
- Electron Forge 负责打包、DMG/ZIP、签名与公证；最终初始化时固定到当时最新稳定版本并提交 lockfile。
- Node.js 24 的架构对应发行包作为独立资源随应用交付；满足官方 dsh 当前声明的 Node `^22.19.0 || >=24.0.0` 要求。
- `@deepseek-ai/dsh` 固定精确版本，不使用 `latest`、caret 或 tilde 范围。
- Vitest 覆盖模块接口，Playwright Electron 覆盖端到端启动与窗口策略。
- pnpm 作为仓库包管理器；CI 使用 `--frozen-lockfile`。

不使用 React/Vue 创建第二套 Harness 产品 UI。本地静态 renderer 承载启动/诊断、44px 顶栏以及 Desktop Companion/Workspace Review；外观和关于页通过 Harness 官方 `settings.section` 插槽注册，继续使用 Harness 自己的设置弹窗、主题服务和本地化服务。规划中的宠物设置页复用同一官方 seam；动画在专用受限 PetPlayer view 中运行，并只显示在本地 Pet Stage Host 预留的 bounds 内。

## 深模块与接口

### `RuntimeSupervisor`

负责隐藏端口选择、子进程创建、环境构造、就绪探测、崩溃恢复和进程树关闭。

```ts
type RuntimeState =
  | { kind: 'stopped' }
  | { kind: 'starting'; attempt: number }
  | { kind: 'ready'; origin: string; version: string }
  | { kind: 'failed'; failure: RuntimeFailure };

interface RuntimeSupervisor {
  start(): Promise<Extract<RuntimeState, { kind: 'ready' }>>;
  stop(reason: 'quit' | 'restart' | 'update'): Promise<void>;
  subscribe(listener: (state: RuntimeState) => void): () => void;
}
```

接口保证：

- `start()` 幂等；并发调用共享同一次启动。
- `ready` 只会在子进程仍存活、origin 精确匹配、HTTP 就绪探测成功后返回。
- `stop()` 只作用于本模块创建并持有 PID/进程组的进程。
- 日志和错误在模块内部脱敏，调用方收到结构化失败分类。

内部测试 seam 包括 `ProcessAdapter`、`PortAllocator`、`ReadinessProbe` 和 `Clock`；这些不暴露给应用其他模块。

### `DesktopWindow`

负责主窗口的可信导航、加载/诊断状态、窗口持久化以及外部链接处理。模块内部保持一个本地静态 renderer 作为 44px 可拖动顶栏和启动/失败页面，并将官方 Harness 放入受限的 `WebContentsView`。二者是独立的 webContents。隔离 preload 使用只读 `ResizeObserver` 采集 Harness 侧栏的实际动画宽度，经主进程校验后更新顶栏 CSS 变量。它还暴露一个只含更新快照、订阅与 `check|install` 命令的窄桥；更新存在时在 Harness 品牌行挂载临时按钮，结构不匹配时失效关闭。

```ts
interface DesktopWindow {
  showLoading(): void;
  showHarness(origin: string): Promise<void>;
  showFailure(failure: RuntimeFailure): void;
  reveal(): void;
  dispose(): void;
}
```

`showHarness()` 只接受 `RuntimeSupervisor` 返回的 origin；模块内部再次校验协议为 `http:`、主机为 `127.0.0.1`、端口为当前启动端口。

### `Desktop Runtime Extensions`

桌面专属扩展是随包、固定版本的 Harness 客户端扩展，不通过 DOM 覆盖实现。构建时将 settings 与 companion 两个包放入内置 dsh 依赖树；启动时在应用独立的 Runtime Home 中创建只指向随包目录的符号链接，并通过 `desktop-extensions.patch.yml` 一次性叠加到 `web` profile。

- `@dsh-desktop/companion` 的 `AccountBalance` 在 Runtime 内解析 `DEEPSEEK_API_KEY` 并调用固定官方余额 endpoint。主进程使用每次 Runtime 启动新生成的 256-bit token 调用固定 loopback route；Harness preload 只暴露经过 shared schema 校验的 snapshot/subscribe/refresh。
- shell preload 与 Harness preload 是不同 Forge 产物。前者只处理本地 chrome 状态；后者只处理 Harness 观察与受限产品桥，余额 Key、Authorization header 和原始响应都不会跨越 Runtime 边界。

- “外观”调用官方 `ctx.theme.getTheme()` / `setTheme()`，因此浅色、深色、跟随系统及持久化只有一个事实来源。
- 隔离 preload 将 Harness 最终解析出的明暗模式和两个桌面 chrome 颜色归一化后转发给本地顶栏；后续风格按 [外观扩展契约](./08-appearance-extension.md) 同时提供 Harness 令牌与顶栏令牌。
- “关于”展示主进程提供的应用更新状态，以及构建时固定的 Harness、Node、pnpm 和 arm64 信息，不读取网页或系统敏感数据。
- 规划中的“宠物”页只展示 Pet Library 元数据并发送 `import|select|remove|set-enabled` 判别命令；`import` 不接受路径，由主进程打开系统选择器。
- 扩展只注册 `settings.section`，不获得 Electron、Node、文件系统或通用 IPC 能力；现有更新桥和未来 Pet Library 桥都保持独立、固定 schema，不能合并为通用 IPC。

### `PetLibrary` / `PetDirector` / `PetPlayer`（规划中，尚未实现）

Pet Library 管理 app-owned 内置/用户宠物、导入和选择；`PetPackageValidator` 在 staging 中验证声明式 `.yukipet` 后原子安装。`PetDirector` 只把 Harness activity 转为语义动作，Pet Stage Host 负责可信布局/气泡，`PetPlayer` 隐藏唯一动画运行时并位于专用非持久 session、仅含 one-shot MessagePort bootstrap preload、无父 DOM/Workspace bridge 的 sandboxed `WebContentsView`；页面主世界没有 Electron/Node API。四者的完整 Interface、尺寸状态与 Phase 6A–6E 见 [`11-pet-platform-plan.md`](11-pet-platform-plan.md)。

### `AppUpdater`

负责检查、下载和安装整个应用版本，不理解 dsh 包管理。

```ts
interface AppUpdater {
  check(): Promise<UpdateAvailability>;
  download(version: string): Promise<DownloadedUpdate>;
  installOnQuit(update: DownloadedUpdate): Promise<void>;
}
```

自动检查与手动检查复用同一个更新状态机。正式版启动 15 秒后检查，随后每 6 小时检查；生产使用固定的签名更新 feed。

### `AppCoordinator`

组合以上模块，处理单实例、macOS activate/open-url/before-quit 事件和有界恢复策略。它不直接 spawn、发 HTTP、拼接 dsh 参数或操作 BrowserWindow 安全选项。

## 启动序列

1. 获取单实例锁并创建日志器。
2. 初始化窗口并显示本地 Loading 页面。
3. `RuntimeSupervisor` 校验随包资源清单与架构。
4. 从回环地址分配可用端口，并以显式 `--host 127.0.0.1 --port <port>` 启动 dsh。
5. 设置独立 `DSH_HOME`，只传递明确白名单环境变量；不复制父进程环境到日志。
6. 对预期 origin 做带超时和退避的 HTTP 就绪探测，同时监控 child exit。
7. 就绪后让 `DesktopWindow` 在本地顶栏下方的隔离 `WebContentsView` 中加载 Harness UI。
8. 失败则终止残留进程并显示结构化诊断页。

不能假设 dsh 支持 `--port 0`。端口分配使用“临时监听获取端口后释放”的 adapter，并依靠后续 PID、origin 与就绪握手阻止误连；若绑定竞争失败，重新分配并重试。

## 退出与崩溃策略

- 关闭窗口：隐藏窗口，Harness 保持运行。
- `Cmd+Q` / Quit：停止接受重启，向 Harness 发送优雅终止，超时后只强制结束已记录的进程组。
- Harness 意外退出：指数退避重启，单次应用会话最多两次；连续失败进入诊断页。
- Electron renderer 崩溃：重建窗口并连接仍健康的 Harness；不立即重启 Harness。
- Electron main 崩溃：由操作系统结束应用；下次启动检测并清理本应用遗留的、具备所有权证明的进程记录。不能仅凭进程名清理。

## 数据目录

```text
~/Library/Application Support/<ProductName>/
├── desktop.json           # 窗口和应用偏好；原子写入
├── runtime/               # DSH_HOME，Harness 自有数据
├── logs/                  # 轮转且脱敏的桌面壳/运行时日志
├── diagnostics/           # 用户显式导出的诊断包
└── state/
    └── runtime-owner.json # PID、启动时间、随机实例标识、版本
```

缓存放入 `~/Library/Caches/<BundleId>/`，不与持久数据混放。应用升级不删除 `runtime/`；卸载说明必须明确数据不会随 `.app` 删除。

## 目标代码布局

```text
/
├── src/
│   ├── main/
│   │   ├── app-coordinator.ts
│   │   ├── runtime/
│   │   │   ├── runtime-supervisor.ts
│   │   │   ├── process-adapter.ts
│   │   │   ├── readiness-probe.ts
│   │   │   └── runtime-manifest.ts
│   │   ├── window/
│   │   │   └── desktop-window.ts
│   │   ├── update/
│   │   │   └── app-updater.ts
│   │   └── diagnostics/
│   ├── preload/           # shell/Harness 两份最小隔离 preload
│   └── renderer/          # Loading / Failure / 本地顶栏 / Desktop Companion；规划 Pet Stage
├── resources/
│   ├── runtime/           # 构建时生成，不手工修改
│   └── icons/
├── runtime/
│   ├── desktop-settings-plugin/  # 外观/关于；规划 Pet Library 设置页
│   ├── desktop-companion-plugin/ # 余额与后续 Companion seam
│   └── desktop-extensions.patch.yml
├── scripts/
│   ├── vendor-runtime.ts
│   ├── verify-runtime.ts
│   └── verify-release.ts
├── tests/
│   ├── fixtures/fake-harness/
│   ├── integration/
│   └── e2e/
└── docs/
```

## 运行时供应链

`scripts/vendor-runtime.ts` 是唯一的运行时装配入口：

1. 从版本清单读取 Node 与 dsh 精确版本、架构和预期哈希。
2. 下载或使用 CI 缓存中的官方 Node 发行物，验证官方 SHA-256。
3. 获取 dsh npm tarball及其 integrity，离线安装生产依赖到 staging。
4. 将桌面设置扩展和 profile overlay 复制到 staging，不在运行时联网安装插件。
5. 生成 `runtime-manifest.json`，记录版本、文件哈希、许可证和构建时间。
6. 对 staging 执行 `dsh --version` 和 `dsh web` 冒烟测试后才复制到应用资源。

应用运行时绝不执行 `npm install`、`npx` 或在线下载可执行代码。

## 兼容策略

- 每个应用版本只支持清单中的一个运行时版本。
- 升级 dsh 必须由独立 PR 完成：更新清单、运行契约测试、人工检查 UI、记录破坏性变化。
- 不使用 DOM selector 注入来实现核心功能；需要桌面/Harness 协作时优先使用稳定协议或官方插件 seam。
- 若 Harness 没有稳定的任务事件，通知功能保持关闭，不能通过轮询页面文本猜测状态。
