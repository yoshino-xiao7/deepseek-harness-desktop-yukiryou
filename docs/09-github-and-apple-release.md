# GitHub 与 Apple 发布准备

## GitHub

目标仓库：`https://github.com/yoshino-xiao7/deepseek-yukiryou`

首次发布建议使用 `v0.1.0`，Release 附件包含：

- `DeepSeek YukiRyou-0.1.0-arm64.dmg`
- `DeepSeek YukiRyou-darwin-arm64-0.1.0.zip`
- 两个文件的 SHA-256

Release 必须在签名、公证与 staple 完成后创建，避免把当前未签名开发包误标成正式下载。

## Apple 开发者资料

本机已经完成 Developer ID 与 App Store Connect 公证凭据准备。发布构建通过环境变量注入凭据，任何私钥都不得写入仓库：

1. `MACOS_SIGN_IDENTITY`：登录 Keychain 中的 `Developer ID Application` 完整名称。
2. `APPLE_API_KEY`：仓库外 `.p8` 私钥的绝对路径。
3. `APPLE_API_KEY_ID`：团队 API Key ID。
4. `APPLE_API_ISSUER`：团队 Issuer ID。

内置 Harness Runtime 包含大量原生二进制与依赖文件。Electron Packager 的默认并发签名遍历可能触发 `EMFILE`，所以发布流程使用 `scripts/sign-macos-app.ts` 顺序识别并签署 Mach-O，再按从深到浅的顺序封装 Electron bundles。Hardened Runtime 使用 `resources/entitlements.mac.plist`，不包含调试专用的 `get-task-allow`。

发布命令示例（实际值仅在当前 shell 或安全 CI Secret 中注入）：

```bash
pnpm package:mac -- --arch=arm64
pnpm sign:mac -- \
  --app="/private/tmp/release/DeepSeek YukiRyou.app" \
  --identity="Developer ID Application: ... (...)" \
  --entitlements="resources/entitlements.mac.plist"
```

签名和公证必须在非 File Provider 管理的临时目录完成，避免 Documents 同步服务添加 FinderInfo/resource-fork 属性。签名后用 `notarytool submit --wait` 上传临时 ZIP，Accepted 后对 `.app` 和最终 `.dmg` 执行 `stapler`。

若账号不是 Account Holder，需要 Account Holder 创建 Developer ID 证书，或为管理员授予 cloud-managed Developer ID certificate access。

## 发布验证

```bash
security find-identity -v -p codesigning
codesign --verify --deep --strict --verbose=2 "DeepSeek YukiRyou.app"
spctl --assess --type execute --verbose=4 "DeepSeek YukiRyou.app"
xcrun stapler validate "DeepSeek YukiRyou.app"
pnpm verify:release -- --app="out/DeepSeek YukiRyou-darwin-arm64/DeepSeek YukiRyou.app" --expect-arch=arm64 --require-signed=true --require-notarized=true
```

## 品牌发布检查

公开发布前确认 YukiRyou 角色图的使用与再分发权，并审阅应用名称中使用 DeepSeek 商标是否符合其品牌规则。README 已明确项目不是 DeepSeek 官方发行或背书的客户端。
