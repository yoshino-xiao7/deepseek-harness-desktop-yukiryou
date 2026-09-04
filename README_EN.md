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
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest">Download latest</a>
  ·
  <a href="#download-and-install">Install guide</a>
  ·
  <a href="#available-today">Features</a>
  ·
  <a href="#local-development">Local development</a>
  ·
  <a href="docs/README.md">Developer docs</a>
  ·
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues">Report an issue</a>
  ·
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou">⭐ Star this project</a>
</p>

---

## Contents

- [Project positioning](#project-positioning)
- [Download and install](#download-and-install)
  - [macOS](#macos)
  - [Windows](#windows)
  - [Verify downloads](#verify-downloads)
- [Available today](#available-today)
- [Why YukiRyou](#why-yukiryou)
- [Interface overview](#interface-overview)
- [Roadmap](#roadmap)
- [Versions and updates](#versions-and-updates)
- [Technical architecture](#technical-architecture)
- [Local development](#local-development)
- [Pinned runtime](#pinned-runtime)
- [FAQ](#faq)
- [Documentation](#documentation)
- [Get involved](#get-involved)

## Project positioning

DeepSeek Harness provides a local Web UI, but routine use still involves preparing a runtime, starting commands, managing ports, and recovering failed processes. DeepSeek YukiRyou packages those responsibilities into an installable cross-platform desktop app. It starts the pinned Harness runtime, cleans up only the processes it owns, and presents the complete Web UI in a native window.

This is not a rewrite of Harness and does not change how the agent works. Its job is to deliver Harness to the desktop with predictable startup, recovery, isolation, and updates, while adding desktop capabilities for account status, workspace files, and change review.

> Currently supported: Apple Silicon on macOS 14+ and Windows 11 x64. Intel Macs, Windows on Arm, and Linux are not currently supported.

| Ready to open | Native desktop | Inspectable | Trusted releases |
| --- | --- | --- | --- |
| Bundled Node.js, pnpm, and pinned Harness | Platform-aware chrome, synchronized themes, responsive Workspace Review | Runtime recovery, rotated logs, redacted diagnostics | Signed/notarized macOS releases; real Windows install-lifecycle candidate gates |

## Download and install

All public artifacts are available from the [latest GitHub Release](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest).

### macOS

Requirements: an Apple Silicon Mac (M1 or newer) running macOS 14 or later.

Each release provides two artifacts:

~~~text
DeepSeek.YukiRyou-<version>-arm64.dmg
DeepSeek.YukiRyou-darwin-arm64-<version>.zip
~~~

**Install with the DMG:**

1. Download and open the DMG.
2. Drag **DeepSeek YukiRyou** into Applications.
3. Launch it from Launchpad or Applications.
4. Complete the required service configuration in Harness and start working.

**Install from the ZIP:**

1. Download and extract the ZIP.
2. Move **DeepSeek YukiRyou.app** into Applications.
3. Launch it from Applications.

The macOS app and update artifacts are Developer ID signed and Apple-notarized.

### Windows

Requirements: Windows 11 x64.

Each release provides an installed and a portable build:

~~~text
DeepSeek.YukiRyou-<version>-win32-x64-Setup.exe
DeepSeek.YukiRyou-win32-x64-<version>-portable.zip
~~~

**Installed build:**

1. Download and run `Setup.exe`.
2. Choose an install directory in the NSIS wizard and finish installation.
3. Launch **DeepSeek YukiRyou** from the Start menu or install directory.

**Portable build:**

1. Download and fully extract the ZIP.
2. Run the app from the extracted directory. The portable build does not register an installation.

Windows artifacts are not Authenticode-signed yet and may trigger SmartScreen. Download only from this repository's Releases and verify the SHA-256 digest; an unsigned artifact does not carry Windows publisher trust.

### Verify downloads

Every stable release includes `SHA256SUMS.txt` for macOS and `SHA256SUMS-Windows.txt` for Windows. Download the artifact and its checksum list into the same directory, then run:

**macOS:**

~~~bash
shasum -a 256 DeepSeek.YukiRyou-<version>-arm64.dmg
# Compare the result with the matching entry in SHA256SUMS.txt.
~~~

**Windows PowerShell:**

~~~powershell
Get-FileHash .\DeepSeek.YukiRyou-<version>-win32-x64-Setup.exe -Algorithm SHA256
# Compare the result with the matching entry in SHA256SUMS-Windows.txt.
~~~

GitHub Releases is the global origin. Mainland China automatically prefers the ESA-protected [`download-cn.suzuki.ink`](https://download-cn.suzuki.ink) mirror and falls back to GitHub when necessary. The mirror is populated only after the GitHub Release is public and all checks pass. Its [`downloads/latest.json`](https://download-cn.suzuki.ink/downloads/latest.json) lists versioned direct links, sizes, and SHA-256 digests for the current four installers.

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

- **One appearance entry:** light, dark, and system modes live in General → Appearance; About exposes versions, developer details, and updates.
- **Quiet updates:** background checks do not add a main-window entry unless an installable update is available.
- **Private diagnostics:** exported diagnostics contain bounded, redacted environment and log data—not source files, sessions, or credentials.
- **Trusted release pipeline:** candidates pass platform-specific install, launch, and stability gates. macOS additionally requires Developer ID signing, Apple notarization, and final artifact verification.

### Plugin marketplace

- **Complete discovery:** search, categories, pagination, and custom HTTPS sources operate over a complete local index. Catalog inclusion is never presented as endorsement or a security audit.
- **Pre-install inspection:** verifies catalog/npm identity, repository backlinks, lifecycle scripts, integrity, platform and Runtime compatibility, the complete dependency graph, peers, and actual package bytes.
- **Managed lifecycle:** install, update, reinstall, enable, disable, rollback to the previous verified version, and uninstall. Mutations require native confirmation and unhealthy restarts automatically restore the prior version.
- **Explicit permission boundary:** plugins share the local user's permissions with Harness. The renderer never receives Runtime tokens, cache paths, or executable installation plans.

## Why YukiRyou

- **A real cross-platform desktop product:** not a website shortcut. macOS and Windows share the pinned Harness Runtime, core capabilities, and state contracts; platform differences stay behind window, path, process, and installer adapters.
- **A complete workspace review loop:** inspect the file tree, Git changes relative to HEAD, per-turn artifacts, line statistics, read-only diffs, and rendered Markdown without leaving the conversation.
- **Fits Harness instead of replacing it:** account overview, Desktop Companion, settings, the plugin marketplace, and updates follow Harness interaction patterns without rewriting its Agent workflow.
- **Verifiable releases:** public artifacts come from controlled workflows and include SHA-256 checksums. macOS additionally passes Developer ID signing, Apple notarization, clean-machine installation, and final artifact verification.
- **Diagnosable and recoverable:** pinned runtimes, process-ownership checks, rotated logs, and redacted diagnostics reduce machine-specific failures that are otherwise difficult to reproduce.

## Interface overview

Harness remains the main workspace while desktop capabilities are added within the same window:

| Area | Main content | Behavior |
| --- | --- | --- |
| Desktop title bar | Window dragging, desktop status, and Companion toggle | Always managed by the native desktop shell |
| Harness workspace | Conversations, Agent tools, settings, and plugins | Preserves the official Harness interaction model |
| Desktop Companion | Changes and Files views | Collapsible and resizable without covering the main workspace |
| Workspace Review | File content, read-only diffs, Markdown, and image previews | Opened from Companion or per-turn artifacts; a review surface, not a separate workflow |

## Roadmap

| Feature | Status | Planned scope |
| --- | --- | --- |
| Mobile remote control | **Planned** | Explicit pairing and permissions for viewing task status, receiving relevant alerts, and continuing a task after user confirmation—without exposing the local Harness port directly. |
| Plugin ecosystem | **Ongoing** | Extend the existing discovery, inspection, and managed lifecycle with stronger publisher signals, clearer permissions, and richer compatibility information. |

The roadmap describes direction, not committed dates. If the security model, upstream Harness contracts, or required assets are not ready, the feature remains unavailable instead of shipping through brittle DOM injection or weakened system protections.

## Versions and updates

The app checks for updates after startup and can also check from **Settings → About**. Mainland China prefers the domestic mirror, while other regions prefer GitHub; the China source falls back to GitHub when unavailable. Both macOS and installed Windows builds download updates in the background and install only after the user confirms a restart.

The desktop shell, Node.js, pnpm, and Harness form one atomic release unit. Runtime components are never upgraded independently in the background, avoiding unreproducible mixes of old and new components. A stable release notarizes the DMG once, then creates the automatic-update ZIP from the stapled app. See the [release runbook](docs/09-github-and-apple-release.md).

<details>
<summary><strong>Notes for upgrading from early beta builds</strong></summary>

Before upgrading from `v0.2.1-beta.2` to the first rc.8 build, quit the old app completely from its application menu. The old Runtime has no owner watchdog, and the one-time origin migration relies on the final retained ready record.

If the old app was force-quit, its main process crashed, or desktop logs were manually removed, restart macOS before installing to prevent old and new Runtimes from writing concurrently. If the ready record was already lost, you may need to select the previous session once from the sidebar after upgrading.

</details>

## Technical architecture

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

The runtime boundary has several layers:

- **Local listening:** Harness uses a stable loopback endpoint selected and persisted by the app and is never exposed to the LAN.
- **Possession proof:** every Runtime start uses a fresh random secret and an HMAC challenge to prove that the responder holds it.
- **Migration protection:** the final ready record in physical order selects the stable origin during one-time legacy-log migration; all other ready ports retained in rotated logs must first be released.
- **Fail-closed behavior:** if a legacy Runtime still owns a port, the app stops before copying or opening Runtime Home.
- **Renderer isolation:** the web view runs without Node integration and with context isolation, sandboxing, and web security enabled; the desktop bridge exposes only a small validated surface.

HMAC possession proof is not operating-system process isolation. See the [security design](docs/03-security.md) for the complete boundary.

## Local development

### Requirements

- Node.js 22.19+ or 24+
- Corepack / pnpm 10.34.5
- macOS development: an Apple Silicon Mac running macOS 14+
- Windows development: Windows 11 x64; the Windows Runtime must be assembled on a Windows host

### macOS: start and validate

~~~bash
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor -- --arch=arm64
pnpm dev
~~~

Validate regular changes and macOS packaging:

~~~bash
pnpm check
pnpm test:e2e
pnpm package:mac -- --arch=arm64
~~~

macOS signing, notarization, and public distribution run only through the GitHub Actions **Release desktop (macOS + Windows)** workflow. A local machine can create only a non-publishable signed candidate:

~~~bash
export MACOS_SIGN_IDENTITY="Developer ID Application: ... (...)"
pnpm release:mac:candidate
~~~

The workflow uses multiple clean Apple Silicon runners. A candidate must verify and launch after being copied into Applications before it can be submitted to Apple. The notarized DMG and ZIP are then installed again on a separate runner and must pass Gatekeeper and launch checks. Passing all gates creates only a Draft; publication requires explicit approval.

### Windows: start and validate

Run on a Windows x64 host:

~~~powershell
corepack enable
pnpm install --frozen-lockfile
pnpm runtime:vendor:win
pnpm runtime:verify
pnpm dev
~~~

Create and validate candidate artifacts:

~~~powershell
pnpm check
pnpm test:e2e
pnpm make:win
~~~

The **Windows x64 candidate** workflow verifies both the guided NSIS installer EXE and portable ZIP, and installs, launches, repair-installs, and uninstalls the candidate. The desktop release workflow adds the versioned EXE, portable ZIP, and Windows SHA-256 list to the same GitHub Release as macOS.

See the [release rules](docs/09-github-and-apple-release.md) and [changelog](CHANGELOG.md) for the complete gates.

## Pinned runtime

| Component | Current version | Policy |
| --- | --- | --- |
| DeepSeek Harness | <code>0.1.2-rc.1</code> | Pinned and verified with the app |
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
<summary><strong>Which platforms and installers are supported?</strong></summary>

Apple Silicon on macOS 14+ and Windows 11 x64 are supported. macOS ships signed and notarized DMG and ZIP assets; Windows ships an unsigned installer EXE and portable ZIP. Every artifact includes SHA-256 verification information. Intel Macs, Windows on Arm, and Linux are not currently supported.

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

See [`docs/README.md`](docs/README.md) for the complete index. Common entry points:

- [Product scope and acceptance criteria](docs/01-product-scope.md)
- [Architecture](docs/02-architecture.md) and [security model](docs/03-security.md)
- [Testing and release](docs/04-testing-and-release.md) and the [release runbook](docs/09-github-and-apple-release.md)
- [Development guide](docs/06-development-guide.md) and [current implementation status](docs/07-current-status.md)
- [Desktop Companion plan](docs/10-desktop-companion-plan.md)
- [Integrated shell and plugin marketplace plan](docs/11-integrated-desktop-shell-and-plugin-market.md)
- [Temporary Harness patches](docs/12-temporary-harness-patches.md)
- [Developer-verified plugin source](docs/13-developer-curated-plugin-source.md)
- [中文 README](README.md)

## Get involved

- For reproducible problems, use the [bug report form](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues/new?template=bug-report.yml).
- For a concrete workflow or product idea, use the [feature request form](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues/new?template=feature-request.yml).
- Before reporting, try the [latest public release](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest) and include the app version, operating-system version, and CPU architecture.

## Maintainer and license

Developed and maintained by [YukiRyou / yoshino-xiao7](https://github.com/yoshino-xiao7). Project source is available under the [MIT License](LICENSE); bundled third-party runtimes and dependencies retain their respective licenses.

DeepSeek and DeepSeek Harness are names and marks of their respective owners.
