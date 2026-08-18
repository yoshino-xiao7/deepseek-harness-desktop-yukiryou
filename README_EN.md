<p align="center">
  <img src="resources/icons/deepseek-yukiryou.png" width="168" alt="DeepSeek YukiRyou">
</p>

<h1 align="center">DeepSeek YukiRyou — DeepSeek Harness Desktop for macOS</h1>

<p align="center">
  <strong>DeepSeek Harness, delivered as a real Mac app.</strong><br>
  A self-contained Apple Silicon workspace with a bundled runtime, account balance, workspace review, file previews, and trusted updates.
</p>

<p align="center">
  <a href="https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/yoshino-xiao7/deepseek-harness-desktop-yukiryou?include_prereleases&style=flat-square&color=3157a4"></a>
  <img alt="macOS 14+" src="https://img.shields.io/badge/macOS-14%2B-111827?style=flat-square&logo=apple">
  <img alt="Apple Silicon" src="https://img.shields.io/badge/Apple%20Silicon-arm64-3157a4?style=flat-square">
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
  If this project helps you, consider giving it a Star. It helps other people looking for a DeepSeek Harness macOS client discover the project.
</p>

---

## Project positioning

DeepSeek Harness provides a local Web UI, but routine use still involves preparing a runtime, starting commands, managing ports, and recovering failed processes. DeepSeek YukiRyou packages those responsibilities into an installable macOS app. It starts the pinned Harness runtime, cleans up only the processes it owns, and presents the complete Web UI in a native window.

This is not a rewrite of Harness and does not change how the agent works. Its job is to deliver Harness to the desktop with predictable startup, recovery, isolation, and updates, while adding desktop capabilities for account status, workspace files, and change review.

> The current release is an Apple Silicon Beta. Available features and the roadmap are listed separately below. Features marked “In development” or “Planned” are not included in the current installer.

| Ready to open | Native desktop | Inspectable | Trusted releases |
| --- | --- | --- | --- |
| Bundled Node.js, pnpm, and pinned Harness | Native traffic lights, draggable title bar, synchronized sidebar motion | Runtime recovery, rotated logs, redacted diagnostics | Developer ID signing, Apple notarization, in-app updates |

## Download and install

Open [GitHub Releases](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases) and download the Apple Silicon DMG:

~~~text
DeepSeek.YukiRyou-<version>-arm64.dmg
~~~

1. Open the DMG.
2. Drag **DeepSeek YukiRyou** into Applications.
3. Launch it from Launchpad or Applications.
4. Complete the required service configuration in Harness and start working.

Requirements: an Apple Silicon Mac (M1 or newer) running macOS 14 or later.

Every public release includes SHA-256 checksums. The app and update artifacts are Developer ID signed and Apple-notarized. Download only from this repository's GitHub Releases page.

## Available today

### Desktop and runtime

- **Integrated desktop window:** the local title bar follows Harness light, dark, and system themes.
- **Pinned bundled runtime:** Node.js, pnpm, and DeepSeek Harness ship with the app. Global installations are not used, and first launch does not install dependencies online.
- **Quiet lifecycle:** the app is single-instance, can hide on close, and restores from the Dock.
- **Independent recovery:** the Harness view and local shell recover separately, so one failure does not take down the other.

### Account and workspace

- **Account balance:** a compact row above Settings shows the balance of the account associated with the active DeepSeek credential. It does not claim a daily-spend value that the public API cannot provide precisely.
- **Desktop Companion:** a collapsible panel shows the current workspace tree, Git changes relative to HEAD, line statistics, and read-only diffs.
- **Readable previews:** Markdown switches between rendered and source views; plain text and common image formats can be previewed in the app.
- **Per-turn change entry:** confirmed changes appear below Harness's native artifact row and open directly in review mode.

### Settings, security, and releases

- **Useful settings:** Appearance controls desktop styling; About exposes versions, developer details, and the update center.
- **Quiet updates:** background checks do not add a main-window entry unless an installable update is available.
- **Private diagnostics:** exported diagnostics contain bounded, redacted environment and log data—not source files, sessions, or credentials.
- **Trusted release pipeline:** candidates are Developer ID signed, installed on a fresh runner, exercised in a real-app soak, Apple-notarized, and verified again before publication.

## Why YukiRyou

