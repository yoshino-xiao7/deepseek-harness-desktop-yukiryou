# GitHub 与 Apple 发布准备

## GitHub

目标仓库：`https://github.com/yoshino-xiao7/deepseek-yukiryou`

首次发布建议使用 `v0.1.0`，Release 附件包含：

- `DeepSeek YukiRyou-0.1.0-arm64.dmg`
- `DeepSeek YukiRyou-darwin-arm64-0.1.0.zip`
- 两个文件的 SHA-256

Release 必须在签名、公证与 staple 完成后创建，避免把当前未签名开发包误标成正式下载。

## Apple 开发者资料

本机当前已安装 Xcode 与 `notarytool`，但 Keychain 尚无有效代码签名身份。正式发布前需要：

1. 在 Apple Developer 的 Certificates, Identifiers & Profiles 创建 `Developer ID Application` 证书，并确保对应私钥与证书都安装在本机登录 Keychain。
2. 提供 Apple Developer Team ID（可公开标识，不是密码）。
3. 为公证准备 App Store Connect API Key：Issuer ID、Key ID 和 `.p8` 私钥；私钥只放入 Keychain 或 CI Secret，不提交仓库、不粘贴到日志。
4. 为 Electron 主程序、Helpers 与内置 Node sidecar 配置 Hardened Runtime 和经过实际运行验证的最小 entitlements。
5. 对 DMG/ZIP 执行 `notarytool` 上传、公证结果检查、`stapler` 与 Gatekeeper 验证。

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
