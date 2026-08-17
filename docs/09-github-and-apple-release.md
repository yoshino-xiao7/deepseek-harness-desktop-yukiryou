# GitHub 与 Apple 发布准备

## GitHub

目标仓库：`https://github.com/yoshino-xiao7/deepseek-yukiryou`

每个 GitHub Release 的附件固定包含：

- `DeepSeek YukiRyou-<version>-arm64.dmg`
- `DeepSeek YukiRyou-darwin-arm64-<version>.zip`
- `SHA256SUMS.txt`
- `release-manifest.json`

Release 必须在签名、公证与 staple 完成后创建，避免把当前未签名开发包误标成正式下载。

## Apple 开发者资料

本机已经完成 Developer ID 与 App Store Connect 公证凭据准备。发布构建通过环境变量注入凭据，任何私钥都不得写入仓库：

1. `MACOS_SIGN_IDENTITY`：登录 Keychain 中的 `Developer ID Application` 完整名称。
2. `APPLE_API_KEY`：仓库外 `.p8` 私钥的绝对路径。
3. `APPLE_API_KEY_ID`：团队 API Key ID。
4. `APPLE_API_ISSUER`：团队 Issuer ID。

内置 Harness Runtime 包含大量原生二进制与依赖文件。Electron Packager 的默认并发签名遍历可能触发 `EMFILE`，所以发布流程使用 `scripts/sign-macos-app.ts` 顺序识别并签署 Mach-O，再按从深到浅的顺序封装 Electron bundles。Hardened Runtime 使用 `resources/entitlements.mac.plist`，不包含调试专用的 `get-task-allow`。

## 唯一正式发布流程

正式发布只运行一个入口。实际值仅在当前 shell、Keychain 或安全 CI Secret 中注入：

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: ... (...)"
export APPLE_API_KEY="/absolute/path/outside/repository/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
pnpm release:mac
```

也可以用 `xcrun notarytool store-credentials` 将凭据保存到 Keychain，然后只设置 `APPLE_NOTARY_KEYCHAIN_PROFILE`，不再导出三项 API Key 环境变量。

`scripts/release-macos.ts` 固定执行以下顺序，任一步失败都会停止：

1. 验证版本号、Developer ID、公证凭据和干净 Git 工作区。
2. 构建 arm64 App，并在系统临时目录中顺序签署所有嵌套 Mach-O 与 App bundle。
3. 制作并签署 DMG；只把这个 DMG 提交 Apple 一次。
4. Apple 返回 Submission ID 后立即写入 `out/release/notarization-state.json` 并退出，不保持 `--wait` 长连接。
5. 随时运行 `pnpm release:mac:finish` 查询同一个 ID；仍在处理就立即返回，不会重新提交。
6. Apple 返回 `Accepted` 后，对 App 和 DMG 分别 staple，再执行 `codesign`、`spctl`、`hdiutil` 和 `stapler validate`。
7. 从已 staple 的 App 生成自动更新 ZIP，并输出 DMG、ZIP、SHA-256 与包含 Git commit/公证 Submission ID 的 manifest。

Apple 公证服务会为提交容器及其中的嵌套代码生成 ticket，所以不需要把 App、ZIP、DMG 分别排队提交。ZIP 本身不能 staple，因此必须在 App staple 完成后重新生成。签名和公证均在非 File Provider 管理的系统临时目录完成，避免 Documents 同步服务添加 FinderInfo/resource-fork 属性。

流程依据：[Apple 公证工作流定制](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)与[分发前公证 macOS 软件](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。

默认输出目录是 `out/release/`。只有排障演练可以使用以下覆盖项：

- `MACOS_RELEASE_SKIP_PACKAGE=true`：复用 `MACOS_RELEASE_APP` 指向的现有 App。
- `MACOS_RELEASE_OUTPUT=/absolute/path`：改变最终输出目录。
- `MACOS_RELEASE_ALLOW_DIRTY=true`：允许脏工作区；manifest 会明确标记，禁止将这种产物公开发布。

提交成功后，状态文件和 `/private/var/.../deepseek-yukiryou-release-*` 临时目录会保留到 `release:mac:finish` 完成；断网、关闭终端或重启电脑均不需要重提。失败时脚本会打印保留目录，成功生成最终产物后才自动清理。不要绕过脚本手工补做另一份公证。

GitHub Release 中的更新 ZIP 必须保持 `DeepSeek YukiRyou-darwin-arm64-<version>.zip` 命名，以便 `update.electronjs.org` 按 `darwin-arm64` 精确选择。更新器只消费经过 Developer ID 签名与 Apple 公证的 ZIP，不上传开发构建。

若账号不是 Account Holder，需要 Account Holder 创建 Developer ID 证书，或为管理员授予 cloud-managed Developer ID certificate access。

## 发布验证

```bash
security find-identity -v -p codesigning
codesign --verify --deep --strict --verbose=2 "DeepSeek YukiRyou.app"
spctl --assess --type execute --verbose=4 "DeepSeek YukiRyou.app"
xcrun stapler validate "DeepSeek YukiRyou.app"
pnpm verify:release -- --app="out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app" --expect-arch=arm64 --require-signed=true --require-notarized=true
```

上述命令用于单独诊断 App。正常发布无需重复运行，因为 `pnpm release:mac` 已将相同验证作为强制门槛。发布 GitHub Release 前还要确认 tag 指向 `release-manifest.json` 的 `gitCommit`，并使用 `shasum -a 256 -c out/release/SHA256SUMS.txt` 复核附件。

## 品牌发布检查

公开发布前确认 YukiRyou 角色图的使用与再分发权，并审阅应用名称中使用 DeepSeek 商标是否符合其品牌规则。README 已明确项目不是 DeepSeek 官方发行或背书的客户端。
