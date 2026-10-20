---
title: 把 PR #4061 三轮的取证口径沉到内置记忆与外部记忆（learnings-electron-ci-2026-10-20）
branch: learnings-electron-ci-2026-10-20
date: 2026-10-20
type: docs-only
---

## 本次执行记录：把 PR #4061 三轮的取证口径沉到内置记忆与外部记忆（learnings-electron-ci-2026-10-20，2026-10-20）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（提交后取证，见下）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档绝对路径 ✅ | 文档同步 ✅ | 远程同步 由门禁推导
- 变更类型与隔离声明：纯流程/文档变更，在共享主工作区就地编辑 + 经 PR 落地（不进 worktree，符合分层策略）

### 收口形态（表行 + bullet 同写）

| 项 | 值 |
| --- | --- |
| 远程同步 | 由门禁推导 |

> 本仓自 2026-10-17（change `gate-record-sync-derived-status`）起，新 PR 的「远程同步」状态列不再手写状态词，
> 统一写「由门禁推导」，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。表行与 bullet 两形态必须同写——
> 本轮首推就是因为只写了 bullet、缺了这张表行，被 `check-gate-record-debt` 判「整块缺 远程同步 行」而红（已修）。
### 为什么写这一篇

PR #4061（merge `528acaa0d`）跑完三轮 CI 才绿，产出四条可迁移的判据纪律。原始现场都在执行记录
`openspec/records/electron-ci-shard.md` 与 PR 评论里 —— 但那是**一次性现场**，每个新会话既不会读它、
也不知道去读。因此把**可迁移的那部分**沉到两个会被自动加载/检索的位置：

| 载体 | 落点 | 为什么是这里 |
|---|---|---|
| 内置记忆 | `AGENTS.md` 新增 `### 取证口径（2026-10-20，PR #4061 三轮回读后固化）` | `AGENTS.md` 是**每个会话自动读取**的规范面；该小节起始于全文约 34KB 处，**落在 65KB 加载窗内**（本仓 AGENTS.md 已 279KB，放尾巴等于没写） |
| 外部记忆 | `01-docs/learnings.md` 新增 `## 2026-10-20 · electron-ci-shard-budget：…` | 该文件是可 grep 的经验库（936 个 `## ` 条目），尾部追加、不与其它会话争抢顶部 |
| EverOS | `app_id=multi-publish`，`project_id=default` 与 `dsh-session-import` 各写一轮 | 跨项目向量检索；本轮实测**写入判据必须包含 search 复核** |

### 四条判据纪律（摘要）

1. **判据域跟着被测性质走**：被测性质是「会执行」时，判据不能只是「这行字符串存在」。反例：自证块自 #2525 起从未执行，而锁全绿。
2. **取证面要遍历所有承载 gate 的机制**：`branches/main/protection`（4 条）与 `rulesets`（7 条）并存，只查一套会得出「不受约束」的假结论。
3. **matrix 与 required status check 结构性冲突**：两种补名写法各自硬失败（汇入作业让 workflow 不可解析；静态 `name` 不消 `(1)` 后缀）。
4. **局部绿 ≠ 整体绿**：判据挂在整套跑完之后（出站台账/覆盖率）时，单文件通过不构成证据。

### EverOS 写入的落盘判据（本轮踩到的坑）

`add` 返回 `accumulated` **不等于**落盘；必须 `flush` 返回 `extracted`。且**写入 project 与检索可见 project 可能不是同一个** ——
本轮先写 `project_id=dsh-session-import`，文件确实落盘（`users/agent/episodes/`，3502B）而按该 project 检索 **0 命中**；
改投 `project_id=default` 后 search 才命中（该 project 实际落在目录 `default_project`，且同时抽取了 `.atomic_facts` 与 `user.md`）。
**口径**：EverOS 的成功判据是「`flush=extracted` **且** search 能召回」，只看到文件出现在磁盘上不算。

### 说明

- 本 PR **不含任何运行时代码**，QM-1 / QM-4 / TDD / QM-6 均 N/A（docs-only 通道约定）。
- 未改 `.github/workflows/`、未改 `CI_IGNORED_PATHS` 白名单（不触碰「谁来守门」）。
- EverOS 内容不进仓库（跨项目记忆服务，非受管文件面）；仓库侧只留上述两份可 diff 的载体。
