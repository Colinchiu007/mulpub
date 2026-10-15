---
record: tech-debt-dep-audit-alias
task: 登记依赖审计门禁「按 vuln.id 单键匹配、不认 aliases」欠账；并校正 CHANGELOG 中与 fix-newtab-home-slow 最终代码不符的三处描述
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由后续回填 PR 同一次提交改写为 PASS + merge SHA 并删除本段三字段
sync_backfill_owner: 下一个会话
---

## 本次执行记录：依赖审计门禁 aliases 欠账登记 + CHANGELOG 三处描述校正（tech-debt-dep-audit-alias，2026-10-16）【docs-only】

> 范围：纯文档/流程变更（`01-docs/tech-debt.md` + `CHANGELOG.md` + 本记录 + 账本登记），
> 按 AGENTS.md「分层分支策略」在共享主工作区就地编辑、经 PR 落地，不进 worktree。
> 两件事同属一轮「依赖审计阻塞恢复」的收尾，故合为一个 PR（原 #3660 已关闭并由本 PR 接管）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档：共享根就地编辑（`main`，未离开 main、未 `git checkout` 分支）+ PR 落地；`docs-only=true` |
| 第一性原因（QM-5 ①） | ✅ | ① 欠账：`scripts/check-dep-audit.js` 的 `parsePipAudit`（`:187` `const id = vuln.id \|\| vuln.name;`）只用 pip-audit 报的**主 id** 当键，丢弃 `aliases`；② CHANGELOG 三处停留在中间态，与 `fix-newtab-home-slow`（#3631）的最终代码不符 |
| 逃逸分析（QM-5 ②） | ✅ | 别名盲区从未被覆盖：现有用例的夹具都用**单一 id**，没有「同一公告换号（主 id 变、旧 id 进 aliases）」的样本 ⇒ 门禁在自己的测试里永远不会遇到这个形状。CHANGELOG 错字逃逸同理：它只被人工复查发现，无任何机械判据核对文档与代码/基线的一致性 |
| 修复 + 回归保护（QM-5 ④） | N/A（本轮只登记） | 欠账修法写在 `01-docs/tech-debt.md` 条目内：`parsePipAudit` 收集 `vuln.aliases`、匹配时主键或任一 alias 命中即同一条、报「key 迁移」而非 NEW+RESOLVED 双报；回归锁 = 造「同公告换号」的 pip-audit JSON 夹具断言**不**报 NEW/RESOLVED。**未实现，属另立项**（改 `scripts/` 为混合 PR，需完整节拍） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 欠账条目写明**不可放宽的边界**（别名合并只影响「是否已在账上」，`decision`/`note`/`reviewBy` 与 `VALID_DECISIONS`、`patched` 校验一律不动），防止后人把该修复当成放宽门禁的借口；② 条目内附**排除性观察**：本轮「本地绿 / CI 红」已查实是本地工作区带了另一会话**已暂存未提交**的基线修复（跑门禁前的快照 `node -e` 读出的键即 `PYSEC-2026-4298`），**不是门禁抖动** —— 写进条目以防后人据此误改判据 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐值相同；`tech-debt.md` 纯追加（`2 0`，CRLF 未混），`CHANGELOG.md` 为等行替换 |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 变更集不含 `apps/desktop/electron/**`、`packages/rpa-engine/**`、`.vue/.css` 与基线 PNG |
| QM-6 CCG 双模型外部评审 | N/A | docs-only 通道按 `CI_IGNORED_PATHS` 短路 QM-6；pre-commit 的 CCG 判定亦判「改动全部命中文档白名单 ⇒ 走 §11.2b docs-only 快通道」 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin tech-debt-dep-audit-alias` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 本轮实际改了什么

**1. 登记欠账：`01-docs/tech-debt.md`（2026-10-16 条）**

登记「依赖审计门禁按 `vuln.id` 单键匹配、不认公告 aliases」。实测现场：

- `pip-audit` 对 `python-jose 3.5.0` 报 `id=PYSEC-2026-4298`、`aliases=["CVE-2026-85394","GHSA-3qf3-8w2g-rqmx"]`、`fix_versions=[]`
- 基线当时以 `CVE-2026-85394` 为键 ⇒ 门禁同时打出 `NEW_ADVISORY: pip/PYSEC-2026-4298` 与 `RESOLVED_STILL_BASELINED: pip/CVE-2026-85394`
- **而安全结论一个字都没变**（原判 `not-exploitable`）

三点危害已在条目里写明：假红诱导「再登记一条」⇒ 同一公告留两份；反复换号刷红会**训练人忽略这条门禁**；续判只能人肉翻 aliases。

**2. 校正 CHANGELOG 三处（`fix-newtab-home-slow` 合并后复查发现）**

| # | 原文 | 改为 | 依据 |
|---|---|---|---|
| 1 | 「3 个共享底座（`el-var`/`el-reset`/`base`）」 | 「2 个共享底座（`el-var` + `base`）」+ ⚠️ 为何**刻意不含** `el-reset.css` | 该修复的核心动作之一就是**移除** `el-reset.css`；原文与结论、与 `AGENTS.md` QM-2 条目、与实际代码互相矛盾 |
| 2 | 「回归锁 **19** 条」（正文列 7+6+4=17，标题与正文本身不自洽） | 「回归锁 **18** 条」+ 补 P7 指令装配锁 | 实测 `main.bundle-contract.test.js` 7 + `element-plus.test.js` **7** + `Home.first-paint.test.js` 4 = **18** |
| 3 | P6 只写「显式禁止 `el-reset`（只断言"不含 el-reset"是弱锁）」 | 补「该锁初版被 QM-6 评审判 Critical 后已重做」+ 三项重做内容 + 决定性变异反证 | 原文读起来像「通用判据已挡住」，事实是初版通用判据对它**一次都没生效**（`el-reset.css` 以元素选择器开头，而初版只认 `.el-` class） |

第 3 条尤其重要：不写清楚会让人误信「通用锁在跑」。同时在条目里**如实登记「本行初稿曾写作 3 个，与最终代码不符，已更正」**，不静默改掉。

### 遗留（不假装已闭合）

- **欠账本体未修**：`parsePipAudit` 的别名盲区仍在，公告库下次换号还会复现同样的「一增一失」双报。修它属混合 PR（改 `scripts/`），需另立项走完整节拍。
- **公告本身的续判结论仍依赖人工**：本轮 `python-jose` 的 `not-exploitable` 依据是三条 `algorithms` 显式限定（`middleware/auth.py:37`、`services/logto_verifier.py:95`、`config.py:52` 的 `Literal["HS256"]`）。**复核条件**：任一 jwt 验签点去掉 `algorithms` 参数，或该 `Literal` 放宽为多算法，本结论即失效 —— 该复核条件写在基线条目 note 里，但**没有机械判据**在盯它。
- 条目内登记的修法**未做**，条目的「待排期」状态即代表这一点，不要在回填时改成「已偿还」。
