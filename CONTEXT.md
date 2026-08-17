# DeepSeek YukiRyou for macOS

本项目把本机运行的 DeepSeek Harness 交付为可信、可安装、可维护的 macOS 桌面应用。

## Language

**桌面应用（Desktop App）**：
用户安装和启动的 macOS 应用整体，包含桌面壳与随包运行时。
_Avoid_: 客户端、GUI、套壳

**桌面壳（Desktop Shell）**：
负责窗口、菜单、通知、生命周期和更新的 macOS/Electron 部分，不实现 Agent 行为。
_Avoid_: Harness、后端

**Harness 运行时（Harness Runtime）**：
随桌面应用固定版本交付、在本机子进程中运行的官方 `@deepseek-ai/dsh`。
_Avoid_: 服务端、模型、Electron 后端

**Harness UI**：
由 Harness 运行时在本机回环地址提供的官方 Web UI。
_Avoid_: 自研前端、远程网页

**运行时目录（Runtime Home）**：
桌面应用为 Harness 运行时指定的独立持久化目录，保存 Harness 自有配置和会话数据。
_Avoid_: 应用缓存、仓库目录

**运行时版本（Runtime Version）**：
与某个桌面应用版本一起验证并原子发布的 `@deepseek-ai/dsh` 版本。
_Avoid_: 最新版、用户安装版本

**应用版本（App Version）**：
桌面壳与一个运行时版本组成的可签名、可公证、可更新发布单元。
_Avoid_: Harness 版本
