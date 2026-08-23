<p align="center">
  <img src="resources/icons/deepseek-yukiryou.png" width="168" alt="DeepSeek YukiRyou">
</p>

<h1 align="center">DeepSeek YukiRyou — DeepSeek Harness Desktop for macOS & Windows</h1>

<p align="center">
  <strong>让 DeepSeek Harness 真正成为桌面应用。</strong><br>
  面向 macOS 与 Windows 的独立工作台：内置运行时、Workspace Review、受管插件市场与可恢复的桌面生命周期。
</p>

<p align="center">
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/yoshino-xiao7/deepseek-harness-desktop-yukiryou?style=flat-square&color=3157a4"></a>
  <img alt="macOS 14+" src="https://img.shields.io/badge/macOS-14%2B-111827?style=flat-square&logo=apple">
  <img alt="Apple Silicon" src="https://img.shields.io/badge/Apple%20Silicon-arm64-3157a4?style=flat-square">
  <img alt="Windows 11 x64" src="https://img.shields.io/badge/Windows%2011-x64-3157a4?style=flat-square&logo=windows11">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-6b7280?style=flat-square"></a>
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases">下载应用</a>
  ·
  <a href="docs/README.md">开发文档</a>
  ·
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues">反馈问题</a>
  ·
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou">⭐ Star 支持</a>
</p>

<p align="center">
  如果这个项目对你有帮助，欢迎点一个 Star。它能帮助更多正在寻找 DeepSeek Harness 桌面客户端的人发现本项目。
</p>

---

## 项目定位

官方 DeepSeek Harness 提供 Web UI，但日常使用仍需要准备运行环境、启动命令、管理本地端口和处理异常退出。DeepSeek YukiRyou 把这些工作收进一个可安装的跨平台桌面应用：应用启动时拉起内置 Harness，退出时回收自己创建的进程，并用原生窗口承载完整 Web UI。

它不是 Harness 的重写版本，也不会改变 Agent 的工作方式。它专注于把 Harness 稳定、安全、可恢复地交付到桌面，并在官方界面之外补足账户状态、工作区文件和变更审核等桌面能力。

> 当前产品支持 Apple Silicon macOS 14+ 与 Windows 11 x64。macOS 提供签名、公证的 DMG 与 ZIP；Windows 提供未签名安装 EXE 与便携 ZIP，并在下载说明中明确展示来源、SHA-256 与 SmartScreen 风险。

| 打开即用 | 原生体验 | 可诊断 | 安全更新 |
| --- | --- | --- | --- |
| 内置固定版本的 Node.js、pnpm 与 Harness | 平台化窗口、主题同步、响应式 Workspace Review | 自动恢复运行时、日志轮转、脱敏诊断包 | macOS 签名/公证；Windows 真实安装生命周期候选门禁 |

## 下载与安装

### macOS

前往 [GitHub Releases](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases)，下载适用于 Apple Silicon 的 DMG：

```text
DeepSeek.YukiRyou-<version>-arm64.dmg
```

1. 打开 DMG。
2. 将 **DeepSeek YukiRyou** 拖入“应用程序”。
3. 从 Launchpad 或“应用程序”目录启动。
4. 在 Harness 界面中完成所需的服务配置，然后开始工作。

系统要求：Apple Silicon Mac（M1 或更新芯片）、macOS 14 或更高版本。

每个正式版本同时提供 SHA-256 校验文件。macOS 应用和更新包均使用 Developer ID 签名并经过 Apple 公证。海外发行以 GitHub Releases 为源；中国大陆自动选择受 ESA 保护的 `download-cn.suzuki.ink` 国内镜像，镜像只会在 GitHub 公开发布及全部校验通过后同步，失败时回退 GitHub。官网可读取国内镜像的 `downloads/latest.json`，自动取得当前版本四个安装包的版本化直链、大小与 SHA-256。

### Windows

Windows 11 x64 每个版本提供两份公开产物：

