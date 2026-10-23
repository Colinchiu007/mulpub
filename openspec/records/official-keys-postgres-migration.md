---
record: official-keys-postgres-migration
task: 新增 official-keys-postgres-migration 提案（官方 Key 池迁入 Postgres，作为信封 change 的硬前置）
date: 2026-10-23
branch: official-keys-postgres-migration
---

## 本次执行记录：新增 official-keys-postgres-migration 提案（official-keys-postgres-migration，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**：新增 `openspec/changes/official-keys-postgres-migration/` 提案与本执行记录，均命中文档白名单 `openspec/**`；就地编辑 + 经 PR 落地，未创建 worktree，未直推 main。在裸 task 名分支上工作 |
| 第一性原因（QM-5 ①） | N/A | 纯新增提案，非缺陷修复 |
| 逃逸分析（QM-5 ②） | N/A | 同上 |
| 修复 + 回归保护（QM-5 ④） | N/A | 未触运行面 |
| 防止再次发生（QM-5 ⑤） | ✅ | 提案本身即为「防止再次发生」：把「信封表的 FK 建不出来 ⇒ 落迁移文件会炸生产」这个**跨 change 的依赖缺口**显式化，并给出解耦方案（只搬表、不重加密） |
| 行尾与 diff 对账 | 见 commit | 两口径一致；纯新增，删除数 0 |
| 编码完整性 | ✅ | 全部新增文件 `grep -c $'\xef\xbf\xbd'` = 0（写入过程中命中 1 处真实损坏并已修） |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS；正文只写内部路径与内部文件名，不含竞品名 |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`；无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本环境无 `codeagent-wrapper`；**不以自审冒充通过**。本 PR 只提交**提案**，不实施；实施前须再走一轮对抗评审（见「遗留 L1」） |
| 远程同步 | 由门禁推导 | 本记录按 2026-10-17 起的现行形态书写：状态列不手写状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导，**不开回填 PR** |

## 提案要点

**要解决的问题**：`compute-key-envelope-migration` 第 3 组的信封表外键指向 `official_keys(id)`，
而该表在 ops-center 的 SQLite 里 ⇒ **FK 建不出来** ⇒ 现在落那个迁移文件会在部署时
`relation "official_keys" does not exist` ⇒ `assertReady` 硬失败 ⇒
`MEMBERSHIP_UNAVAILABLE` ⇒ **会员中心整体降级**。

**解法（解耦，不合并两件事）**：

```
① official-keys-postgres-migration（本提案）—— 纯搬家
   表 + 数据 + 双库连接管理 + 双写→切读→停写。Fernet 密文原样 COPY，不重加密。
        ↓
② compute-key-envelope-migration 第 3/4/5 组
   建信封表 + 存量重加密 + 跨语言对拍
        ↓
③ 服务端代理用 Node 侧信封模块解开官方 Key（F3 死结闭合）
```

**顺序不可反**：信封表带 FK ⇒ `official_keys` 必须先在 Postgres。

## 三处关键取舍（proposal + design 已展开）

| # | 取舍 | 理由 |
|---|---|---|
| D1 | 只搬 `official_keys`，ops-center 保持双库 | 其余配置表不需要跨库事务，整体迁会放大爆炸半径；不建 key-broker HTTP 服务（那会把原子性永久降级为最终一致） |
| D3 | Fernet 密文原样 COPY，**不做重加密** | 重加密是信封 change 的职责；两处都改同一批数据，混在一起出问题无法归因 |
| D6 | 切换期 **fail-closed**，不回落 SQLite | 回落会让已被熔断的 Key 重新被选中 ⇒ 真实上游调用 + 真实支出。**熔断的即时性优先于可用性** |

## 遗留（不假装已闭合）

- **L1 · 本提案尚未过对抗评审** —— CCG 双模型评审在本环境无法执行（引擎 `ccg-deep-review.js`
  全盘不存在，后端 `claude` / `opencode` / `codex` / `codeagent-wrapper` 四者全不可用）。
  本 PR 只提交提案、**不实施**；**动手前必须再走一轮对抗评审**，评审结论按
  `compute-key-envelope-migration` 的先例折进 `tasks.md` 与 `review-responses.md`。
- **L2 · 三个 Open Question 需外部确认** —— OQ1 Postgres 访问控制清单（**需部署方确认，
  实现方不能代答**）、OQ2 驱动选型、OQ3 SQLite 侧运行时 ALTER 的处置。
- **L3 · 迁移编号尚未落定** —— 本 change 与 `compute-key-envelope-migration` 都要加迁移文件，
  编号会撞。按 2026-10-23 起生效的 AGENTS.md「迁移编号的唯一性纪律」，
  **落库前必须 `ls migrations/postgresql/` 现查**，且与信封 change 对齐分配。
  tasks 1.1 已写入该前置，**但具体号不得在本提案里写死**。
- **L4 · `model_preset_service.py:1112-1122` 的 Key 回退是死代码**（用 `preset_id` 匹配
  `OfficialKey.provider`，而 `ModelPreset` 无 `provider` 列）——本 change 只改它的 session
  来源，**不修这个逻辑缺陷**（属另一条线），tasks 8.7 已明确排除。
