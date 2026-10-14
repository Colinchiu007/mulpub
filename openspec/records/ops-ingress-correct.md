---
record: ops-ingress-correct
task: 更正「bootstrap 只认 X-Catalog-Key」错误结论，并沉淀本轮 4 条教训
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：更正「bootstrap 只认 X-Catalog-Key」错误结论 + 本轮 4 条教训（ops-ingress-correct，2026-10-14）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程变更（`openspec/records/` + `01-docs/learnings.md` + `.quality-gates.md` + ledger）⇒ 按 AGENTS.md 就地编辑 + PR 落地；开写前先 `git merge --ff-only origin/main` |
| 第一性原因（QM-5 ①） | PASS | 上一轮在 #3513 正文、`openspec/records/ops-menu-diag.md` 与 `01-docs/learnings.md` 里写了「bootstrap **只认 X-Catalog-Key，Bearer 不适用**，所以要手填地址 + API Key」。**错**：`routers/runtime.py::_require_catalog_key` 的实现是 `verify_bearer_or_catalog_key`，优先级 **Bearer(Logto) → X-Catalog-Key(fallback) → 401**，Bearer 分支要求 scope `publish:read`，而 `identity-public.json` 的 `logtoScopes` 正含该 scope ⇒ 零配置路径**可用且优先**。认知根因：把「否证」绑定到了「看起来可疑的东西」（27 字符私钥），没纳入「看起来权威的东西」（一句 docstring）——同轮写下规则、同轮违反 |
| 逃逸分析（QM-5 ②） | PASS | ①该错误结论**没有任何判据约束其正确性**：上轮只断言 hint「包含旧文案」，于是错误文案被锁住而非被拦住；②据此给出的**用户操作步骤**没有经过「该界面是否存在」的核实（模板命中 0、文案键非 locale 调用 0）；③「唯一可配处是已撤下界面」这一**可达性**问题在文档层完全不可见（所有材料都在描述一个不存在的入口） |
| 修复 + 回归保护（QM-5 ④） | PASS | 代码侧已在 PR #3543 修掉：错误提示文案删除 + 反向断言 `not.toContain('Bearer 不适用')` / `not.toContain('设置 → 运营中心同步')`；信任锚下沉部署层；渲染端运营面清零。本笔只做**记录更正与教训沉淀**，不改代码。#3513 的 PR 正文已追加留痕式更正块（不静默改写原文） |
| 防止再次发生（QM-5 ⑤） | PASS | ①`01-docs/learnings.md` 追加 4 条（ESM/CJS 实例分离致锁假绿；否证对象是断言而非载体；先核实界面存在再给用户步骤；判断配置可达性看写入路径调用方）；②`openspec/records/ops-menu-diag.md` 追加更正块（保留原文）；③三处记忆（内置本文件 / 外部 `learnings.jsonl` / EverOS）；④两条可迁移**命令级判据**已写成可照抄形式：`git grep -n "<文案键>" -- <渲染端>` 调用数为 0 ⇒ 无此界面；配置可达性 = 写入函数调用方数量 |
| 反证 | N/A | 纯文档追加，无代码行为可变异；代码侧反证见 #3543（3 处变异各自打红、还原全绿） |
| 编码与行尾 | PASS | 两口径 `numstat` 一致；`check-gate-record-debt` 要求的两形态（表格行 + bullet）同写 |
| QM-1 / QM-4 | N/A | 未触 `apps/desktop/electron/` 与渲染层 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PENDING | 待本 PR 合并后回填 merge SHA 并销账（回填与销账同次提交） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

### 备注

本笔记录的是**我自己的错误**，不是别人的。两处叠加：一句未经否证的技术断言，一条界面上无法执行的用户指引。
两处都不是「知识不足」，而是**核实动作缺失**——所以沉淀的每一条都写成可照抄的**命令级判据**，而不是「要更仔细」。
