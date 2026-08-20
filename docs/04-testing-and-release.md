# 测试与发布

## 测试策略

测试从深模块接口观察行为，不依赖私有函数或 Harness UI 的 DOM 结构。

### 单元测试

- `RuntimeSupervisor`：并发幂等启动、端口竞争、就绪超时、child 提前退出、两次重启上限、停止幂等、所有权验证。
- `DesktopWindow`：可信 origin、导航拒绝、外链转交、窗口关闭/激活语义。
- `AppCoordinator`：单实例、quit 状态机、renderer 崩溃和 Harness 崩溃的不同恢复路径。
- 日志脱敏：token、header、路径参数和嵌套错误对象。
- 运行时清单：source manifest、production lock、DSH integrity 与 install-script allowlist 必须精确对齐。
- `AccountBalance`：官方 schema 映射、decimal string 保真、single-flight、TTL、超时、body/schema 上限、错误分类与 stale last-good。
- `Workspace Authority`：只有属于注册 Workspace 的 Session 才返回 canonical root；错误 Workspace、畸形 ID 和非 ok 状态 fail closed。
- `WorkspaceInspector`：opaque node、懒加载目录、深度/条目/字节/图片像素上限、fatal UTF-8、`O_NOFOLLOW` 稳定文件读取、symlink 换位拒绝、跨 capability ID 拒绝、Markdown 专用结果和相对 HEAD 的真实 diff。
- `SafeMarkdown`：HTML、SVG/MathML、iframe/object、远程与 data 图片、`javascript:`/`file:` 链接、事件属性、深层列表和 fenced script 只产生安全结构和 inert text；只有受限相对文件链接产生 workspace-link，随后仍需 WorkspaceInspector containment 复核。
- `ReviewTargetStore`：先到 preview 可重放；Workspace capability 改变后清空正文并通知当前 renderer 释放内存。
- `BoundedLruCache`：按最近使用顺序维持 64 MiB preview 上限，单项超限不保留，文件 revision 改变后不得命中旧正文。
- `companionLayout`：固定覆盖 820/980/1180/1480px，分别验证 overlay、docked、Review Focus 与 wide review，不允许最小窗口宽度令某个模式不可达；宠物阶段增加 `open`/preferredWidth 分离、340px min clamp、动态 max、继续右拖不关闭及重开恢复。
- `PetPackageValidator` / `PetLibrary`（规划）：archive/schema/hash/MIME/runtime/动作契约、重复导入、内置不可删、expected revision、无确认 remove 拒绝、可恢复 Trash、active fallback、索引重建和 future schema fail-closed。
- `PetDirector` / `PetPlayer`（规划）：fake clock/random/completion generation、快速 run/idle、睡眠中运行、用户唤醒、隐藏暂停、resize 不重置和 dispose。

内部 I/O 使用 production adapter 与 fake adapter。fake 必须模拟失败和时间，不使用真实 `sleep`。

### 集成测试

`tests/fixtures/fake-harness` 提供可控本地子进程：延迟就绪、返回错误、占用端口、启动后退出、忽略 SIGTERM。测试真实 spawn/HTTP/进程组逻辑，但不调用模型。

对固定版本官方 dsh 运行契约测试：

- CLI 可执行并返回预期版本。
- 内置 Node、`pty.node`、`spawn-helper` 架构一致，真实 PTY 往返、sharp 1×1 PNG 和 koffi 加载通过。
- `web --host 127.0.0.1 --port <port>` 可启动。
- 就绪 URL 与重定向行为符合探测器预期。
- Runtime Home 隔离有效。
- SIGTERM/超时终止行为已记录。
- settings/companion 两个随包扩展同时加载；余额 RPC 拒绝无 token 请求，正确 token 只返回脱敏快照，RuntimeState 不包含 token。

### Electron 端到端测试

- 稳定启动门禁只依赖桌面壳与 Harness origin/readyState 契约，并允许通过 `DSH_E2E_EXECUTABLE_PATH` 指向全新 runner 实际安装的候选。
- 干净用户目录首次启动。
- Harness UI 加载、刷新、窗口关闭与 Dock 激活。
- 3080 被占用时使用其他端口。
- 恶意导航、`window.open` 和权限请求被拒绝。
- Runtime 崩溃后恢复；超过重试上限显示诊断页。
- Quit 后不存在本应用拥有的子进程。
- `sidebar.footer.action` 余额卡在宽栏可见、rail 可收起；Harness bridge 形状固定且本地 shell 页面检测不到余额 bridge。
- 本地 toolbar 可开关 Desktop Companion；干净用户目录无 Session 时显示安全空状态，shell bridge 拒绝绝对路径，关闭面板恢复 Harness 宽度。
- 宠物阶段：设置页中英文资产库、导入取消/拒绝/成功、选择/删除/重启恢复；左边界指针与键盘 resize 到最小值后不关闭，右上开关仍可完全隐藏；Pet Stage wake、running/eating、reduced motion 和 player failure 不影响文件区/Harness。

