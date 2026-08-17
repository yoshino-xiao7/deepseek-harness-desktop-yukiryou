# 测试与发布

## 测试策略

测试从深模块接口观察行为，不依赖私有函数或 Harness UI 的 DOM 结构。

### 单元测试

- `RuntimeSupervisor`：并发幂等启动、端口竞争、就绪超时、child 提前退出、两次重启上限、停止幂等、所有权验证。
- `DesktopWindow`：可信 origin、导航拒绝、外链转交、窗口关闭/激活语义。
- `AppCoordinator`：单实例、quit 状态机、renderer 崩溃和 Harness 崩溃的不同恢复路径。
- 日志脱敏：token、header、路径参数和嵌套错误对象。
- 运行时清单：架构、哈希、版本和缺失文件。

内部 I/O 使用 production adapter 与 fake adapter。fake 必须模拟失败和时间，不使用真实 `sleep`。

### 集成测试

`tests/fixtures/fake-harness` 提供可控本地子进程：延迟就绪、返回错误、占用端口、启动后退出、忽略 SIGTERM。测试真实 spawn/HTTP/进程组逻辑，但不调用模型。

对固定版本官方 dsh 运行契约测试：

- CLI 可执行并返回预期版本。
- `web --host 127.0.0.1 --port <port>` 可启动。
- 就绪 URL 与重定向行为符合探测器预期。
- Runtime Home 隔离有效。
- SIGTERM/超时终止行为已记录。

### Electron 端到端测试

- 干净用户目录首次启动。
- Harness UI 加载、刷新、窗口关闭与 Dock 激活。
- 3080 被占用时使用其他端口。
- 恶意导航、`window.open` 和权限请求被拒绝。
- Runtime 崩溃后恢复；超过重试上限显示诊断页。
- Quit 后不存在本应用拥有的子进程。

### 稳定性命令

```bash
pnpm test:stress # 100 次启动、就绪、停止与端口回收
pnpm test:soak   # 连续 8 小时健康探测，发布候选冻结后执行
```

日常 `test:integration` 会执行一次压力循环和 100ms soak 冒烟；正式的 8 小时 soak 属于发布候选验证，不在每次开发检查中阻塞运行。

### 手工发布矩阵

| 维度 | 必测值 |
| --- | --- |
| 架构 | Apple Silicon arm64；Intel x64 为后续可选矩阵 |
| 系统 | macOS 14、当前最新 macOS |
| 安装方式 | DMG 首装、覆盖安装、ZIP 自动更新 |
| 网络 | 正常、离线启动、API 不可达 |
| 数据 | 全新、上一版本升级、损坏的桌面偏好 |
| 端口 | 默认空闲、默认占用、竞争失败 |

## CI 流水线

### Pull request

1. `pnpm install --frozen-lockfile`
2. format/lint/typecheck
3. 单元测试与集成测试
4. arm64 开发包构建和 fake-harness E2E
5. 依赖许可证与运行时清单检查

### Release tag

1. 在对应架构的 macOS runner 上装配并验证 runtime。
2. 运行唯一入口 `pnpm release:mac`：构建 arm64 App、Developer ID 签名、制作并签名 DMG。
3. 只提交 DMG 一次；Accepted 后 staple App/DMG，并强制执行 `codesign`、`spctl`、`hdiutil` 与 ticket 验证。
4. 从已 staple 的 App 生成更新 ZIP，同时生成 SHA-256 和记录 Git commit/Submission ID 的 manifest。
5. 完成安装后冒烟、SBOM、第三方许可证和 release notes。
6. 发布到 draft；核对 tag、manifest 和附件哈希后再公开并更新 feed。

正式发布必须从干净 tag 构建。CI 不允许在签名后修改 `.app` 内容。

## 版本策略

- 应用使用 SemVer。
- `0.x` 阶段允许桌面内部实现变化，但用户数据迁移必须保持向后可恢复。
- 运行时版本记录在应用 About、运行时清单和 release notes 中。
- dsh 升级不必驱动应用 major version；若造成用户可见配置/会话不兼容，必须在 release notes 和迁移测试中明确。

## 发布与回滚

- 更新默认分批：先手动下载验证，再开放自动检查。
- V1 使用 `https://update.electronjs.org/yoshino-xiao7/deepseek-yukiryou/darwin-arm64/<version>` 读取公开 GitHub Release；ZIP 文件名必须同时包含 `darwin` 与 `arm64`。
- 更新 feed 保留上一个稳定版本下载链接和校验值。
- 桌面偏好迁移采用“读取旧版、写入新临时文件、原子替换”；失败则回退默认偏好。
- 不自动降级 Harness 数据格式。若新版 dsh 写入不可逆格式，发布前必须提供备份/恢复策略，否则不升级该运行时。
- 用户回滚应用时不得自动删除 Runtime Home。

## 发布完成定义

- 所有自动化检查和手工矩阵通过。
- 安全门槛无例外。
- arm64 的 DMG/ZIP、哈希、许可证、SBOM 和 release notes 齐全。
- 从上一稳定版本升级验证完成。
- 新安装与卸载/数据保留说明已更新。
