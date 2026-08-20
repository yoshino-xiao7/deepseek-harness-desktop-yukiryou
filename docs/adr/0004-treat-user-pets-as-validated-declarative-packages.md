---
status: accepted
---

# 将用户宠物作为经过校验的声明式资产包

用户自制宠物通过显式本地导入的 `.yukipet` 数据包交付，而不是 Harness 插件、HTML/JavaScript 小程序或可远程下载的皮肤。主进程使用系统文件选择器取得文件，在 Pet Store 同卷的随机 staging 中执行 archive、schema、hash、MIME、大小、动作契约和动画 payload 校验，成功后原子安装到 app-owned Pet Library；Harness 设置页只接收元数据和带 revision 的无路径命令，删除还需 main-owned 确认并先移到可恢复 Trash。

动画 runtime 代码与 WASM 只能随签名 App Version 交付；宠物包只含深度校验的声明式数据。Pet Stage 的可信布局和气泡留在 shell，动画 payload 进入专用非持久 session、无父 DOM/Workspace bridge、无网络的 sandboxed `WebContentsView`。其唯一 preload 是随签名应用交付、只把 main 的单个 MessagePort 一次性转交给签名 player entry 且不暴露任何 API 的 bootstrap；port 协议绑定 frame/epoch/generation，main watchdog 只销毁/重建该 player view。无法满足该隔离的 runtime 不得进入生产。

这使用户可以替换角色和动作表现，同时不让宠物获得 Workspace、Runtime Home、网络或代码执行能力，也不会扩大固定 Harness Runtime 的插件边界。代价是第一版只能支持冻结的语义动作和一个精确动画格式，新增引擎或能力必须升级包 schema、重新进行安全/性能评审，并通过新的应用版本原子交付。

被拒方案包括：只随应用写死一只宠物（无法满足用户制作与导入）、把宠物做成可执行插件/网页（权限不可控）、从远程市场动态下载（来源与更新边界未建立），以及让动画直接进入含 Workspace Review/preload 的 shell main world（会突破数据与能力隔离）。
