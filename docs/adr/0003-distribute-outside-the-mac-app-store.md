---
status: accepted
---

# 使用 Developer ID 在 Mac App Store 之外分发

应用通过签名、公证的 DMG/ZIP 直接分发，不提交 Mac App Store。Harness 的核心能力需要启动子进程、执行开发工具并访问用户代码仓库，而 MAS App Sandbox 会显著限制这些能力；站外 Developer ID 分发保留所需能力，同时仍满足 Gatekeeper、Hardened Runtime 和 notarization 的完整信任链。代价是团队必须维护下载与更新通道，并承担 Apple Developer 签名基础设施。

