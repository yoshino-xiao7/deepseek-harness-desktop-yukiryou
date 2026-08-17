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

- 本地顶栏 renderer 与 Harness 使用不同的 webContents；Harness 只加载到下方 `WebContentsView`，不向其 DOM 注入拖动层或样式。隔离 preload 只读观察侧栏宽度，并通过固定 IPC channel 上报数值；主进程校验数值有限且位于当前窗口宽度内后才转发给本地顶栏。
- 外观与关于页使用 Harness 官方插件插槽。桌面扩展随应用离线打包，只获得 Harness 的 slots、locale 和 theme 服务，不暴露 Electron/Node API，也不通过任意用户路径加载代码。外观同步 IPC 只接受 `light|dark` 和浏览器归一化的 `rgb/rgba` 颜色，拒绝选择器、CSS 代码、URL 与任意属性。
- 启动恢复只检查 Runtime Home 根目录下的常规文件 `settings.yaml`，使用与 Harness 相同的结构化 YAML 解析器。仅语法损坏或根节点不是映射时触发恢复；原文件以原权限重命名保存，新的空设置文件使用 `0600`，会话、凭据、工作区缓存和符号链接均不在自动恢复范围内。
- macOS 更新器仅在打包的 arm64 应用启用，feed 固定为公开仓库在 `update.electronjs.org` 上的架构专属 HTTPS 端点。Squirrel.Mac 要求当前应用和下载的更新均通过代码签名验证；开发包不会进入安装流程，更新安装前先停止本应用拥有的 Harness 进程。
- V1 Harness UI 不需要 preload 接口；若新增，只通过 `contextBridge` 暴露窄、可验证、无任意路径/命令参数的能力。
- 使用 `will-navigate` 拒绝非当前可信 origin。
- `setWindowOpenHandler` 默认 deny；允许的 `https:` 外链交给系统浏览器。
- 拒绝新窗口、下载和权限请求，除非有明确产品场景与测试。
- 禁止关闭 TLS/ATS、`webSecurity` 或证书校验来解决开发问题。

### 网络与进程

- dsh 必须显式绑定 `127.0.0.1`，不能使用 `0.0.0.0`、`::` 或局域网地址。
- 主窗口 origin 来自本次启动结果，不来自配置文件、URL 参数或页面消息。
- 记录 child handle、PID、进程组、随机 owner token 和启动时间；终止前重新验证所有权。
- 子进程环境使用 allowlist 构造。API Key 若由 Harness 依赖环境变量读取，可以传递但永不记录。
- 运行时目录权限尽可能设为用户私有；日志与导出文件创建时使用保守权限。

### 秘密和日志

- 桌面壳不新增第二份 API Key 存储；V1 由 Harness UI 和 Runtime Home 管理。
- 日志默认包含时间、版本、状态转换、退出码和错误分类，不包含请求正文、模型内容、环境变量全集和文件内容。
- 对常见 token 形态、Authorization header、查询参数做最终输出前脱敏。
- “复制诊断信息”必须先展示将复制的内容；诊断包生成需要用户显式操作。

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
