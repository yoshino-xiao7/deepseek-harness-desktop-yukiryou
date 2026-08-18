# 更新日志

本文件记录 DeepSeek YukiRyou 面向用户的版本变化。版本说明遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.2.0-beta.1] - 2026-08-18

### 新增

- Runtime 基线升级至 DeepSeek Harness `0.1.0-rc.7`。
- 在“设置”上方显示当前 DeepSeek 凭据所属账户余额；不显示今日消费。
- 新增 Desktop Companion 右栏、当前工作区文件树、Git 变更摘要与单文件 diff。
- 新增纯文本、常见图片和 Markdown 排版预览；Markdown 仍可切换到源码。
- 在原生“产物”行下新增基于 rc.7 逐轮工具事件的变更卡，可展开文件并跳转到只读审阅。

### 安全与改进

- 拆分本地 shell 与 Harness preload；Harness 页面无法访问文件审阅能力。
- Workspace root 必须由 Runtime registry 复核会话归属，renderer 只能使用不透明节点 ID。
- rc.7 原生依赖增加真实 PTY、sharp、koffi、架构与发布包门禁。
- 账户余额改为与“设置”一致的横向行样式；Desktop Companion 统一 Harness 字号、标题和下划线标签，并加入 220ms 同步收放动画。
- 变更区改为可折叠目录树；diff 增加双侧行号、hunk、未修改行折叠与整行红绿背景。
- 历史轮次中的 Markdown 变更统一进入红删绿增的审核视图，不再误显示为当前文件的排版预览。
- 文件预览拒绝非法 UTF-8，并在解码图片前限制单边尺寸与总像素，避免替换字符和图片像素炸弹进入 renderer。
- 切换工作区时立即关闭旧预览，并增加 100 次审核、切换、收起和展开的确定性状态压力测试。
- Markdown 预览改为只消费 SafeMarkdown 结构；HTML、远程图片、iframe 与 `javascript:` 链接均作为普通文本显示。
- Workspace 切换会主动清空 preload 中缓存的旧预览正文和图片 data URL；文件读取改为 `O_NOFOLLOW` 句柄读取并校验读取前后文件身份。
- 新增打包应用长会话内存、上一版本 Runtime Home 保留和 shell/Harness 持续健康门禁。
- 发布流水线在异机安装候选后、公证前新增 5 小时真实应用 soak，避免把不可执行的 8 小时任务放进最长 6 小时的 GitHub 托管 job。

### 已知限制

- 变更区表示当前工作区相对 HEAD 的事实，不声称全部由当前轮次产生。
- 宠物活动区尚未加入，等待角色素材冻结后作为最后阶段开发。

## [0.1.1-beta.1] - 2026-08-18

### 新增

- 新增应用内检查更新、后台更新检查和下载完成后的重启安装入口。
- 新增 YukiRyou 品牌启动动画和状态反馈。
- 在原有自动更新 ZIP 之外增加 Apple Silicon DMG 安装包。

### 改进

- 使用多台全新 runner 对签名候选和最终 DMG/ZIP 执行安装、Gatekeeper 与真实启动验收。
- 提升跨机器复制后的签名稳定性，并统一 GitHub-safe 发行文件名。

### 已知限制

- 目前只支持 Apple Silicon 和 macOS 14 或更高版本。
- 当前仍为 Beta，建议重要工作保留项目与配置备份。
- 本项目是社区独立项目，不是 DeepSeek 官方客户端。

## [0.1.0-beta.1] - 2026-08-17

### 新增

- 首个公开 Beta，仅支持 Apple Silicon Mac。
- 将 DeepSeek Harness 封装为独立 macOS 桌面应用，并内置固定版本 Node.js、Harness 与 pnpm。
- 新增原生窗口交通灯、可拖动顶栏、侧栏动画同步、外观与关于页面。
- 新增运行时恢复、日志轮转与诊断包导出。
- 提供经过 Developer ID 签名、Apple 公证和 stapled ticket 验证的 ZIP。

### 已知限制

- 仅提供 ZIP，尚未提供 DMG 安装包。
- 属于早期测试版本，建议重要工作保留备份。

[0.2.0-beta.1]: https://github.com/yoshino-xiao7/deepseek-yukiryou/releases/tag/v0.2.0-beta.1
[0.1.1-beta.1]: https://github.com/yoshino-xiao7/deepseek-yukiryou/releases/tag/v0.1.1-beta.1
[0.1.0-beta.1]: https://github.com/yoshino-xiao7/deepseek-yukiryou/releases/tag/v0.1.0-beta.1
