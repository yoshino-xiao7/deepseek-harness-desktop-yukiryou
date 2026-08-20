# Pet Runtime Spike Scorecard

这是 Phase 6D 的一次性终端壳，用来回答一个具体问题：候选先通过 Creator Input Contract 与无头 Skill 生成门后，能否再用同一套场景、资产、窗口、真机环境和固定权重公平比较，并避免未测数据或高视觉分掩盖制作、安全失败？Rive、dotLottie、透明 WebM 和高密度序列帧都只是候选，未通过 Creator Gate 就不会进入性能比较。可复用的纯评估逻辑位于 `src/shared/pet-runtime-evaluation.ts`，客观测量契约位于 `src/shared/pet-runtime-benchmark.ts`；这个终端壳不进入产品，选定唯一运行时后删除。

运行：

```bash
pnpm pet:spike
```

手工评分数据仅保存在当前进程内，不读取宠物包、不联网，也不写入项目或用户设置。

读取打包应用生成的 benchmark JSON 记录并比较客观证据：

```bash
pnpm pet:spike -- --benchmark artifacts/rive.json artifacts/dotlottie.json artifacts/webm.json
```

记录必须使用相同的场景、Creator Input hash、viewport、时长、切换次数、应用版本、Electron 版本和 arm64 打包环境；不同格式的成品资产各自记录 `petAssetSha256`，不要求二进制相同。缺字段、未知字段、路径字段或口径不一致会拒绝比较；网络请求、崩溃、watchdog 重启、Player runtime failure 或切换次数不足会阻断自动导入评分卡。自然度、制作效率和未来 Skill 自动化程度不会由客观指标虚构，仍需独立人工复核。
