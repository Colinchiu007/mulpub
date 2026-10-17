---


record: learnings-upgrade-payment-entry
task: 沉淀 fix-upgrade-payment-entry 及其收尾环节的 7 条经验
date: 2026-10-17
---

# learnings 沉淀（learnings-upgrade-payment-entry）

## 1. 来源

本段经验来自 PR #3798（升级入口修正）的实施与收尾全过程，含 3 次 CI 红与 2 次假失败归因。写入 `01-docs/learnings.md` 末尾，跟随该文件既有的「`## 日期 · slug：标题` + `- **类型 · 内容**`」形态。

## 2. 七条内容（摘要）

| # | 类型 | 一句话 |
| --- | --- | --- |
| 1 | pitfall | `eslint-disable-next-line no-unused-vars` 挂在 import 上是**诊断**不是消音器：它掩盖了「模板从未渲染该组件」的真 bug，用户点按钮毫无反应 |
| 2 | pattern | 交互测试必须断言「点下去发生什么」；防回潮要锁在**源码层**，因为跳转与死绑定可以并存、此时行为测试照样通过 |
| 3 | pitfall | 删组件/删 watch 时必须 grep **所有 `readFileSync` + 目标文件名 的测试**——这类守卫不在 mount 路径上，行为测试全绿发现不了 |
| 4 | pitfall | 共享根落后 origin/main 时提交文档会**反向撤销**已合并的行（本轮落后 33 提交、其中 4 个改过同一文件）；正解是备份→恢复→ff→按锚点重放 |
| 5 | fact | 共享根 Write Guard 也会隔离**根级**新建临时脚本，导致后续 `node <脚本>` 报 MODULE_NOT_FOUND 且报错指向不了真因 |
| 6 | fact | `QG Coverage` 的 40 分钟红先按 runner 竞争判：`conclusion=cancelled` 且耗时 ≈ timeout ⇒ 超时而非缺陷，重跑即过 |
| 7 | fact | Browser E2E 的红可用「两轮差异只含测试文件」快速归因，避免翻长日志 |

## 3. 为什么值得沉淀（不是流水账）

- 第 1、3 条是**同一类结构性问题**：告警被消音 / 守卫不在你以为的路径上。二者都在本轮真实发生，且都是「测试全绿但功能是坏的」。
- 第 4 条推翻了一个常见误解：以为「文档改动风险低就可以直接提交」。实际风险来自**工作副本滞后**，与改动类型无关。
- 第 6 条的价值在于给出**可执行的判据**（`cancelled` + 耗时≈timeout），而不是「重跑试试」这种手感。它同时守住一条纪律：不得为了让红变绿去放宽 timeout。

## 4. 门禁

- 变更类型：纯文档（`01-docs/learnings.md` + 本记录），共享根就地编辑 + PR 落地
- `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见提交后取证
- 绝对路径：`node scripts/check-doc-abs-paths.js --all` → PASS
- 品牌残留：`node scripts/check-no-brand-residue.js` → PASS
- 本段写在 `01-docs/learnings.md` 末尾，未改动任何既有行（追加型写面，按锚点幂等追加）

## 远程同步

| 远程同步 | PASS | 已合并：PR #3842，merge `426e2350b7e43eea0985fbf3fc1c313f68e79ad1`（2026-10-17T20:56:16+08:00，squash）。远端分支已删 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 文档同步 ✅ | 远程同步 PASS
