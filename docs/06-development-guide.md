# 开发约定

## 环境

- macOS 14+ 开发机，安装 Xcode Command Line Tools。
- Node.js 24 与 Corepack/pnpm；具体版本在 Phase 0 写入 `.node-version` 与 `packageManager`。
- 正式发布需要 Apple Developer Program、Developer ID Application 证书和公证凭据；日常开发不需要生产证书。

## 计划中的命令

仓库提供以下稳定入口：

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:stress
pnpm test:soak
pnpm runtime:vendor
pnpm runtime:verify
pnpm package:mac
pnpm verify:release
```

当前 Apple Silicon 构建命令：

```bash
pnpm runtime:vendor -- --arch=arm64
pnpm make:mac -- --arch=arm64
pnpm verify:release -- --app="out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app" --expect-arch=arm64
```

脚本名称一旦进入 CI 即视为仓库接口，内部工具可以替换，但入口保持稳定。

## 配置与秘密

- 版本、架构和哈希进入受版本控制的 runtime manifest。
- Apple 凭据只来自 CI secret/Keychain，不进入 `.env` 示例、日志或仓库。
- 开发环境允许通过显式变量指向本地 dsh checkout，但 production 构建发现该变量必须失败。
- 禁止读取或输出完整 shell 环境来诊断问题。

## 代码约定

- ESM TypeScript、`strict: true`，不使用未收窄的 `any`。
- 状态机使用判别联合；错误跨模块前转换为结构化 failure，不透传任意异常对象。
- 路径使用 Node URL/path 接口构造，不拼接 shell 命令字符串。
- 子进程使用 executable + args 数组，默认 `shell: false`。
- 文件更新使用临时文件 + rename；持久状态写入应可在中断后恢复。
- 日志参数结构化并在 sink 统一脱敏。

## 评审检查

- 改动是否扩大 Harness UI 能获得的 Electron/Node 权限？
- 是否仍只连接本次启动并验证的 loopback origin？
- 是否可能误杀其他进程、覆盖 Runtime Home 或泄漏秘密？
- 是否给接口增加了调用方本不需要理解的参数？
- 测试是否通过模块接口验证结果，而不是绑定实现细节？
- runtime/依赖变化是否更新清单、许可证和兼容测试？
- 用户可见行为、数据或发布流程变化是否同步更新 `docs/`？
