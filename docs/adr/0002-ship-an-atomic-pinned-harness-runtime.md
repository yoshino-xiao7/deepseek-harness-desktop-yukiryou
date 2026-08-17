---
status: accepted
---

# 随应用原子交付固定 Harness 运行时

每个应用版本携带一个经过验证的 Node.js 与 `@deepseek-ai/dsh` 精确版本，运行时不自行在线升级。DeepSeek Harness 仍处于 Developer Preview，桌面壳、Web UI 和持久数据之间存在兼容风险；把它们作为一个签名发布单元可以重现问题、验证升级并保留可控回滚路径，代价是应用更新包较大且 dsh 升级需要重新发布应用。

