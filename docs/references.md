# 外部依据

以下链接是本方案在 2026-08-17 至 2026-08-18 使用的上游依据。上游处于快速迭代期，实施相关阶段时应重新核对。

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)：MIT、Developer Preview、官方启动方式 `npx @deepseek-ai/dsh web`。
- [DeepSeek Harness 0.1.1-rc.1 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1)：Vision Exp 模型、Bubblewrap 修复与 rc.1 变更说明。
- [DeepSeek Harness 0.1.1-rc.2 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2)：本项目当前固定基线；包含 Files API 图片复用和图片规格适配。
- [DeepSeek API 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：今日消耗估算所用的官方峰谷时段与模型费率来源。
- [DeepSeek Harness package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)：当前版本与 Node engine 要求。
- [DeepSeek Harness LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)：MIT 许可证正文。
- [DeepSeek API 查询账户余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)：官方 `GET /user/balance` 契约；返回当前凭据所属账户的可用状态与分币种余额，不提供今日消费。
- [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)：macOS 签名与公证要求。
- [Electron Packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)：打包和签名的官方流程。
- [Electron Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)：发布与更新概览。
- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/)：macOS 自动更新要求应用已签名。
- [update.electronjs.org](https://github.com/electron/update.electronjs.org)：公开 GitHub Release 的平台/架构 feed 路径与 macOS ZIP 命名规则。
- [Electron Notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)：macOS 通知要求代码签名。
- [Electron Context Isolation glossary](https://www.electronjs.org/docs/latest/glossary/)：renderer 隔离原则。