```text
DeepSeek.YukiRyou-<version>-win32-x64-Setup.exe
DeepSeek.YukiRyou-win32-x64-<version>-portable.zip
```

EXE 是可修改安装目录的向导式 NSIS 安装版；ZIP 解压后可直接运行，不写入安装注册项。两份产物使用同一固定 Runtime，并在真实 Windows runner 验证打包启动、会话恢复、EXE 首装/修复/卸载和便携 ZIP 启动。Windows 版本暂不做 Authenticode 签名，系统可能显示 SmartScreen 警告；请只从本仓库 Release 下载并核对 `SHA256SUMS-Windows.txt`，不要把未签名产物当作已获得 Windows 信任背书。

## 当前可用功能

### 桌面与运行时

- **一体化窗口**：本地顶栏与 Harness 共享视觉状态，浅色、深色和跟随系统主题会同步生效。
- **内置固定运行时**：Node.js、pnpm 与 DeepSeek Harness 随应用交付，不读取用户全局安装，也不会在首次启动时联网安装依赖。
- **安静的生命周期**：单实例运行，关闭窗口时可隐藏，重新点击 Dock 图标即可恢复。
- **故障自恢复**：Harness 或本地界面异常退出时分别恢复，不让一个区域的故障拖垮整个窗口。

### 账户与工作区

- **账户概览**：“设置”上方默认显示当前凭据所属账户余额，悬浮时在同一行切换为本机今日估算，不弹出额外面板；点击同时刷新两项。今日金额依据会话中的官方 usage 和北京时间峰谷费率估算，不冒充官方账单。
- **Desktop Companion**：可收起右栏提供当前工作区文件树、相对 HEAD 的 Git 变更、增删行统计和只读 diff。
- **适合阅读的预览**：Markdown 可在排版与源码之间切换，纯文本和常见图片也可在应用内预览。
- **逐轮变更入口**：在 Harness 原生“产物”行下方展示本轮确认变更，点击即可进入对应文件审核。

### 设置、安全与发布

- **单一外观入口**：浅色、深色和跟随系统统一使用“通用设置 → 外观”；“关于”展示版本、开发者信息与更新中心。后续完整 UI 风格作为可选插件交付。
- **更新不打扰**：应用定时后台检查；只有发现可安装版本时，主界面才显示更新入口。
- **隐私友好的诊断**：导出包只包含脱敏后的环境摘要和有界日志，不打包项目源码、会话或凭据。
- **可信发布链**：候选包经过 Developer ID 签名、异机安装、真实应用稳定性测试、Apple 公证和最终产物复验后才会公开。

### 插件市场

- **完整目录发现**：市场基于完整本地索引提供搜索、分类、分页和自定义 HTTPS 来源管理，不把目录收录描述为官方认可或安全审核。
- **安装前安全预检**：核验目录/npm 身份、仓库回链、生命周期脚本、完整性、平台、Runtime、完整依赖图、Peer 兼容性和真实包体。
- **受管生命周期**：支持安装、更新、重装、启停、上一验证版本回滚和卸载；写入前需要原生确认，重启后健康失败会自动恢复。
- **明确权限边界**：插件与 Harness 共享本机用户权限；Renderer 不会获得 Runtime token、缓存路径或可执行安装计划。

## 为什么选择 YukiRyou

- **面向 macOS 与 Windows 的同一产品**：不是网页快捷方式；两端共享固定 Harness Runtime、产品能力和状态合同，平台差异收敛在窗口、路径、进程和安装 Adapter。
- **工作区审阅闭环**：在对话之外直接查看文件树、当前 Git 变更、逐轮变更、增删行和 Markdown 渲染结果。
- **融入 Harness 的桌面能力**：账户余额、Companion 侧栏、设置与更新入口遵循现有界面节奏，不取代或篡改 Harness 的核心工作流。
- **发布结果可验证**：公开包经过 Developer ID 签名、Apple 公证、全新环境安装和真实应用稳定性验证，并附带 SHA-256 校验文件。

