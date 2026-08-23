<p align="center">
  <img src="resources/icons/deepseek-yukiryou.png" width="168" alt="DeepSeek YukiRyou">
</p>

<h1 align="center">DeepSeek YukiRyou — DeepSeek Harness Desktop for macOS & Windows</h1>

<p align="center">
  <strong>DeepSeek Harness, delivered as a real desktop app.</strong><br>
  A self-contained macOS and Windows workspace with a bundled runtime, Workspace Review, a managed plugin marketplace, and recoverable lifecycle management.
</p>

<p align="center">
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/yoshino-xiao7/deepseek-harness-desktop-yukiryou?style=flat-square&color=3157a4"></a>
  <img alt="macOS 14+" src="https://img.shields.io/badge/macOS-14%2B-111827?style=flat-square&logo=apple">
  <img alt="Apple Silicon" src="https://img.shields.io/badge/Apple%20Silicon-arm64-3157a4?style=flat-square">
  <img alt="Windows 11 x64" src="https://img.shields.io/badge/Windows%2011-x64-3157a4?style=flat-square&logo=windows11">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-6b7280?style=flat-square"></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases">Download</a>
  ·
  <a href="docs/README.md">Developer docs</a>
  ·
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues">Report an issue</a>
  ·
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou">⭐ Star this project</a>
</p>

<p align="center">
  If this project helps you, consider giving it a Star. It helps other people looking for a DeepSeek Harness desktop client discover the project.
</p>

---

## Project positioning

DeepSeek Harness provides a local Web UI, but routine use still involves preparing a runtime, starting commands, managing ports, and recovering failed processes. DeepSeek YukiRyou packages those responsibilities into an installable cross-platform desktop app. It starts the pinned Harness runtime, cleans up only the processes it owns, and presents the complete Web UI in a native window.

This is not a rewrite of Harness and does not change how the agent works. Its job is to deliver Harness to the desktop with predictable startup, recovery, isolation, and updates, while adding desktop capabilities for account status, workspace files, and change review.

> The product supports Apple Silicon on macOS 14+ and Windows 11 x64. macOS ships signed and notarized DMG and ZIP assets. Windows ships an unsigned installer EXE and portable ZIP with explicit provenance, SHA-256 checksums, and SmartScreen disclosure.

| Ready to open | Native desktop | Inspectable | Trusted releases |
| --- | --- | --- | --- |
| Bundled Node.js, pnpm, and pinned Harness | Platform-aware chrome, synchronized themes, responsive Workspace Review | Runtime recovery, rotated logs, redacted diagnostics | Signed/notarized macOS releases; real Windows install-lifecycle candidate gate |

## Download and install

### macOS

Open [GitHub Releases](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases) and download the Apple Silicon DMG:

~~~text
DeepSeek.YukiRyou-<version>-arm64.dmg
~~~

1. Open the DMG.
2. Drag **DeepSeek YukiRyou** into Applications.
3. Launch it from Launchpad or Applications.
4. Complete the required service configuration in Harness and start working.

Requirements: an Apple Silicon Mac (M1 or newer) running macOS 14 or later.

Every public release includes SHA-256 checksums. macOS app and update artifacts are Developer ID signed and Apple-notarized. GitHub Releases is the global origin; installations in mainland China prefer the ESA-protected `download-cn.suzuki.ink` mirror, which is populated only after the GitHub release is public and fully verified, with GitHub fallback. The website can consume `downloads/latest.json` from the China mirror to obtain versioned direct links, sizes, and SHA-256 digests for all four packages.

### Windows

Each Windows 11 x64 release provides two public assets:

~~~text
DeepSeek.YukiRyou-<version>-win32-x64-Setup.exe
DeepSeek.YukiRyou-win32-x64-<version>-portable.zip
~~~

The EXE is a guided NSIS installer that lets users choose the install directory; the ZIP runs after extraction without registering an installation. Both contain the same pinned Runtime and are verified on a real Windows runner for packaged startup, session restoration, EXE install/repair/uninstall, and portable ZIP startup. Windows builds are not Authenticode-signed yet, so Windows may show a SmartScreen warning. Download only from this repository's Releases and verify `SHA256SUMS-Windows.txt`; an unsigned artifact does not carry Windows trust endorsement.

## Available today

### Desktop and runtime

- **Integrated desktop window:** the local title bar follows Harness light, dark, and system themes.
- **Pinned bundled runtime:** Node.js, pnpm, and DeepSeek Harness ship with the app. Global installations are not used, and first launch does not install dependencies online.
- **Quiet lifecycle:** the app is single-instance, can hide on close, and restores from the Dock.
- **Independent recovery:** the Harness view and local shell recover separately, so one failure does not take down the other.

