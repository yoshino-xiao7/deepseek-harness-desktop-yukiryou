# DeepSeek YukiRyou for macOS

本项目把本机运行的 DeepSeek Harness 交付为可信、可安装、可维护的 macOS 桌面应用。

## Language

**桌面应用（Desktop App）**：
用户安装和启动的 macOS 应用整体，包含桌面壳与随包运行时。
_Avoid_: 客户端、GUI、套壳

**桌面壳（Desktop Shell）**：
负责窗口、菜单、通知、生命周期和更新的 macOS/Electron 部分，不实现 Agent 行为。
_Avoid_: Harness、后端

**Harness 运行时（Harness Runtime）**：
随桌面应用固定版本交付、在本机子进程中运行的官方 `@deepseek-ai/dsh`。
_Avoid_: 服务端、模型、Electron 后端

**Harness UI**：
由 Harness 运行时在本机回环地址提供的官方 Web UI。
_Avoid_: 自研前端、远程网页

**运行时目录（Runtime Home）**：
桌面应用为 Harness 运行时指定的独立持久化目录，保存 Harness 自有配置和会话数据。
_Avoid_: 应用缓存、仓库目录

**运行时版本（Runtime Version）**：
与某个桌面应用版本一起验证并原子发布的 `@deepseek-ai/dsh` 版本。
_Avoid_: 最新版、用户安装版本

**应用版本（App Version）**：
桌面壳与一个运行时版本组成的可签名、可公证、可更新发布单元。
_Avoid_: Harness 版本

**桌面伴侣（Desktop Companion）**：
由桌面壳承载的辅助能力集合。它对 Workspace 保持只读；当前包含 Harness 官方 slot 账户余额、右栏与 Workspace Review，规划加入 Pet Stage 和应用自有 Pet Library，但不复制 Agent、会话或工具详情 UI。
_Avoid_: 新 Harness UI、文件编辑器、侧栏工作区

**Workspace Review**：
面向当前 Harness Workspace 的只读文件树、Git 变更、diff 与安全预览。
_Avoid_: IDE、自动修改

**Workspace Authority / Capability**：
Authority 是 Runtime 对 Session 所属 canonical Workspace 的权威解析；Capability 是主进程据此建立的短期不透明文件访问权限。
_Avoid_: 浏览器传入路径、永久目录授权

**宠物资产库（Pet Library）**：
应用自有目录中的内置宠物和已安装用户宠物集合；不属于 Runtime Home 或 Workspace。
_Avoid_: 宠物插件、Workspace 资产

**宠物包（Pet Package）**：
由应用校验并导入的声明式 `.yukipet` 本地资产包。它描述角色和受支持的语义动作，不携带可执行代码。
_Avoid_: 插件、脚本包、远程皮肤

**宠物活动区（Pet Stage）**：
Desktop Companion 顶部具有固定坐标系和裁剪边界的宠物展示区域；完全隐藏 Companion 与拖拽到最小可见宽度是两个不同状态。
_Avoid_: Workspace、桌面漫游层

**语义动作（Semantic Motion）**：
应用状态机可以请求的动作含义。用户可自定义视觉实现，但不能改变动作何时触发或获得新的应用权限。
_Avoid_: 任意脚本、用户状态机

**创作者输入（Creator Input）**：
普通用户制作宠物时需要提供的角色参考图与自然语言动作要求；可以追加更多视角或分层素材提高质量，但不能强制要求动画软件、骨骼绑定、状态机、代码或文件命名知识。
_Avoid_: Rive 工程、动画师交付物、运行时资产

**受支持制作流程（Supported Authoring Workflow）**：
项目负责维护的自动化流程，从创作者输入生成、验证并打包可导入的宠物包；底层动画格式和制作工具属于其实现，不属于用户必须学习的 Interface。
_Avoid_: 制作教程、手工导出清单、第三方编辑器前置条件

**宠物制作 Skill（Pet Authoring Skill）**：
受支持制作流程面向 Codex 的交互入口，接收创作者输入并输出宠物包、预览和 QA 报告；不在应用运行时执行，也不把底层动画引擎知识转嫁给用户。
_Avoid_: 运行时插件、宠物市场
