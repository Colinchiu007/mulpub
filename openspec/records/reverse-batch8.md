---
record: reverse-batch8
task: 竞品逆向第八批 —— sig3 自由变量三元气全锁定 + 通道模型（复刻前最后一层）
date: 2026-10-19
---

## 本次执行记录：竞品逆向第八批（reverse-batch8，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**（1 新增 + 索引），隔离 worktree `mp-reverse-batch8` / 裸分支 `reverse-batch8` |
| 第一性原因（QM-5 ①） | ✅ | 首版 payload 契约实验得反结论（对象≢空串）—— 根因：count 自增使相邻调用输出必不同，受控对比未重置 count。打印实际输出值当场发现并纠正 |
| 逃逸分析（QM-5 ②） | ✅ | 逃逸点：实验装置未对齐（两次调用间 count 已 +1）。与 harness 跨 realm 教训同型。加固：黑盒实验统一「独立实例 + count 重置」框架，固化在 sig3-structure-final.cjs |
| 修复 + 回归保护（QM-5 ④） | ✅ | sig3-structure-final.cjs 一轮式复现全部实验，证据 JSON 落盘 |
| 防止再次发生（QM-5 ⑤） | ✅ | 文档 §1 ⚠ 块明记教训；②实验代码自带 count 重置注释 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致 |
| QM-1/QM-4/QM-6 | N/A | 纯文档 docs-only |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导 |

### 本批实测数字
| 项 | 读数 |
|---|---|
| 三元气 | payload字符串 / count(自增,初值100) / startupRandom(秒戳) |
| 基准复现 | count=100 预置 → 输出逐字节复现 |
| 高位表 | 空串 vs abc 0/28 相同；对象 vs 空串 28/28 相同 |
| XOR 通道 | 27/28 满足 lo = C_i ^ ((7−count)&7)；b8 吃 count bit3 |
| 雪崩/性能 | 单字节差 28/28；耗时线性 |

### 遗留
1. C 表与 SHA-256 摘要的精确映射（sub2 阅读）。
2. TEA 轮数（sub29 215 条未逐轮）。
3. 未做活体验证。
