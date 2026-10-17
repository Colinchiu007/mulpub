---
record: learnings-add1
task: 补记一条 pitfall —— 共享根被并发会话占用时，绝不在其上 commit（文档/记忆也要走隔离 worktree 分支）
date: 2026-10-18
branch: learnings-add1
---

## 本次执行记录：并发会话占用共享根时的落盘纪律（learnings-add1，2026-10-18）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：`01-docs/learnings.md`、`openspec/records/learnings-add1.md`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS（`4612222b2ff93df0dd6a0dd65700f04dec8948fe`）

### 触发场景（实测，非推演）

第三批收尾（#3845/#3850）与 learnings 落盘（#3857/#3858）同日进行时，共享根停在
**并发会话的本地未推提交** `2e9c6a002`，且工作区有并发会话的 3 个脏项
（`CHANGELOG.md`、`openspec/records/hot-topics-viral-item-sources.md`、以及一份 `01-docs/learnings.md`）。

### 处置（先核对后搬家，不动他人所有物）

1. **核归属**：`git diff -U0` 逐文件看新增/删除行，确认 `01-docs/learnings.md` 的改动**属于本会话**
   （8 行纯新增、0 删除），另两个文件属于并发会话。
2. **搬走**：`git worktree add -b <分支> <路径> origin/main`（基于干净主干，不携带并发会话提交），
   把本会话的那一份搬进 worktree 单独提交 + PR。
3. **共享根原样保留**：不 stash、不 reset、不 ff —— 并发会话的未推提交与脏项一个都不碰，收尾如实登记。

### 这一条的代价（诚实记录）

第一次处置后，我又在共享根直接补写了一行 learnings —— 它**再次变成不入库的脏项**。
这正好证明该纪律的必要性：**共享根的任何写入，在并发会话占用期间都不会自动落盘**。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 纯文档（docs-only=true） |
| QM-2 代码必检项 | **N/A** | 同上 |
| QM-4 视觉 | **N/A** | 无 UI |
| QM-6 双模型评审 | **N/A** | docs-only 通道跳过 |
| 远程同步 | PASS | PR #3863 已合并，merge SHA `4612222b2ff93df0dd6a0dd65700f04dec8948fe`（2026-10-18 00:32 +08:00）|

### 关联

- 同日已合并：`#3845`（第三批八锁）、`#3850`、`#3857`（learnings 落盘）、`#3858`。
- 共享根当前态：`main@2e9c6a002`（并发会话占用，含 3 个脏项），已在收尾中如实登记。