- **Delivered for Apple Silicon:** not a website shortcut, but a standalone macOS app with pinned Node.js, pnpm, and DeepSeek Harness runtimes.
- **A complete workspace review loop:** inspect the file tree, current Git changes, per-turn changes, line statistics, and rendered Markdown without leaving the conversation workflow.
- **Desktop capabilities that fit Harness:** account balance, the Companion sidebar, settings, and updates follow the existing interface instead of replacing or rewriting Harness's core workflow.
- **Verifiable releases:** public artifacts are Developer ID signed, Apple-notarized, installed in clean environments, exercised as real apps, and accompanied by SHA-256 checksums.

## Roadmap

| Feature | Status | Planned scope |
| --- | --- | --- |
| DeepSeek pet | **In development** | A bounded Companion activity area with a consistent character, idle blinking, drowsy/sleep/wake sequences, and a “devouring tokens” running state. High-frame-rate animation and visual QA begin after the character assets are finalized. |
| Mobile remote control | **Planned** | Explicit pairing and permissions for viewing task status, receiving relevant alerts, and continuing a task after user confirmation—without exposing the local Harness port directly. |
| Plugin marketplace | **Planned** | Plugin discovery, details, install, update, removal, and permission disclosure, opened only after source verification, signing, compatibility, and recovery boundaries are designed. |

The roadmap describes direction, not committed dates. If the security model, upstream Harness contracts, or required assets are not ready, the feature remains unavailable instead of shipping through brittle DOM injection or weakened system protections.

## How it works

~~~mermaid
flowchart LR
    A["DeepSeek YukiRyou.app"] --> B["Electron main process"]
    B --> C["Bundled Node.js"]
    C --> D["Pinned DeepSeek Harness"]
    D --> E["Random 127.0.0.1 port"]
    E --> F["Isolated Harness WebContentsView"]
    B --> G["Window, updates, and recovery"]
    G --> F
~~~

Harness listens on a random loopback port and is not exposed to the LAN. Its renderer runs without Node integration, with context isolation, sandboxing, and web security enabled. The desktop bridge exposes only a small validated capability surface. See the [security design](docs/03-security.md) for the complete trust boundary.

## Versions and updates

The app checks public GitHub Releases after startup, and updates can also be checked from **Settings → About**. After an update is downloaded, installation starts only after user confirmation.

The desktop shell, Node.js, pnpm, and Harness form one atomic release. Runtime pieces are never upgraded independently in the background. A release is signed, installed and smoke-tested on a fresh runner, soaked, notarized, and verified again before it becomes a draft. Publication is a separate explicit step. See the [release runbook](docs/09-github-and-apple-release.md).

## Local development

### Requirements

- Apple Silicon Mac
- macOS 14+
- Node.js 22.19+ or 24+
- Corepack / pnpm 10.34.5

### Start the project

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

Signing, notarization, and public distribution run only through the GitHub Actions **Release macOS** workflow. Local packaging is for development verification and is not a public release artifact.

## Pinned runtime

| Component | Current version | Policy |
| --- | --- | --- |
| DeepSeek Harness | <code>0.1.0-rc.7</code> | Pinned and verified with the app |
| Node.js | <code>24.19.0</code> | Bundled Apple Silicon runtime |
| pnpm | <code>10.34.5</code> | Used only by the bundled Harness |
| Electron | <code>43.4.0</code> | Desktop shell runtime |

The app does not invoke globally installed copies of Node.js, dsh, or pnpm, and it does not install dependencies online on first launch.

## FAQ

<details>
<summary><strong>Is this an official DeepSeek client?</strong></summary>

No. This is an independently developed community macOS project and is neither affiliated with nor endorsed by DeepSeek.

</details>

<details>
<summary><strong>Does it support Intel Macs or Windows?</strong></summary>

The current release target is Apple Silicon arm64 only. Intel, Windows, and Linux are outside the present support scope.

</details>

<details>
<summary><strong>Why is the download relatively large?</strong></summary>

For offline startup and reproducible versions, the app bundles its verified Node.js, pnpm, and Harness runtime instead of relying on global tools on the user's machine.

</details>

<details>
<summary><strong>How should I report a startup problem?</strong></summary>

Export a diagnostics archive from the app, then open a [GitHub Issue](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/issues) with the macOS version, app version, and reproduction steps. Review attachments before publishing them.

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
- Before reporting, try the [latest release](https://github.com/yoshino-xiao7/deepseek-harness-desktop-yukiryou/releases/latest) and include the app version, macOS version, and Apple chip model.

## Maintainer and license

Developed and maintained by [YukiRyou / yoshino-xiao7](https://github.com/yoshino-xiao7). Project source is available under the [MIT License](LICENSE); bundled third-party runtimes and dependencies retain their respective licenses.

DeepSeek and DeepSeek Harness are names and marks of their respective owners.
