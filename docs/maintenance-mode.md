# 维护模式说明

状态日期：2026-09-29

## 当前状态

DeepSeek Harness 官方已经公开 macOS 与 Windows 桌面发行版，并继续在官方仓库迭代：

- [官方 Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)
- [官方 Releases](https://github.com/deepseek-ai/deepseek-harness/releases)
- [官方 Desktop 目录与技术说明](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop)

因此，DeepSeek YukiRyou 不再作为官方桌面承载方案的主要替代实现继续扩展，仓库进入维护模式。

## 维护范围

继续处理：

- 官方 Harness 升级后的兼容性问题；
- 严重启动、安装、升级和数据保留问题；
- 已发布版本的安全修复；
- 现有用户迁移和版本说明。

暂停处理：

- 与官方 Desktop 重复的基础桌面壳能力；
- 独立运行时分叉和新的基础发行链；
- 需要持续产品投入的新功能。

现有的 Workspace Review、品牌化发行和受管插件能力保留在历史代码中。它们是否继续维护，以后续实际用户需求和官方能力覆盖情况为准。

## 归档条件

正式执行 GitHub Archive 前，需要完成：

1. 确认官方 Desktop 已覆盖现有用户的基本使用场景；
2. 发布最后一个必要的兼容性或迁移版本；
3. 更新 README、安装说明和官方迁移链接；
4. 关闭或转移仍需处理的 Issues 与 Pull Requests；
5. 保留 Release、Tag、变更记录和恢复所需的 Git 历史。

在满足这些条件前，仓库保持可写但不主动扩展功能。
