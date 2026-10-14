---
record: docs-learnings-r19-20
task: 第 19–20 轮 learnings 落盘（P0 收官 + 进入 P1 期间踩到的 6 个坑）
date: 2026-10-14
branch: docs-learnings-r19-20
---

## 本次执行记录：第 19–20 轮 learnings 落盘（docs-learnings-r19-20，2026-10-14）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：
  `01-docs/learnings.md`、`.ccg/reviews/de6f0a61…json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS
### 本次写入的 6 条（全部来自实跑，不是复述）

| 键 | 类型 | 一句话 |
| --- | --- | --- |
| `mechanism-gap:egress-ledger-baseline-blocks-new-subprocess-tests` | 机制缺口 | 新增测试若 spawn 子进程会撞 required 的 egress 台账基线门禁；含复现口径与「归因不清就不登记基线」的处置 |
| `technique:self-referential-assertions-have-two-forms` | 技术 | 断言「本文件不含 X」必然踩的两种自指：注释命中自己、断言里的正则字面量命中自己 |
| `pattern:mutation-proof-can-be-red-for-the-wrong-reason` | 模式 | 反证两版都红，但红的原因都不是断言（环境红 / 递归 spawn 163s + 8 残留）|
| `pattern:milestone-criteria-vs-delivery` | 模式 | M0 八条判据实跑 4 通过 / 3 不通过，不通过的都在**判据侧** |
| `technique:two-data-copies-decide-the-conclusion` | 技术 | 仓库内/外两份同名数据字节不同；拿错源会得出「产物元数据错标」的错误结论 |
| `mechanism-gap:powershell-pipelines-mangle-bytes` | 陷阱 | 用 PowerShell 统计 CR 得到 9839 的**假数据**，据此提交了不必要的 `.gitattributes` |

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 本 PR 只改 `01-docs/` 与 `.ccg/`，未触及 `apps/desktop/electron/` 或 `packages/rpa-engine/` |
| QM-2 代码必检项 | **N/A** | 无代码变更（docs-only 已判） |
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 未执行（如实登记）| 本机无 `codeagent-wrapper` |
| 远程同步 | PASS | PR #3528 已合并，merge SHA `9b9e8d7251b0d70ae3b7b22a71df636caf345325`（2026-10-14）|

### 为什么这轮要单独落盘

用户要求「把有价值的内容保存到内置记忆、外部记忆和 EverOS」。EverOS 侧已写入会话
`mp-reuse-p0p3-rounds19-20`（4 条，`add` 200 → `flush` 200 `extracted`）；本 PR 补的是**外部记忆**
（`01-docs/learnings.md`，仓库内可检索的那一份）。

三条最值得留下来的，都是**「红了/绿了都不等于结论成立」**的同型错误：
反证红得没意义、PowerShell 统计出的 CR 是假的、拿错数据源得出的「差异」是假的。
共同解法：**先怀疑取证方式，再怀疑被取证的对象**。