### Account and workspace

- **Account overview:** the row above Settings shows the active credential's balance by default and swaps to today's local estimate in place on hover, without opening a popover; click to refresh both. The estimate uses provider-reported session usage and Beijing peak/off-peak rates, and is never presented as an official bill.
- **Desktop Companion:** a collapsible panel shows the current workspace tree, Git changes relative to HEAD, line statistics, and read-only diffs.
- **Readable previews:** Markdown switches between rendered and source views; plain text and common image formats can be previewed in the app.
- **Per-turn change entry:** confirmed changes appear below Harness's native artifact row and open directly in review mode.

### Settings, security, and releases

- **One appearance entry:** light, dark, and system modes live in General → Appearance; About exposes versions, developer details, and updates. Full UI styles can later ship as optional plugins.
- **Quiet updates:** background checks do not add a main-window entry unless an installable update is available.
- **Private diagnostics:** exported diagnostics contain bounded, redacted environment and log data—not source files, sessions, or credentials.
- **Trusted release pipeline:** candidates are Developer ID signed, installed on a fresh runner, exercised in a real-app soak, Apple-notarized, and verified again before publication.

### Plugin marketplace

- **Complete discovery:** search, categories, pagination, and custom HTTPS sources operate over a complete local index. Catalog inclusion is never presented as endorsement or a security audit.
- **Pre-install inspection:** verifies catalog/npm identity, repository backlinks, lifecycle scripts, integrity, platform and Runtime compatibility, the complete dependency graph, peers, and actual package bytes.
- **Managed lifecycle:** install, update, reinstall, enable, disable, rollback to the previous verified version, and uninstall. Mutations require native confirmation and unhealthy restarts automatically restore the prior version.
- **Explicit permission boundary:** plugins share the local user's permissions with Harness. The renderer never receives Runtime tokens, cache paths, or executable installation plans.

## Why YukiRyou

- **One product for macOS and Windows:** not a website shortcut. Both platforms share the pinned Harness Runtime, product capabilities, and state contracts, with platform differences isolated to window, path, process, and installer adapters.
- **A complete workspace review loop:** inspect the file tree, current Git changes, per-turn changes, line statistics, and rendered Markdown without leaving the conversation workflow.
- **Desktop capabilities that fit Harness:** account balance, the Companion sidebar, settings, and updates follow the existing interface instead of replacing or rewriting Harness's core workflow.
- **Verifiable releases:** public artifacts are Developer ID signed, Apple-notarized, installed in clean environments, exercised as real apps, and accompanied by SHA-256 checksums.

## Roadmap

| Feature | Status | Planned scope |
| --- | --- | --- |
| Mobile remote control | **Planned** | Explicit pairing and permissions for viewing task status, receiving relevant alerts, and continuing a task after user confirmation—without exposing the local Harness port directly. |
| Plugin ecosystem | **Ongoing** | Extend the existing discovery, inspection, and managed lifecycle with stronger publisher signals, clearer permissions, and richer compatibility information. |
| Windows x64 distribution | **Stable** | The same Release ships an unsigned installer EXE and portable ZIP. The installed build supports automatic download and confirmed restart-to-install through both regional channels; independent Windows 11 acceptance remains a per-release gate, and Authenticode can be added when distribution scale warrants it. |

The roadmap describes direction, not committed dates. If the security model, upstream Harness contracts, or required assets are not ready, the feature remains unavailable instead of shipping through brittle DOM injection or weakened system protections.

## How it works

~~~mermaid
flowchart LR
    A["DeepSeek YukiRyou"] --> B["Electron main process"]
    B --> C["Bundled Node.js"]
    C --> D["Pinned DeepSeek Harness"]
    D --> E["Stable 127.0.0.1 origin + HMAC secret-possession proof"]
    E --> F["Isolated Harness WebContentsView"]
    B --> G["macOS / Windows platform adapters"]
    G --> F
~~~

Harness listens on a stable loopback endpoint selected and persisted by the app, never on the LAN. Every Runtime start must prove that the responder possesses the fresh per-start secret through an HMAC challenge. During one-time legacy-log migration, the final ready record in physical log order selects the stable origin, but every distinct ready port retained across rotated logs must first become free; any surviving Runtime fails closed before Runtime Home is copied or opened. Its renderer runs without Node integration, with context isolation, sandboxing, and web security enabled. This is not OS-level process isolation; see the [security design](docs/03-security.md) for the complete trust boundary.

## Versions and updates

The app checks for updates after startup and can also be checked from **Settings → About**. Mainland China installations prefer the China mirror while other regions prefer GitHub, with automatic GitHub fallback. Both macOS and installed Windows builds download in the background and install only after user confirmation and restart.

