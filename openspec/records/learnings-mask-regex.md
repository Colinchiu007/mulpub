---
record: learnings-mask-regex
task: 沉淀 code-mask 正则字面量缺陷的 4 条教训（等价≠正确 / A/B 证明能看见 / 正则除号白名单 / CCG 后端不可用的合法出路）
date: 2026-10-18
branch: learnings-mask-regex
---

## 本次执行记录：code-mask 教训沉淀（learnings-mask-regex，2026-10-18）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：`01-docs/learnings.md`、本篇）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅（10118 tracked 文件 PASS）| 文档同步 ✅ | 远程同步 由门禁推导

### 为什么单独开这条 PR（而不是并进 #3909）

#3909 已合并（`307d0522`）。合并时共享根又被并发会话占用（`M 01-docs/PRD.md`、`M 01-docs/learnings.md`、
`M CHANGELOG.md` + 两个 untracked），且共享根 HEAD 落后 origin/main。
按 AGENTS.md「共享根滞后时不得就地编辑上游也在改同一处的文件」⇒ 改用隔离 worktree（基于
`origin/main@7ac37d016`）单独落盘，共享根保持并发会话原样。

### 4 条沉淀（全部来自本轮实测）

| 类型 | 条目 | 依据 |
| --- | --- | --- |
| pitfall | 抽共享库时「与旧实现逐字节等价」**不构成正确性证明 —— 等价只能证明「错得一样」** | `code-mask.js` 抽库时只做等价断言、零自有测试；它漏了正则字面量形态，导致 311 文件含危险正则、164 个掩码被打穿（最坏 0.03），八锁持续 PASS |
| pattern | 掩码/解析器类判据必须**先用 A/B 证明「能看见」**（看不见 与 没有违规 输出同形）| 旧 vs 新逐文件比可见字符数，得 174 增 / 2916 不变 / **0 回归**；并当场揪出两个候选修复各自的回归（14844→8010、5622→4431）|
| fact | 文本级判定 `/` 是正则还是除号：**白名单闭集、默认除号，`>` 在内 `<` 在外** | 两次实测把白名单钉出来；正确集合与关键字表已写入 learnings |
| fact | **CCG 深度审查后端不可用时的合法出路** | 引擎 DUAL 两次 `spawnSync codeagent-wrapper.exe ETIMEDOUT`（同处）；降级为主代理自查时 `status=cleared` 但 `performedBy` 必须写明降级与依据，不得谎称跑过 dual；先例 `14179872` |

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 纯文档（docs-only=true）|
| QM-2 代码必检项 | **N/A** | 同上 |
| QM-4 视觉 | **N/A** | 无 UI |
| QM-6 双模型评审 | **N/A** | docs-only 通道跳过 |
| 远程同步 | 由门禁推导 | change `gate-record-sync-derived-status` |

### 关联

- `#3909`（merge `307d0522`）：code-mask 补齐正则字面量识别。PR 侧 22 项检查全 pass；
  main push `quality-gate` 真跑（改动含 `scripts/lib/` + `.github/workflows/` ⇒ 不命中 paths-ignore）。
- 同批已同步到 EverOS（`atomic_fact-2026-10-18.md` +3）与 gstack `learnings.jsonl`（+3）。
