# 安全模型

## 信任关系

桌面壳、随包 Node 和固定版本 dsh 属于应用发行物；Harness UI 是本机受信页面，但仍按“可能被依赖或插件改变的 Web 内容”处理。用户项目、用户导入的宠物包、社区插件、模型输出、网页内容和更新网络均不受信。

主要资产包括 DeepSeek API Key、本地代码、会话记录、shell 权限、签名身份和更新通道。

## 首要威胁

1. 主窗口被导航到恶意网页后获得桌面权限。
2. 无认证的 Harness 监听到局域网地址，被其他设备控制。
3. 端口被抢占，桌面壳误连到未知本地进程。
4. Harness/插件输出中的秘密进入桌面日志或诊断包。
5. 更新或运行时依赖被篡改。
6. 退出时按名称杀进程，误伤用户自己的 Node/dsh。
7. Developer Preview 升级触发数据格式或插件兼容性损坏。
8. 用户宠物 archive 利用路径逃逸、压缩炸弹、脚本/远程资源或畸形动画 payload 获得权限或造成拒绝服务。

## 强制控制

### 窗口隔离

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

- 本地顶栏 renderer 与 Harness 使用不同的 webContents；Harness 只加载到下方 `WebContentsView`。隔离 preload 只读观察侧栏宽度，并通过固定 IPC channel 上报数值；主进程校验数值有限且位于当前窗口宽度内后才转发给本地顶栏。更新存在时，preload 只在 Harness 自有品牌行挂载一个无数据输入的小按钮；找不到预期品牌结构或更新消失时立即移除。
- 外观与关于页使用 Harness 官方插件插槽。桌面扩展随应用离线打包，只获得 Harness 的 slots、locale 和 theme 服务，不暴露 Electron/Node API，也不通过任意用户路径加载代码。外观同步 IPC 只接受 `light|dark` 和浏览器归一化的 `rgb/rgba` 颜色，拒绝选择器、CSS 代码、URL 与任意属性。规划中的宠物设置页只获得元数据、受控缩略图和无路径命令，不能读取动画 payload。
- 启动恢复只检查 Runtime Home 根目录下的常规文件 `settings.yaml`，使用与 Harness 相同的结构化 YAML 解析器。仅语法损坏或根节点不是映射时触发恢复；原文件以原权限重命名保存，新的空设置文件使用 `0600`，会话、凭据、工作区缓存和符号链接均不在自动恢复范围内。
- macOS 更新器仅在打包的 arm64 应用启用，feed 固定为公开仓库在 `update.electronjs.org` 上的架构专属 HTTPS 端点。Squirrel.Mac 要求当前应用和下载的更新均通过代码签名验证；开发包不会进入安装流程，更新安装前先停止本应用拥有的 Harness 进程。
- `contextBridge` 只向 Harness 暴露更新状态快照、订阅和 `check|install` 两个无参数命令。主进程再次校验固定命令枚举；`install` 仅在状态为 `downloaded` 时生效，不接受 URL、路径、shell 命令或任意参数。
- 使用 `will-navigate` 拒绝非当前可信 origin。
- `setWindowOpenHandler` 默认 deny；允许的 `https:` 外链交给系统浏览器。
- 拒绝新窗口、下载和权限请求，除非有明确产品场景与测试。
- 禁止关闭 TLS/ATS、`webSecurity` 或证书校验来解决开发问题。

### 网络与进程

- dsh 必须显式绑定 `127.0.0.1`，不能使用 `0.0.0.0`、`::` 或局域网地址。
- 主窗口 origin 来自本次启动结果，不来自配置文件、URL 参数或页面消息。
- 当前记录 child handle、PID 与进程组；终止前的启动时间所有权复核尚未实现。Companion RPC 使用的随机实例 token 只用于 loopback 请求鉴权，不能替代操作系统进程所有权证明。
- 每次 Runtime 启动生成新的 256-bit Companion token，只通过固定 allowlist child env 传递。主进程仅向固定 loopback route 发送该 token；禁止写入 RuntimeState、URL、renderer、日志或诊断包，旧 Runtime token 在重启后失效。
- 子进程环境使用 allowlist 构造。API Key 若由 Harness 依赖环境变量读取，可以传递但永不记录。
- 运行时目录权限尽可能设为用户私有；日志与导出文件创建时使用保守权限。

### 秘密和日志

- 桌面壳不新增第二份 API Key 存储；V1 由 Harness UI 和 Runtime Home 管理。
- 日志默认包含时间、版本、状态转换、退出码和错误分类，不包含请求正文、模型内容、环境变量全集和文件内容。
- 对常见 token 形态、Authorization header、查询参数做最终输出前脱敏。
- “复制诊断信息”必须先展示将复制的内容；诊断包生成需要用户显式操作。

### Workspace Preview

- Workspace 文件只能通过 main 中的 opaque capability node 打开；renderer 与 Harness 不能提交 root 或绝对路径。
- 普通文件使用 `O_NOFOLLOW` 打开句柄，读取前后比较 device、inode、size、mtime 与 ctime；symlink 换位拒绝，读取期间变化返回 `file-changed`。
- 文本使用 fatal UTF-8 解码，拒绝非法编码和 NUL binary；常见图片在进入 renderer 前同时限制压缩字节、单边 16384px 与 32MP 总像素。
- Markdown 只解析为 SafeMarkdown 的 heading、paragraph、blockquote、list、code、文本与受限 workspace-link 节点；HTML、MDX、远程图片、协议 URL 和事件属性没有可执行语义。workspace-link 只携带当前文件 opaque node 与经过长度、编码、协议和绝对路径校验的相对目标，主进程重新解析 containment 并拒绝越界、目录、特殊文件和 symlink。
- Workspace capability 改变时，main 关闭旧预览，shell preload 清空可重放 preview，renderer 立即释放旧正文与图片 data URL。