## 后续路线图

| 功能 | 状态 | 计划范围 |
| --- | --- | --- |
| 手机远程控制 | **规划中** | 通过明确配对和权限边界，在手机端查看任务状态、接收必要提醒，并在用户确认后继续任务；不会直接暴露本机 Harness 端口。 |
| 插件生态完善 | **持续开发** | 在现有发现、预检和受管生命周期上继续补齐可信发布者信号、权限可见性和更完整的兼容性信息。 |
| Windows x64 发行 | **稳定版** | 同一 Release 提供未签名安装 EXE 与便携 ZIP；安装版支持国内外自动下载并确认重启安装，每版继续执行独立 Windows 11 真机验收，用户规模需要时再接入 Authenticode。 |

路线图表示产品方向，不承诺具体发布日期。安全模型、上游 Harness 接口或素材准备不足时，相关功能会继续保持不可用，而不是通过不稳定的 DOM 注入或降低系统安全要求提前上线。

## 它如何运行

```mermaid
flowchart LR
    A["DeepSeek YukiRyou"] --> B["Electron 主进程"]
    B --> C["应用内置 Node.js"]
    C --> D["固定版本 DeepSeek Harness"]
    D --> E["稳定 127.0.0.1 origin + HMAC secret 持有证明"]
    E --> F["隔离的 Harness WebContentsView"]
    B --> G["macOS / Windows 平台 Adapter"]
    G --> F
```

Harness 只监听由应用持久选择的稳定回环地址，不向局域网暴露服务；每次 Runtime 启动还必须通过随机密钥的 HMAC 挑战证明响应者持有本次 secret。一次性旧日志迁移会采用物理顺序中的最后 ready origin，但轮转日志里保留的全部不同 ready 端口都必须先释放；任一遗留 Runtime 仍占用端口，都会在复制或打开 Runtime Home 前失败关闭。网页运行在关闭 Node 集成、启用上下文隔离与沙盒的独立视图中；桌面桥只开放经过校验的少量能力。该证明不等于 OS 级进程隔离，更完整的边界见[安全设计](docs/03-security.md)。

## 版本与更新

应用启动后会自动检查更新，也可以在“设置 → 关于”中手动检查。中国大陆优先使用国内镜像，其他地区优先使用 GitHub；国内源不可用时自动回退 GitHub。macOS 与 Windows 安装版均在后台下载，完成后由用户确认重启安装。

从 `v0.2.1-beta.2` 升级到首个 rc.8 版本前，请先通过应用菜单完整退出旧版。若旧版曾被强制退出、主进程崩溃，或你手动清理过桌面日志，请先重启 macOS 再安装；旧版 Runtime 没有 owner watchdog，且本次一次性 origin 迁移需要保留的最后 ready 记录。重启可避免新旧 Runtime 并发写数据，但 ready 记录已经丢失时，升级后可能需要从侧栏手动重新选择一次原会话。

桌面壳、Node.js 与 Harness 被视为一个原子发布单元：应用不会在后台单独升级运行时，避免新旧组件组合产生不可复现的问题。正式发布固定执行一次 DMG 公证，再从已 staple 的 App 生成自动更新 ZIP。详细流程见[发布 Runbook](docs/09-github-and-apple-release.md)。

## 本地开发

### 准备环境

- Node.js 22.19+ 或 24+
- Corepack / pnpm 10.34.5
- macOS 开发：Apple Silicon Mac、macOS 14+
- Windows 开发：Windows 11 x64；Windows Runtime 必须在 Windows 主机装配

### 在 macOS 启动项目

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor -- --arch=arm64
pnpm dev
```

### 验证改动

```bash
pnpm check
pnpm test:e2e
pnpm package:mac -- --arch=arm64
```

macOS 正式签名、公证和发行只通过 GitHub Actions 的 **Release desktop (macOS + Windows)** 工作流执行。本机只能生成不可发布的签名候选：

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: ... (...)"
pnpm release:mac:candidate
```

