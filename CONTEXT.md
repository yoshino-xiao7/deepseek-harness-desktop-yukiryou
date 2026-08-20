# DeepSeek YukiRyou Desktop

本项目把本机运行的 DeepSeek Harness 交付为可信、可安装、可维护的桌面应用。当前公开发行面向 Apple Silicon macOS，后续目标包含 Windows 11 x64。

## Language

**桌面应用（Desktop App）**：
用户安装和启动的桌面应用整体，包含桌面壳与随包运行时。
_Avoid_: 客户端、GUI、套壳

**桌面壳（Desktop Shell）**：
负责窗口、菜单、通知、生命周期和更新的 Electron 部分，不实现 Agent 行为。
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

**桌面伴侣（Desktop Companion）**：
由桌面壳承载的只读辅助能力集合。当前包含 Harness 官方 slot 账户余额、右栏与 Workspace Review，但不复制 Agent、会话或工具详情 UI。宠物实验已归档，不属于当前产品线。
_Avoid_: 新 Harness UI、文件编辑器

**Workspace Review**：
面向当前 Harness Workspace 的只读文件树、Git 变更、diff 与安全预览。
_Avoid_: IDE、自动修改

**Workspace Authority / Capability**：
Authority 是 Runtime 对 Session 所属 canonical Workspace 的权威解析；Capability 是主进程据此建立的短期不透明文件访问权限。
_Avoid_: 浏览器传入路径、永久目录授权

## Archived experiments

`yukiryou/pet-experiment-archive-20260820` 是已放弃宠物实验的冷备份分支，归档提交为 `a05117e`。它不属于当前产品线，禁止自动合并、变基、挑拣或作为开发基线。只有项目所有者在当前对话中明确要求恢复宠物开发时，才可从该分支按获批范围选择性恢复；“继续”“推进下一阶段”等泛化指令不构成授权。