### 宠物真机与敌意输入矩阵（规划）

- hostile `.yukipet` 覆盖 Zip Slip、压缩炸弹、重复/NFD/大小写冲突路径、symlink/hardlink、假 MIME、hash 不符、future schema、未知 runtime/asset format、缺动作、remote/script 和超时 payload。
- 选定动画运行时前，先验证非动画专业用户只用角色参考图和自然语言即可由项目流程生成技术样片；依赖手工专有编辑器导出的候选直接淘汰。随后仅对 Creator Gate 通过项在 packaged arm64 Electron 中比较离线、许可、流畅度、资源和稳定性，并只保留一个 Adapter。
- production player 执行 30 分钟连续播放、100 次切换/隐藏、系统休眠恢复、player view/renderer recovery、light/dark/system、340/380/560px 面板和 820/980/1320px 窗口矩阵；隔离测试证明 one-shot bootstrap 只转交一个 port 且不暴露 API，player 页面看不到 shell/Harness bridge、Electron/Node、父 DOM、Workspace preview 或其他 session data，其崩溃只重建该 view。
- 自动 frame-time/CPU/内存/bounds/anchor 检查之外，必须输出 1x、0.25x 与慢放录制供产品所有者验收角色身份和动作自然度。

### 稳定性命令

```bash
pnpm test:stress # 100 次启动、就绪、停止与端口回收
pnpm test:soak   # 连续 8 小时健康探测，发布候选冻结后执行
pnpm test:memory # 打包应用 2500 次侧栏/标签变化与 working-set 门禁
pnpm test:upgrade # 真实 0.1.0 产物版本 + 旧 Runtime Home 保留门禁
pnpm test:soak:app # 打包应用 60 秒 shell/Harness/进程/内存资格测试
pnpm test:soak:app:release # 正式候选 30 分钟打包应用 soak
pnpm test:soak:app:extended # 独立工作流 5 小时扩展 soak
```

日常 `test:integration` 会执行一次压力循环和 100ms soak 冒烟；本机发布资格使用 60 秒真实打包应用 soak。正式流水线在异机安装后、公证前执行 30 分钟真实候选 soak，避免普通 Beta 发布被长时间阻塞。5 小时扩展 soak 由独立工作流手动触发并每周低峰执行，不阻塞签名、公证或发布。

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

1. 第一台 Apple Silicon runner 使用 Electron Forge 官方 `osxSign` 生成签名候选。
2. 第二台全新 runner 下载候选、模拟 quarantine、复制到 `/Applications`，执行签名/证书链/架构、包内原生模块验证，并真实启动精确候选直到 Harness 就绪，然后产生绑定 SHA-256 与 commit 的回执。
3. 只有回执与候选完全匹配，第三台 runner 才提交 Apple 一次；Accepted 后检查公证日志、staple 并生成最终 DMG/ZIP。
4. 第四台全新 runner 分别安装最终 DMG/ZIP，执行 `codesign`、`spctl`、ticket、架构、校验和，并再次启动精确的最终应用直到 Harness 就绪。
5. 全部通过后创建 Draft；独立发布工作流从 Draft 重新下载并再次安装验收，通过后才发布 prerelease。任何失败都不得创建公开 Release。

正式发布必须从干净 commit 构建。CI 不允许在签名后修改 `.app` 内容，也不允许覆盖已经存在的版本或 tag。

## 版本策略

- 应用使用 SemVer。
- `0.x` 阶段允许桌面内部实现变化，但用户数据迁移必须保持向后可恢复。
- 运行时版本记录在应用 About、运行时清单和 release notes 中。
- dsh 升级不必驱动应用 major version；若造成用户可见配置/会话不兼容，必须在 release notes 和迁移测试中明确。

## 发布与回滚

- 更新默认分批：先手动下载验证，再开放自动检查。
- V1 使用 `https://update.electronjs.org/yoshino-xiao7/deepseek-harness-desktop-yukiryou/darwin-arm64/<version>` 读取公开 GitHub Release；ZIP 文件名必须同时包含 `darwin` 与 `arm64`。
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