### Pet Package（规划中，尚未实现）

- 宠物只允许通过 main 打开的系统文件选择器导入单个 `.yukipet`；Harness/browser 不能提交源路径。
- Harness bridge 的 sender/origin 不能证明调用来自设置页或真实 user activation。所有 mutation 携带 `expectedRevision` 并限频；导入只有用户在系统文件选择器确认后生效，remove 还必须通过 main-owned 原生确认并先移动到 app-owned 可恢复 Trash。Built-in Pet 不可删除。
- 主进程把 archive 复制到随机 staging，拒绝绝对路径、`..`、NUL、重复/Unicode 冲突路径、symlink/hardlink、特殊文件、超限文件数/大小/压缩比，并校验 manifest schema、MIME、SHA-256、engine 和动作契约。
- 校验完整通过后才原子安装到 Application Support 的 app-owned Pet Library；不写入 Runtime Home 或 Workspace。内置宠物随签名应用交付且不可删除。
- Pet Package 只能包含所选 runtime 的声明式资产。JS/HTML/CSS、脚本动作、远程/Hosted 资产、外部字体、音频、任意 shader、原生模块和打开 URL 行为全部拒绝。
- Pet Stage 的可信布局/气泡留在本地 shell；用户动画只能进入专用非持久 session、无父 DOM/Workspace bridge 的 sandboxed `WebContentsView`。其唯一 preload 是随签名应用交付的 one-shot MessagePort bootstrap：只监听固定初始化 channel，严格校验有界的 protocol/epoch/nonce envelope 与恰好一个 port，转交后立即卸载监听；不使用 `contextBridge`，不向页面暴露 Electron/Node/IPC。main 通过该 port 定向交付签名 runtime bytes、已验证 pet bytes 和 presentation command，不使用 `file://`；协议绑定精确 frame、随机 epoch、nonce 和 generation，限消息大小/速率，导航、销毁或切宠物立即撤销旧 port。
- player document 使用 `connect-src 'none'` 和精确本地 asset 指令；其专用 Electron session 只对已登记 player view/frame fail-closed 地拒绝 HTTP(S)/WS(S)、导航/new-window/download/permission，不影响 Harness、更新器或 shell session。sandbox/CSP/请求过滤任一单层都不被当作完整断网机制。
- 语义 probe 使用同样的 bootstrap-only、页面无 Electron/Node API、无网络、用后销毁的隔离承载，main 在 5 秒 deadline 后可从外部强制销毁；production player 若卡死/崩溃，由 main watchdog 只重建专用 PetPlayer view 并隔离该包，Harness、shell 与任务不 reload。候选 runtime 无法在此 view 中工作就淘汰，不能退回 shell main world。
- Phase 6B 在 runtime 未选定时只把通过通用 envelope preflight 的包密封到开发态隔离 Inbox，不能进入 Pet Library 或 player；Phase 6D 深层 parser/probe 全部通过后才允许开发态原子安装，Phase 6E 冻结 v1 后才开放生产导入。
- 选择器原始路径、宠物素材和 payload 字节不进入设置、日志或诊断包。player 失败只回退内置宠物或隐藏 Pet Stage，不 reload Harness。

详细硬限制、错误和导入序列见 [`11-pet-platform-plan.md`](11-pet-platform-plan.md)。这不违反固定 Runtime 决策：宠物包是应用数据，不是可执行 Runtime 或 Harness 插件。

### 供应链与更新

- lockfile、精确依赖版本、npm integrity、Node 官方 SHA-256 和运行时清单全部进入验证链。
- 桌面设置扩展及 profile overlay 是应用源码的一部分，由 `runtime:vendor` 复制进同一只读运行时资源；Runtime Home 中只创建指向该随包扩展的可验证符号链接，若目标路径被非链接文件占用则拒绝覆盖。
- CI 中的签名、公证凭据仅存在于发布 job；来自 fork 的工作流不得访问。
- 应用使用 Developer ID Application 签名、Hardened Runtime 和 Apple notarization；发布物附 SHA-256。
- 更新只接受相同签名身份的应用包；不提供跳过签名验证开关。
- dsh 不独立热更新，避免未验证运行时与旧桌面壳组合。

## macOS 分发约束

选择站外 Developer ID 分发而非 Mac App Store。MAS 强制 App Sandbox，而 Harness 的核心用途包括在用户授权范围内启动开发工具、执行 shell 和访问代码仓库。我们仍启用 Hardened Runtime，但不声称桌面应用本身提供完整 OS 级沙箱；工具授权与项目访问策略继续由 Harness 承担。

签名必须覆盖 `.app` 内嵌的 Electron helpers、Node sidecar 和所有 Mach-O/原生模块。发布验证至少执行：

```bash
codesign --verify --deep --strict --verbose=2 "DeepSeek YukiRyou.app"
spctl --assess --type execute --verbose=4 "DeepSeek YukiRyou.app"
xcrun stapler validate "DeepSeek YukiRyou.app"
```

## 安全门槛

- 任何能够让 Web 内容执行任意 Node/Electron 操作的 preload 接口均阻塞发布。
- 任何非 loopback 监听均阻塞发布。
- 未签名、未公证或哈希不匹配的正式构建均阻塞发布。
- 发现诊断包包含 token、项目内容或完整环境变量均阻塞发布。
- 社区插件不属于默认可信计算基；应用不得静默预装。
- 未经完整验证的宠物包可进入 Pet Library，或宠物包能够执行代码、联网、暴露路径/动画 payload 给 Harness，均阻塞发布。