Before upgrading from `v0.2.1-beta.2` to the first rc.8 build, quit the old app completely from its application menu. If the old app was force-quit, its main process crashed, or desktop logs were manually removed, restart macOS before installing. The previous Runtime has no owner watchdog, and this one-time origin migration relies on its retained final ready record. Rebooting prevents old and new Runtimes from writing concurrently; if that record was already lost, you may need to select the previous session once from the sidebar after upgrading.

The desktop shell, Node.js, pnpm, and Harness form one atomic release. Runtime pieces are never upgraded independently in the background. A release is signed, installed and smoke-tested on a fresh runner, soaked, notarized, and verified again before it becomes a draft. Publication is a separate explicit step. See the [release runbook](docs/09-github-and-apple-release.md).

## Local development

### Requirements

- Node.js 22.19+ or 24+
- Corepack / pnpm 10.34.5
- macOS development: an Apple Silicon Mac running macOS 14+
- Windows development: Windows 11 x64; the Windows Runtime must be assembled on a Windows host

### Start the project on macOS

~~~bash
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor -- --arch=arm64
pnpm dev
~~~

### Validate changes

~~~bash
pnpm check
pnpm test:e2e
pnpm package:mac -- --arch=arm64
~~~

macOS signing, notarization, and public distribution run only through the GitHub Actions **Release desktop (macOS + Windows)** workflow. Local packaging is for development verification and is not a public release artifact.

Windows development and candidate verification must run on a Windows x64 host:

~~~powershell
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor:win
pnpm runtime:verify
pnpm make:win
~~~

The **Windows x64 candidate** workflow verifies both the guided NSIS installer EXE and portable ZIP, and installs, launches, repair-installs, and uninstalls the candidate. The desktop release workflow adds only the versioned EXE, portable ZIP, and Windows SHA-256 list to the same GitHub Release as macOS.

## Pinned runtime

| Component | Current version | Policy |
| --- | --- | --- |
| DeepSeek Harness | <code>0.1.1-rc.2</code> | Pinned and verified with the app |
| Node.js | <code>24.19.0</code> | Bundled per <code>darwin-arm64</code> / <code>win32-x64</code> target |
| pnpm | <code>10.34.5</code> | Used only by the bundled Harness |
| Electron | <code>43.4.0</code> | Desktop shell runtime |

The app does not invoke globally installed copies of Node.js, dsh, or pnpm, and it does not install dependencies online on first launch.

## FAQ

<details>
<summary><strong>Is this an official DeepSeek client?</strong></summary>

No. This is an independently developed cross-platform community project and is neither affiliated with nor endorsed by DeepSeek.

</details>

<details>
<summary><strong>Which platforms are supported?</strong></summary>

The product supports Apple Silicon on macOS 14+ and Windows 11 x64. macOS ships signed and notarized DMG and ZIP assets; Windows ships an unsigned installer EXE and portable ZIP with SHA-256 checksums. Intel Macs, Windows on Arm, and Linux are not currently supported.

</details>

<details>
<summary><strong>Why is the download relatively large?</strong></summary>

For offline startup and reproducible versions, the app bundles its verified Node.js, pnpm, and Harness runtime instead of relying on global tools on the user's machine.

</details>

<details>
<summary><strong>How should I report a startup problem?</strong></summary>

Export a diagnostics archive from the app, then open a [GitHub Issue](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues) with the operating-system version, app version, and reproduction steps. Review attachments before publishing them.

</details>

## Documentation

- [Product scope](docs/01-product-scope.md)
- [Architecture](docs/02-architecture.md)
- [Security model](docs/03-security.md)
- [Testing and release](docs/04-testing-and-release.md)
- [Development guide](docs/06-development-guide.md)
- [Current implementation status](docs/07-current-status.md)
- [Appearance extension contract](docs/08-appearance-extension.md)
- [GitHub and Apple release runbook](docs/09-github-and-apple-release.md)
- [中文 README](README.md)

## Get involved

- If the project solves a problem for you, support it with a [Star](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou).
- For reproducible problems, use the [bug report form](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues/new?template=bug-report.yml).
- For a concrete workflow or product idea, use the [feature request form](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues/new?template=feature-request.yml).
- Before reporting, try the [latest public release](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest) and include the app version, operating-system version, and CPU architecture.

## Maintainer and license

Developed and maintained by [YukiRyou / yoshino-xiao7](https://github.com/yoshino-xiao7). Project source is available under the [MIT License](LICENSE); bundled third-party runtimes and dependencies retain their respective licenses.

DeepSeek and DeepSeek Harness are names and marks of their respective owners.
