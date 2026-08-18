# GitHub 与 Apple 发布规则

## 不可绕过的原则

正式版本只能由 `.github/workflows/release-macos.yml` 创建。本机命令用于开发和诊断，不得直接上传 GitHub Release。

```text
同机验签通过 != 可发布
Apple Accepted != 可安装
DMG 内验签通过 != 复制到 Applications 后有效
两个全新 runner 完成安装与启动验收 = 才允许创建 Release
```

Apple 明确说明：成功公证的软件仍可能因为签名问题无法运行，并建议尽可能在不同于开发机的 Mac 上测试最终分发物：

- [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

## 六阶段门禁

1. **质量与版本**：版本必须与 `package.json` 完全一致；目标 GitHub tag/Release 必须不存在；运行 lint、类型检查、单元和集成测试。
2. **签名候选**：在 Apple Silicon GitHub runner 上装配固定运行时，由 Electron Forge 的 `osxSign` / `@electron/osx-sign` 标准流程签名并生成候选 ZIP。仓库不再维护自制递归 `codesign` 脚本。
3. **候选异机安装**：第二个全新 runner 下载候选 ZIP，复制到 `/Applications`，执行严格签名/证书链/架构检查，并用 `--release-smoke-test` 实际启动。全部通过后生成与候选 SHA-256、版本、架构和 Git commit 绑定的验证回执。候选尚未公证，因此 quarantine/Gatekeeper 模拟只在最终产物阶段执行。
4. **精确候选公证**：第三个 runner 只有在验证回执与候选字节完全匹配时才允许提交 Apple。Accepted 后保存并检查公证日志、staple App/DMG，生成最终 DMG、ZIP、SHA-256 和 manifest。
5. **最终异机安装**：第四个全新 runner 分别下载最终 ZIP 和 DMG，再次模拟 quarantine、复制到 `/Applications`、验证 `codesign`、Gatekeeper、ticket 和启动冒烟。只有此门禁通过，才创建 GitHub Draft。
6. **公开前复验**：审阅 Draft 后，独立的 **Publish verified macOS draft** 工作流从 Draft 重新下载附件，在又一个全新 runner 上复验校验和、DMG/ZIP 安装、Gatekeeper、ticket 和启动；全部通过才公开 Release。

任一步失败都会阻止后续阶段。公证前的签名问题只消耗 CI 构建时间，不产生 Apple Submission。

## GitHub Actions Secrets

在仓库 **Settings → Secrets and variables → Actions** 配置：

| Secret | 内容 | 获取方式 |
| --- | --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Developer ID Application 证书和私钥导出的 `.p12`，整体 Base64 | 钥匙串访问导出 `.p12`，本机执行 `openssl base64 -A -in certificate.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的强密码 | 仅存 GitHub Secret/密码管理器 |
| `APPLE_API_KEY_P8_BASE64` | App Store Connect API `.p8` 整体 Base64 | `openssl base64 -A -in AuthKey_XXXXXXXXXX.p8` |
| `APPLE_API_KEY_ID` | API Key ID | App Store Connect → 用户和访问 → 集成 → 团队密钥 |
| `APPLE_API_ISSUER` | Issuer ID | 同一 API 页面 |

Team ID 固定为 `7G6J4S76PN`。证书和 API 私钥不得提交到仓库、Actions artifact、日志或 `.env`。

## 发版步骤

1. 将 `package.json` 版本提升到从未使用的新版本，例如 `0.1.1-beta.1`，并创建对应的 `docs/releases/v0.1.1-beta.1.md`；缺少或内容为空会直接阻止发布。
2. 打开 GitHub → Actions → **Release macOS** → **Run workflow**。
3. `version` 必须与 `package.json` 一致。
4. 前五个自动门禁全部通过后，GitHub 中会出现带 DMG、ZIP、校验文件、manifest 和 Apple 公证日志的 Draft。
5. 审阅 Draft 后运行 **Publish verified macOS draft**，输入相同版本；它会重新下载和安装验证附件，通过后才公开。
6. 版本/tag 一旦存在，不允许覆盖或强推；任何修改都必须提升版本。

面向用户的版本变化同时汇总到根目录 `CHANGELOG.md`。Release 正文由对应的 `docs/releases/v<version>.md` 自动生成，不在 GitHub 页面临时手写。

固定附件：

- `DeepSeek.YukiRyou-<version>-arm64.dmg`
- `DeepSeek.YukiRyou-darwin-arm64-<version>.zip`
- `SHA256SUMS.txt`
- `release-manifest.json`
- `notarization-log.json`

更新 ZIP 的 `darwin-arm64` 命名不可改变，否则 `update.electronjs.org` 无法选择 Apple Silicon 资源。

GitHub 的 `prerelease` 标记必须为 `false`，因为 `update.electronjs.org` 会忽略所有标记为 prerelease 的 Release。Beta 身份由 SemVer 后缀（例如 `0.1.1-beta.1`）和标题表达；这不代表该版本已经成为稳定版。

## 本机诊断入口

本机可构建签名候选，但候选不能直接发布：

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: HanTao Cao (7G6J4S76PN)"
pnpm release:mac:candidate
```

验证某个归档复制后的真实应用：

```bash
pnpm verify:distribution -- \
  --kind=zip \
  --archive="/absolute/path/candidate.zip" \
  --install-app="/absolute/new/path/DeepSeek YukiRyou.app" \
  --require-notarized=false
```

`pnpm release:mac` 已禁止直接构建并公证。它只接受另一个环境生成的候选、候选 manifest 和可移植验证回执；SHA-256、版本、架构、Git commit 或启动结果任一不匹配都会终止。

## 当前 v0.1.0

原 `v0.1.0` Release 保持 Draft，附件下载次数为 0，不作为有效 Beta。不得覆盖该 tag 或复用该版本；下一次发布必须使用新版本号。

## 品牌检查

公开发布前确认 YukiRyou 角色图的使用与再分发权，并审阅应用名称中使用 DeepSeek 商标是否符合品牌规则。README 已声明本项目不是 DeepSeek 官方发行或背书的客户端。
