---
record: learnings-batch3
task: 把「同型风险三批落锁」的经验沉淀落盘到 01-docs/learnings.md（此前只是共享根工作区脏项，未随任何 PR 入库）
date: 2026-10-17
branch: learnings-batch3
# ↓ 下面三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（三形态同改：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：同型风险三批经验落盘（learnings-batch3，2026-10-17）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=2：`01-docs/learnings.md`、`openspec/records/learnings-batch3.md`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 为什么单独开这条 PR

第三批（PR #3845）收尾时把经验写进了共享根工作区的 `01-docs/learnings.md`，但**它只是脏项，从未落盘**：
共享根当时被并发会话占用（其本地未推提交 + 3 个脏项），在其上 commit 会把别人的未推提交一起推走。
故走隔离 worktree + 独立分支把这一段单独落盘，共享根保持并发会话原样。

### 落盘内容（5 条，与共享根工作区逐行一致）

| 类型 | 条目 | 依据 |
| --- | --- | --- |
| pattern | 竞品缺陷→同型风险锁的三层纪律（红夹具 / 绿夹具 / 真实仓覆盖下界） | PR #3812/#3827/#3845，8 条锁 |
| pitfall | `scripts/` 不进 asar ⇒ 运行时真源必须放 `packages/shared-utils/src` | R7 `image-mime.js` 选址，用 `apps/desktop` 的 `build.files` 实证 |
| pitfall | `node --check` 不执行模块 ⇒ 数据来源替换类改动必须 require 实跑 | 第三批迁移后缺 require（阻断级，评审抓出）|
| pattern | CCG 循环收敛：填裁决后同 SHA 复跑、不提交；历史 upheld 置 `needs_revision` 写修复去向 | 第三批 7 轮 dual 评审的流程根因 |
| pitfall | mime 映射抄 N 份 ⇒ 单一真源 + 归一/不猜/别名三纪律 | 实测 5 处独立映射表 |

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 纯文档变更（docs-only=true），无运行时代码 |
| QM-2 代码必检项 | **N/A** | 同上 |
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | **N/A** | docs-only 通道跳过；本 PR 变更 1 个文档文件 + 1 条记录 |
| 远程同步 | PENDING | 待合并后回填 merge SHA |

### 证据

- 主干 `01-docs/learnings.md` 不含该段落（落盘前核实 `Select-String -Quiet` = False），追加为纯新增、无删除。
- 与共享根工作区待搬内容 `Compare-Object` 逐行一致（8/8）。
- 关联产物已合并入库：`#3845`（merge `c8a3ea40`）、`#3850`（回填 `86e51516`）；
  main push `quality-gate` run `39039367002` = success，Gate 2c6（八锁）在 main 上真跑 success。
