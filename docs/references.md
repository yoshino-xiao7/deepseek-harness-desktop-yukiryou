# 外部依据

以下链接是本方案在 2026-08-17 使用的上游依据。上游处于快速迭代期，实施相关阶段时应重新核对。

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)：MIT、Developer Preview、官方启动方式 `npx @deepseek-ai/dsh web`。
- [DeepSeek Harness package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)：当前版本与 Node engine 要求。
- [DeepSeek Harness LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)：MIT 许可证正文。
- [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)：macOS 签名与公证要求。
- [Electron Packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)：打包和签名的官方流程。
- [Electron Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)：发布与更新概览。
- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/)：macOS 自动更新要求应用已签名。
- [Electron Notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)：macOS 通知要求代码签名。
- [Electron Context Isolation glossary](https://www.electronjs.org/docs/latest/glossary/)：renderer 隔离原则。

