---
record: agents-migration-numbering-discipline
task: AGENTS.md 新增「迁移编号的唯一性纪律」一节（补 migrations/ 的零覆盖）
date: 2026-10-23
branch: agents-migration-numbering-discipline
---

## 本次执行记录：AGENTS.md 新增「迁移编号的唯一性纪律」（agents-migration-numbering-discipline，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**：`AGENTS.md` 属 `CI_IGNORED_PATHS` 的 `*.md`；就地编辑 + 经 PR 落地，未创建 worktree，未直推 main。在裸 task 名分支 `agents-migration-numbering-discipline` 上工作 |
| 第一性原因（QM-5 ①） | N/A | 纯新增文档段落，非缺陷修复 |
| 逃逸分析（QM-5 ②） | N/A | 同上 |
| 修复 + 回归保护（QM-5 ④） | N/A | 未触运行面 |
| 防止再次发生（QM-5 ⑤） | ✅ | 本次改动本身就是「防止再次发生」：把「迁移编号跨 change 共享、落库前必须重查」这条**从未被任何文档覆盖**的纪律写进 AGENTS.md，并附实测代价与正确做法 |
| 行尾与 diff 对账 | 见 commit | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；**纯新增 31 行、删除 0 行** |
| 编码完整性 | ✅ | `grep -c $'\xef\xbf\xbd'` = 0；末尾换行保留 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`，files=1 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`；无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本环境无 `codeagent-wrapper`；**不以自审冒充通过**。替代验证：本次改动的每条断言均附**可复现的取证命令**（`ls migrations/postgresql/`、台账脚本行号、change 的 tasks 行号），读者可逐条复核 |
| 远程同步 | 由门禁推导 | 本记录按 2026-10-17 起的现行形态书写：状态列不手写状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

## 动因与取证

**缺口**：AGENTS.md 全文 1228 行，对 `migrations/postgresql` **零覆盖**（`grep -nE "migrations/postgresql|迁移编号|编号冲突|MIGRATION_PATTERN|checksum"` → 0 命中）。

**为什么这个缺口有真实代价**：Postgres 迁移台账对「文件名 + checksum」双向锁定
（`packages/api-publish-engine/src/auth/postgres-migrations.js:6` 的 `MIGRATION_PATTERN`、
`:61-62` 与 `:104-106` 的 `MIGRATION_CHECKSUM_MISMATCH`），且
`postgres-identity-repository.js` 的 `assertReady` 用 `allowPending:false`
⇒ 编号撞车或「文件已入库未执行」都会让 identity 仓储在**启动期硬失败**，
表现为 `publish-api-server.js` 打 `MEMBERSHIP_UNAVAILABLE` ⇒ **会员中心整体降级**。

**实测案例（2026-10-23）**：`compute-key-envelope-migration` 的 tasks 3.1 写的是
`006_official_key_envelopes.sql`，而 `006_payment_orders.sql`（微信 Native 支付那条线）
已占用该号。该 change 因此改用 `007`，并把「落库前先查编号」写进它的 tasks 1.3。

**新增的三条纪律**：

1. 落任何迁移文件前必须先 `ls migrations/postgresql/` 确认目标编号未被占；
2. 加文件与执行必须同批部署（`allowPending:false` 的直接推论）；
3. 迁移 change 开 PR 前必须**重新**查编号，不得沿用规格写下时的编号——
   规格与落库之间可能隔了几周、几十个 PR，而 **change 级评审看不到别的线将要占用的号**。

## 一并核到的另一处（**结论：不改 AGENTS.md**）

本次也核了「执行记录形态」那条 AGENTS.md 段落——**它已经被订正过了**，
`AGENTS.md:79` 明确写着（2026-10-17 再收窄）：

> 新 PR 的记录不再写状态词——表行状态列写「由门禁推导」、bullet 里写 `远程同步 PR #NNNN`
> 或直接省略状态，收口由 `scripts/lib/merge-ledger.js` 推导。

`:67` 的闭合词表条末尾同样有「2026-10-17 起这一整条只约束旧载体与存量旧行」。

⇒ **本 PR 不动该段落**。（本次会话早前据一份 16 天前的 AGENTS.md 副本判断「该段至今未同步」，
是**判断错误**——重新取最新 main 核对后确认早已订正。）

## 遗留

- **L1 · `compute-key-envelope-migration` 第 3 组仍未动** —— 其信封表的外键指向 `official_keys(id)`，
  而 `official_keys` 当前在 ops-center 的 SQLite（`ops-center/backend/models.py:116-136`、
  `database.py:8-11`），**Postgres 侧无该表** ⇒ FK 建不出来；现在落迁移文件会在部署时
  `relation "official_keys" does not exist` ⇒ 启动期硬失败 ⇒ 会员中心整体降级。
  **前置**：先落地「`official_keys` 迁入 Postgres」的 change（`official-keys-postgres-migration`）。
- **L2 · 本仓还有一个已存在但同样未被 AGENTS.md 覆盖的点** —— 迁移 change 的**规格编号与落库编号会漂移**。
  本 PR 的第 3 条纪律已覆盖「落库前重查」，但**规格文档本身仍写着旧编号**（该 change 的 tasks 3.1）。
  正确做法是在同一个 change 里改规格，而不是等另一个 PR 来改。已记入该 change 的 tasks 1.3。
