---
record: p3-1-verify-onboarding
task: P3-1 扩平台标准动作自检脚本（11 步 + 2 条额外判据，一条命令跑完，不存在的 slug 非零退出）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：P3-1 扩平台标准动作自检脚本（p3-1-verify-onboarding，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`（files=8）**
  —— 含 `scripts/` ⇒ 按**混合 PR** 走完整质量节拍。
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
- **QM-1 不触发**：变更路径只有 `scripts/verify-platform-onboarding.js`、
  `scripts/verify-platform-onboarding.test.js`、`.gitignore` ——
  **不碰 `apps/desktop/electron/` 或 `packages/rpa-engine/`**，无运行时代码改动，故无需本地打包。

| 门禁 | 状态 | Fresh 证据 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 隔离 worktree `mp-reuse-p03`，裸分支 `p3-1-verify-onboarding` |
| QM-1 打包 | N/A | 无 `apps/desktop/electron/` / `packages/rpa-engine/` 改动 |
| ESLint（与 Gate 11 同口径） | ✅ | `cd apps/desktop && pnpm exec eslint electron/ src/ --quiet` ⇒ exit=0 |
| 单元/脚本测试 | ✅ | `node --test scripts/verify-platform-onboarding.test.js` ⇒ **10 pass / 0 fail** |
| 行尾对账 | ✅ | 三文件 `--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 品牌残留 | ✅ | 全文写「参考产品」，无竞品品牌名 |
| 文档同步 | ✅ | 本记录 + PR 描述 |
| 远程同步 | PENDING | 本 PR 未合并 |

| 项 | 值 |
| --- | --- |
| 远程同步 | PENDING |

## 做了什么

把设计文 §9.3 的 11 步判据做成**一条命令**：`node scripts/verify-platform-onboarding.js <slug>`，
逐条输出 PASS/FAIL，对不存在的 slug **非零退出**（不静默通过）。

额外两条（AGENTS.md 硬规定，不在 11 步里）：

- ⑫ 正文链**不含**自写的 `<p>` 包装 / HTML 剥离（源码扫描，**只看代码行**，跳过注释）
- ⑬ **顺序不变量**：话题转换先于 `<p>` 包装（反序会让 `(^|\s)#话题` 停在单井号形态）

## ★ 路径先核实：PLAN 那行的三个路径都不存在

| PLAN 写的 | 实际 |
| --- | --- |
| `apps/desktop/electron/services/platform-definitions.js` | `packages/shared-utils/src/platform-definitions.js` |
| `config/publish-capabilities.json` | `packages/shared-utils/src/publish-capabilities.json` |
| `apps/desktop/electron/services/platform-entries.js` | `packages/api-publish-engine/src/platform-entries.js` |

**照 PLAN 那行写会 11 步全 FAIL。** 正解在设计文 §9.3 的表格里（该表标注「已核实存在」）。

## ★ 修掉自己两处过严判据

过严的门禁会**逼人不信它**，比没有门禁更坏。两处都是「同型不同因」：

1. **步骤 10**「适配器含 `formatArticleBody`」对 `baijiahao` 误报 ——
   适配器只 `require` + 委派，`formatArticleBody` 由**链**（`baijiahao-article.js` L19/L152）调用。
   语义是「该平台的**内容路径最终到达** formatArticleBody」⇒ **any 不是 all**。
   ⚠️ 中间还写错过一次：把链加进候选却**仍要求每个候选都含**，同样误报。
2. **步骤 11** 要求 locales 含 slug 字面量 —— 本仓 `locales/zh.js` 里**没有任何平台 slug**
   （平台显示名来自 `platforms.yaml` / `platform-definitions.js`，不在 i18n 面）。
   改为只做「**若已出现在任一 locale，则两个 locale 都必须有**」的一致性判据 ——
   这才是 locale 成对纪律的真实作用面。

## 验收判据

| # | 判据 | 结果 |
| --- | --- | --- |
| ① | 对已有平台 `baijiahao` 跑 ⇒ 全 PASS | **13/13 PASS，exit=0** |
| ② | 对不存在的 slug 跑 ⇒ 退出码非 0 且逐条报 FAIL | **9 FAIL，exit=1**，且打印「config/platforms.yaml 里没有」 |
| ③ | 脚本自身有测试，含反证 | `scripts/verify-platform-onboarding.test.js` ⇒ **10 pass / 0 fail** |
| 额外 | slug 形态非法（`../etc` / `A-B` / `a b` / `a/b`）⇒ exit=2 | ✅ 防路径注入 |

**③ 的反证设计**：不存在的 slug 应让**多数**判据 FAIL，但**全局不变量 12/13 不应 FAIL** ——
这恰好证明判据「**逐条独立**」，而不是被某个汇总开关一起翻。

## 观察（未下结论）

`toutiao` 报 3 处 FAIL：`has_api:true` 但无 `publish/platforms/toutiao-*.js`；
适配器/链未含 `formatArticleBody`；无 chain 测试。

**尚未判定是真缺陷还是判据仍过严，故不在本次下结论。**
（按本仓「同一字段在两种情形下取同一个值 ⇒ 它区分不了」的纪律，需要独立取证。）

## 踩到自己的纪律（如实登记）

`.gitignore:106` 的 `scripts/*.js` 把新脚本吞了 —— 我在 `learnings.md` 里**写过**这条
（需 `!scripts/xxx.js` 白名单），**第一次提交仍踩到**。与「写进文档 ≠ 会执行」同型，
故本次同时加了白名单两行（`!scripts/verify-platform-onboarding.js` 与 `.test.js`）。
