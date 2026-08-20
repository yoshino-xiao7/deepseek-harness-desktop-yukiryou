# 安全模型

## 信任关系

桌面壳、随包 Node 和固定版本 dsh 属于应用发行物；Harness UI 是本机受信页面，但仍按“可能被依赖或插件改变的 Web 内容”处理。用户项目、社区插件、模型输出、网页内容和更新网络均不受信。

主要资产包括 DeepSeek API Key、本地代码、会话记录、shell 权限、签名身份和更新通道。

## 首要威胁

1. 主窗口被导航到恶意网页后获得桌面权限。
2. 无认证的 Harness 监听到局域网地址，被其他设备控制。
3. 端口被抢占，桌面壳误连到未知本地进程。
4. Harness/插件输出中的秘密进入桌面日志或诊断包。
5. 更新或运行时依赖被篡改。
6. 退出时按名称杀进程，误伤用户自己的 Node/dsh。
7. Developer Preview 升级触发数据格式或插件兼容性损坏。

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

- 本地顶栏 renderer 与 Harness 使用不同的 webContents；Harness 只加载到下方 `WebContentsView`。隔离 preload 只读观察侧栏宽度，并通过固定 IPC channel 上报数值；主进程校验数值有限且位于当前窗口宽度内后才转发给本地顶栏。更新存在时，preload 只在 Harness 侧栏右下角显示固定图标入口；找不到预期侧栏结构或更新消失时立即移除。
- 外观与关于页使用 Harness 官方插件插槽。桌面扩展随应用离线打包，只获得 Harness 的 slots、locale 和 theme 服务，不暴露 Electron/Node API，也不通过任意用户路径加载代码。外观同步 IPC 只接受 `light|dark` 和浏览器归一化的 `rgb/rgba` 颜色，拒绝选择器、CSS 代码、URL 与任意属性。
- 启动恢复只检查 Runtime Home 根目录下的常规文件 `settings.yaml`，使用与 Harness 相同的结构化 YAML 解析器。仅语法损坏或根节点不是映射时触发恢复；原文件以原权限重命名保存，新的空设置文件使用 `0600`，会话、凭据、工作区缓存和符号链接均不在自动恢复范围内。
- macOS 更新器仅在打包的 arm64 应用启用，feed 固定为公开仓库在 `update.electronjs.org` 上的架构专属 HTTPS 端点。Squirrel.Mac 要求当前应用和下载的更新均通过代码签名验证；开发包不会进入安装流程，更新安装前先停止本应用拥有的 Harness 进程。
- `contextBridge` 只向 Harness 暴露更新状态快照、订阅和 `check|install` 两个无参数命令。主进程再次校验固定命令枚举；`install` 仅在状态为 `downloaded` 时生效，不接受 URL、路径、shell 命令或任意参数。
- 使用 `will-navigate` 拒绝非当前可信 origin。
- `setWindowOpenHandler` 默认 deny；允许的 `https:` 外链交给系统浏览器。
- 拒绝新窗口、下载和权限请求，除非有明确产品场景与测试。
- 禁止关闭 TLS/ATS、`webSecurity` 或证书校验来解决开发问题。

### 网络与进程

- dsh 必须显式绑定 `127.0.0.1`，不能使用 `0.0.0.0`、`::` 或局域网地址。
- `runtime-endpoint.json` 与旧版 ready 日志只提供候选 loopback endpoint，不直接建立信任。一次性旧日志迁移按物理顺序采用最后 ready origin，但会等待轮转日志中保留的全部不同 ready 端口释放；任一仍被占用时必须在写入 endpoint 状态、复制或打开 Runtime Home 前失败关闭，绝不加载占用者页面，也不另起 rc.8 与可能遗留的 rc.7 并发写同一目录。该保护以候选 endpoint 仍可从状态或旧日志恢复为前提；`v0.2.1-beta.2` 被强杀且 ready 日志同时丢失时无法可靠发现 detached rc.7 Runtime，因此规范升级路径要求先重启系统。URL 参数、页面消息和任意配置不能指定可信 origin。
- 每次 Runtime 启动生成新的 256-bit Companion secret，只通过固定 allowlist child env 传递。就绪探测向固定 route 发送随机 nonce，响应者必须返回该 secret 计算的 HMAC；secret 本身不进入请求、RuntimeState、URL、renderer、日志或诊断包。只有 child 仍存活、首页就绪且 HMAC 正确时，候选 endpoint 才升级为可信 origin。
- HMAC 只证明响应者持有本次启动 secret，不等于 OS PID/启动时间身份，也不防御已经以同一用户权限运行、能够读取进程环境或注入 Runtime 的恶意代码。主进程仍只终止自己持有的 child/进程组；Companion 内的 owner watchdog 在父 PID 改变后主动退出，端口释放超时则呈现可操作故障，禁止按进程名清理。
- 同一 secret 同时鉴权 Companion RPC；旧 Runtime secret 在重启后失效。终止前的 OS 启动时间复核尚未实现，不能把应用描述为提供操作系统级进程隔离。
- 子进程环境使用 allowlist 构造。API Key 若由 Harness 依赖环境变量读取，可以传递但永不记录。
- 运行时目录权限尽可能设为用户私有；日志与导出文件创建时使用保守权限。

### 秘密和日志

- 桌面壳不新增第二份 API Key 存储；V1 由 Harness UI 和 Runtime Home 管理。
- 日志默认包含时间、版本、状态转换、退出码和错误分类，不包含请求正文、模型内容、环境变量全集和文件内容。
- 对常见 token 形态、Authorization header、查询参数以及 Companion secret 的 env/object/JSON 形态做最终输出前脱敏。
- “复制诊断信息”必须先展示将复制的内容；诊断包生成需要用户显式操作。

### Workspace Preview

- Workspace 文件只能通过 main 中的 opaque capability node 打开；renderer 与 Harness 不能提交 root 或绝对路径。
- 普通文件使用 `O_NOFOLLOW` 打开句柄，读取前后比较 device、inode、size、mtime 与 ctime；symlink 换位拒绝，读取期间变化返回 `file-changed`。
- 文本使用 fatal UTF-8 解码，拒绝非法编码和 NUL binary；常见图片在进入 renderer 前同时限制压缩字节、单边 16384px 与 32MP 总像素。
- Markdown 只解析为 SafeMarkdown 的 heading、paragraph、blockquote、list、code、文本与受限 workspace-link 节点；HTML、MDX、远程图片、协议 URL 和事件属性没有可执行语义。workspace-link 只携带当前文件 opaque node 与经过长度、编码、协议和绝对路径校验的相对目标，主进程重新解析 containment 并拒绝越界、目录、特殊文件和 symlink。
- Workspace capability 改变时，main 关闭旧预览，shell preload 清空可重放 preview，renderer 立即释放旧正文与图片 data URL。

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
