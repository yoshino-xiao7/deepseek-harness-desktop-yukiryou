---
status: accepted
---

# 使用 Electron 构建 macOS 桌面壳

桌面壳采用 Electron，而不是 SwiftUI、Tauri 或浏览器 PWA。官方 Harness 本身是 Node/TypeScript Web 应用；Electron 可以直接管理 Node sidecar、复用 Harness UI，并用一套 TypeScript 实现窗口、安全策略和更新。代价是应用体积和内存更高，但改用其他技术仍需捆绑 Node/Chromium 或维护 WebView/sidecar 兼容层，不能消除主要复杂性。