工作流使用多个全新 Apple Silicon runner：先验证候选复制到 `/Applications` 后仍能验签和启动，才允许提交 Apple；公证后的 DMG 与 ZIP 还会在另一个 runner 上重新安装、Gatekeeper 验证并启动。全部通过后只创建 Draft，显式允许后才公开 Release。详见 [发布规则](docs/09-github-and-apple-release.md)和[更新日志](CHANGELOG.md)。

Windows 开发与候选验证需在 Windows x64 主机运行：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor:win
pnpm runtime:verify
pnpm make:win
```

仓库的 **Windows x64 candidate** 工作流会验证向导式 NSIS 安装 EXE 与便携 ZIP，真实执行自定义目录安装、启动、修复安装与卸载。正式桌面发行工作流只把版本化 EXE、便携 ZIP 和 Windows SHA-256 清单加入与 macOS 相同的 GitHub Release。

## 固定运行时

| 组件 | 当前版本 | 策略 |
| --- | --- | --- |
| DeepSeek Harness | `0.1.1-rc.2` | 随应用固定并验证 |
| Node.js | `24.19.0` | 按 `darwin-arm64` / `win32-x64` 目标内置 |
| pnpm | `10.34.5` | 仅供内置 Harness 使用 |
| Electron | `43.4.0` | 桌面壳运行时 |

应用不会调用用户全局安装的 Node、dsh 或 pnpm，也不会在首次启动时在线安装依赖。

## 常见问题

<details>
<summary><strong>这是 DeepSeek 官方客户端吗？</strong></summary>

不是。这是由社区独立开发的跨平台桌面项目，与 DeepSeek 官方没有隶属或背书关系。

</details>

<details>
<summary><strong>支持哪些平台？</strong></summary>

产品当前支持 Apple Silicon macOS 14+ 与 Windows 11 x64。macOS 提供签名、公证的 DMG 与 ZIP；Windows 提供未签名安装 EXE 与便携 ZIP，并附 SHA-256。Intel Mac、Windows on Arm 和 Linux 暂不支持。

</details>

<details>
<summary><strong>为什么安装包比较大？</strong></summary>

为了做到离线可启动和版本可复现，应用内置了经过校验的 Node.js、pnpm 与 Harness 运行时，而不是依赖用户电脑上的全局环境。

</details>

<details>
<summary><strong>遇到启动问题怎么办？</strong></summary>

先使用应用菜单导出诊断包，再到 [Issues](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues) 描述操作系统版本、应用版本和复现步骤。提交前请自行确认附件中没有不希望公开的信息。

</details>

## 文档导航

- [产品范围](docs/01-product-scope.md)
- [系统架构](docs/02-architecture.md)
- [安全模型](docs/03-security.md)
- [测试与发布](docs/04-testing-and-release.md)
- [开发指南](docs/06-development-guide.md)
- [当前实现状态](docs/07-current-status.md)
- [外观扩展契约](docs/08-appearance-extension.md)
- [GitHub 与 Apple 发布 Runbook](docs/09-github-and-apple-release.md)
- [English README](README_EN.md)

## 参与项目

- 如果项目解决了你的问题，可以通过 [Star](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou) 支持它。
- 遇到可复现问题，请使用 [Bug 反馈表单](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues/new?template=bug-report.yml)。
- 有明确使用场景或产品建议，请使用 [功能建议表单](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues/new?template=feature-request.yml)。
- 反馈前建议先安装[最新公开版本](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest)，并附上应用版本、操作系统版本和 CPU 架构。

## 开发者与许可

由 [YukiRyou / yoshino-xiao7](https://github.com/yoshino-xiao7) 开发和维护，项目代码采用 [MIT License](LICENSE)。随包第三方运行时与依赖遵循各自许可证。

DeepSeek 与 DeepSeek Harness 名称归其各自权利人所有。
