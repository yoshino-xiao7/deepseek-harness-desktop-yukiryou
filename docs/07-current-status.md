# 当前实现状态

更新时间：2026-08-17。

## 已完成

- Electron Forge + TypeScript + pnpm 可复现工程基线；主进程与 preload 使用显式 CommonJS 产物，避免 ESM/CJS 启动冲突。
- 固定 Node.js 24.19.0、`@deepseek-ai/dsh` 0.1.0-rc.6、pnpm 10.34.5及其校验值。
- `runtime:vendor` 按架构装配运行时、校验 Node SHA-256、执行版本冒烟并原子替换资源目录。
- Runtime Home 与用户全局 dsh 隔离；运行时 PATH 只显式加入内置 Node/pnpm。
- `RuntimeSupervisor` 负责随机回环端口、真实 HTTP 就绪探测、进程组终止和结构化失败。
- 主窗口启用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`；只允许当前 Harness origin，HTTPS 外链交给系统浏览器。
- 单实例、Dock 恢复、关闭隐藏、显式退出、重启 Harness、刷新 UI 和打开日志。
- 使用 `hiddenInset` 原生交通灯和 44px 本地一体化顶栏；顶栏提供原生拖动区域，官方 Harness 页面独立承载于下方 `WebContentsView`。顶栏背景分界通过隔离 preload 的 `ResizeObserver` 逐帧跟随侧栏展开、收起和拖拽宽度。
- 设置弹窗新增“外观”和“关于”页面：外观复用 Harness 官方主题服务，支持浅色、深色、跟随系统和原生持久化；关于页展示固定版本及 Apple Silicon 架构信息。两页通过官方 `settings.section` 插槽离线注册，不修改 Harness DOM。Harness 已解析的主题通过受限外观桥同步到本地顶栏，为后续整套风格注入提供统一入口。
- 产品正式更名为 DeepSeek YukiRyou，使用白底 YukiRyou 鲸鱼女仆品牌图标、独立 Bundle ID、重写后的 README 和品牌化关于页。
- 首次以新名称启动时会合并复制旧 `DSH Desktop` 用户数据，并写入迁移标记；旧目录保留为可恢复备份。
- 关于页展示开发者 GitHub `yoshino-xiao7`，点击后由系统浏览器打开主页。
- 运行时意外退出最多自动重启两次；失败页支持手动重试、打开日志和复制脱敏诊断。
- 应用日志按 2 MiB 自动轮转并保留 3 份历史；故障页和应用菜单可导出 ZIP 诊断包，包内仅包含脱敏后的环境摘要与桌面日志。
- 启动时校验 Harness `settings.yaml`；语法损坏或根节点类型错误时保留带时间戳的 `.corrupt-*` 原文件，创建权限为 `0600` 的空设置并提示用户，会话、凭据与工作区数据不受影响。
- Apple Silicon `.app`、DMG 和 ZIP 构建成功；打包应用真实启动官方 Harness 的 Playwright 测试通过。
- 运行时生产依赖审计为 0 个已知漏洞；内置 pnpm 已从存在高危公告的 10.33.2 升级到 10.34.5。

## 自动验证现状

```text
Unit:        30 passed
Integration: 4 passed（fake Harness、真实 dsh、内置 pnpm、打包契约）
E2E arm64:   1 passed（真实打包应用 + 官方 Harness + 外观/关于设置 + Harness/顶栏主题同步 + 侧栏动画逐帧同步 + 拖动区域 + Electron 隔离选项）
Artifacts:   arm64 DMG + ZIP generated
```

`verify:release` 会检查桌面可执行文件、内置 Node 和运行时清单的架构一致性；正式发布模式还能强制验证 Developer ID 签名与 notarization ticket。

## 当前产物

- `out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app`
- `out/make/DeepSeek YukiRyou-0.1.0-arm64.dmg`
- `out/make/zip/darwin/arm64/DeepSeek YukiRyou-darwin-arm64-0.1.0.zip`

这些是未签名开发产物，适合本机验证，不应直接作为公开下载版本。

## 继续执行前需要的发布资料

1. Apple Developer Team 与 Developer ID Application 证书。
2. App Store Connect API Key 或 Keychain notarization profile。
3. 更新包托管地址与签名更新 feed。

拿到以上资料后执行 Phase 4：Hardened Runtime 签名、Apple 公证/staple、Gatekeeper 验证、更新器、SBOM/许可证与正式 release runbook。

## 尚未完成的非发布项

- renderer 崩溃的独立重建测试、100 次启停压力测试和 8 小时 soak test。
- Harness 缺少已验证的稳定任务事件接口，因此通知功能按方案延期，不使用 DOM 文本猜测。
- Intel 原生机器上的 x64 E2E；当前用户设备与交付目标为 Apple Silicon。
