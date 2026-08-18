# 更新日志

本文件记录 DeepSeek YukiRyou 面向用户的版本变化。版本说明遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.1-beta.1] - 2026-08-18

### 新增

- 首个面向 Apple Silicon Mac 的公开 Beta 版本。
- 将固定版本的 DeepSeek Harness、Node.js 和 pnpm 作为一个可复现运行单元随应用交付。
- 新增外观与关于页面、应用内检查更新、后台更新检查和下载完成后的重启安装入口。
- 新增 YukiRyou 品牌图标、启动动画和开发者 GitHub 入口。

### 改进

- 使用原生 macOS 交通灯、可拖动顶栏，并让顶栏分界跟随 Harness 侧栏展开与收起。
- 增加运行时自动恢复、日志轮转、脱敏诊断包和损坏设置恢复。
- 发布包通过 Developer ID 签名、Apple 公证、Gatekeeper 以及多台全新 runner 的 DMG/ZIP 安装验证。

### 已知限制

- 目前只支持 Apple Silicon 和 macOS 14 或更高版本。
- 当前仍为 Beta，建议重要工作保留项目与配置备份。
- 本项目是社区独立项目，不是 DeepSeek 官方客户端。

[0.1.1-beta.1]: https://github.com/yoshino-xiao7/deepseek-yukiryou/releases/tag/v0.1.1-beta.1
