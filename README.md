<p align="center">
  <img src="resources/icons/deepseek-yukiryou.png" width="180" alt="DeepSeek YukiRyou 图标">
</p>

<h1 align="center">DeepSeek YukiRyou</h1>

<p align="center">
  为 Apple Silicon 打造的 DeepSeek Harness 个性化 macOS 桌面开发环境。
</p>

<p align="center">
  <strong>原生窗口体验</strong> · <strong>内置离线运行时</strong> · <strong>统一外观系统</strong>
</p>

## 项目简介

DeepSeek YukiRyou 将官方 `@deepseek-ai/dsh` Web UI 封装为独立 macOS 应用。应用负责托管固定版本的 Harness 运行时、隔离网页权限、处理生命周期与故障恢复，并提供与 Harness 同步的原生顶栏和桌面设置扩展。

这不是 DeepSeek 官方发行的桌面客户端，而是面向个人开发工作流构建的独立项目。

## 当前能力

- Apple Silicon 原生 arm64 应用、DMG 和 ZIP。
- 内置 Node.js、DeepSeek Harness 与 pnpm，不依赖系统全局环境。
- Harness 只监听随机 `127.0.0.1` 端口，并运行在隔离的 `WebContentsView` 中。
- macOS 原生交通灯、可拖动顶栏和侧栏展开/收起动画同步。
- 设置中提供“外观”和“关于”页面；浅色、深色、跟随系统会同步影响 Harness 与本地顶栏。
- 单实例、关闭隐藏、Dock 恢复、运行时重启和结构化故障诊断。
- 有界日志轮转，以及经过凭据与用户目录脱敏的 ZIP 诊断包导出。
- 启动时校验 Harness 偏好文件；损坏时保留时间戳备份并安全恢复默认设置。

## 环境要求

- Apple Silicon Mac（arm64）
- macOS 14 或更高版本
- Node.js 22.19+ 或 24+
- pnpm 10.34.5

## 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor -- --arch=arm64
pnpm dev
```

## 验证与打包

```bash
pnpm check
pnpm package:mac -- --arch=arm64
pnpm test:e2e
pnpm make:mac -- --arch=arm64
```

构建产物位于：

```text
out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app
out/make/DeepSeek YukiRyou-0.1.0-arm64.dmg
out/make/zip/darwin/arm64/DeepSeek YukiRyou-darwin-arm64-0.1.0.zip
```

## 固定运行时

| 运行部分 | 版本 |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.6` |
| Node.js | `24.19.0` |
| pnpm | `10.34.5` |
| Electron | `43.4.0` |

应用运行时不会执行在线安装，也不会调用用户全局的 Node、dsh 或 pnpm。

## 文档

- [开发文档索引](docs/README.md)
- [系统架构](docs/02-architecture.md)
- [安全模型](docs/03-security.md)
- [开发指南](docs/06-development-guide.md)
- [当前实现状态](docs/07-current-status.md)
- [外观扩展契约](docs/08-appearance-extension.md)
- [GitHub 与 Apple 发布准备](docs/09-github-and-apple-release.md)

## 品牌说明

应用图标使用项目自有的 YukiRyou 鲸鱼女仆角色视觉。DeepSeek 与 DeepSeek Harness 名称归其各自权利人所有；本项目与 DeepSeek 官方没有隶属或背书关系。

## 开发者

- GitHub：[yoshino-xiao7](https://github.com/yoshino-xiao7)
- 项目仓库：[yoshino-xiao7/deepseek-yukiryou](https://github.com/yoshino-xiao7/deepseek-yukiryou)

## 许可证

项目代码采用 MIT License。随包第三方运行时与依赖遵循各自许可证。
