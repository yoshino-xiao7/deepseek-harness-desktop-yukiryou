# 外部依据

以下链接是本方案在 2026-08-17 至 2026-08-19 使用的上游依据。上游处于快速迭代期，实施相关阶段时应重新核对。

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)：MIT、Developer Preview、官方启动方式 `npx @deepseek-ai/dsh web`。
- [DeepSeek Harness 0.1.0-rc.7 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7)：本项目当前固定基线及上游变更说明。
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
- [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)：本地受控资源协议及流式响应依据；宠物资源不得直接使用 `file://`。
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)：远程内容、导航、权限、Node integration 与 IPC 校验基线。
- [Rive Web runtime](https://rive.app/docs/runtimes/web/web-js)、[renderer 选择](https://rive.app/docs/runtimes/web/canvas-vs-webgl) 与 [runtime export](https://rive.app/docs/editor/exporting/exporting-for-runtime)：连续 rig/state machine 候选、离线 WASM/renderer 权衡及作者工具费用约束。
- [dotLottie v2 specification](https://dotlottie.io/spec/2.0/) 与 [dotlottie-web](https://github.com/LottieFiles/dotlottie-web)：开放动画容器、状态机与 MIT Web runtime 候选。
- [Chrome alpha WebM](https://developer.chrome.com/blog/alpha-transparency-in-chrome-video)：透明 WebM 在 Chromium 中的候选能力；仍须在本项目 Electron 版本中真机验证。
- [OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create) 与 [GPT‑5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)：仅用于研究态身份 QA 探针。它需要额外供应商凭据，因此明确不具备 Creator Gate 资格，也不是用户制作宠物的产品路径。
