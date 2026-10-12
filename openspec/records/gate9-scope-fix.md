---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
record: gate9-scope-fix
task: Gate 9 覆盖审计三缺陷修复（作用域分流 / 状态分层 / 口径统一）+ /rollout 权限缺口 + 菜单假绿断言
date: 2026-10-12
---

## 本次执行记录：Gate 9 覆盖审计缺陷修复（gate9-scope-fix，2026-10-12）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + CI 配置 + 文档：隔离 worktree `mp-gate9-scope-fix`（D 盘）+ 裸分支；pre-flight 守卫确认共享根禁改未越界；writeGuard running |
| 第一性原因（QM-5 ①） | PASS | Gate 9 的审计对象固定为 `apps/desktop/src` 与全量 PRD（357 项 vs 桌面端 1081 特征），**与本 PR 改了什么无关**；PRD 条目无状态标注，规划中/不做/历史类被计入覆盖率分母稀释成存量欠账；LLM 空输出走静默放行。三重缺陷叠加 → 只改 ops-center 的 feat PR 被判 0.31 分拦合并（#3413 实测，#3409 连挂 4 次） |
| 逃逸分析（QM-5 ②） | PASS | 判据以 PowerShell 字面量抄在 workflow 内 ⇒ 无单测、无回归锁；`agent-review-gate.js` 对空 verdict 返回 exit 0 的兜底从未被质疑（"绿"从未被验证过是"审过了"）；`menu-visibility.test.js` 的「6 个 adminOnly」断言写死个数且清单只列 5 个（实际 9 个），属"纸条自检"式假绿；`/rollout` 两道锁只上一道从未有测试断言 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① `scripts/gate9-classify.js`（11 例）：按变更落点分流 srcDir/docPaths；② `scripts/gate9-prd-status.js`（7 例）：四类状态标注 + 优先级 + shouldAudit；③ `multi-doc-parser._annotateItems` + `requirements-runner` 分层（2 例集成锁，含「规划项不得进 LLM prompt」）；④ workflow 接线 + verdict 探针；⑤ `/rollout` 路由补 adminOnly + 回归锁；⑥ menu-visibility 假绿断言改为从单一事实源推导 + 逐项点名。零回归：ai-autonomous-tester 全量 183 passed、ops-center 前端 88 passed |
| 防止再次发生（QM-5 ⑤） | PASS | 判据全部提取为 Node 模块（可单测、workflow 与本地共享），workflow 只做调用不再抄字面量；PRD 新增「附：PRD 需求条目状态标注约定」完整写判据/写法/分层规则/审计对象选择表/未执行可见性；AGENTS.md 与 learnings 同步 |
| 行尾与 diff 对账 | PASS | 变更 9 文件（A=5 M=4 D=0）；新文件均为 LF/CRLF 与仓库既有约定一致 |
| 接线棘轮 | PASS | 新增 `scripts/gate9-classify.test.js`、`scripts/gate9-prd-status.test.js` 在 `scripts/` 下（node --test 直接覆盖）；`packages/ai-autonomous-tester/test/gate9-status-tiering.test.js` 在该包 `npm test`（`tests/*.test.js`）覆盖内，已实测 183 passed |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron`、`packages/rpa-engine`；前端仅改路由 meta 与测试，无视觉面变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | PR #3439 已 squash 合并：merge SHA `52aeaf2aef098883e1807baa4673ff4528b6f799`（2026-10-13T02:49:32+08:00）；`git ls-remote --heads origin gate9-scope-fix` 返回 0 行，远端分支已删 |

### 实现要点（值得留存的判断）

**1. 判据必须可单测，不能抄在 workflow 里。** 原有 PowerShell 字面量无法被任何测试覆盖，本次提取为 `scripts/gate9-classify.js` 与 `scripts/gate9-prd-status.js`，workflow 改为调用（先写 `gate9-input.json` 再 `node -e` 消费）。两模块均带反证用例（改宽判据立刻红）。

**2. 分层不能只改分母，必须让被排除项显式可见。** 若只把 planned/wont-do/historical 从分母剔除，报告里覆盖率会凭空上升，读者无法区分「实现变多了」与「分母变小」。因此 runner 同时输出 `excludedDetails`（含原标注与理由）、`auditedCount`、`totalPrdFeatures`（审计后）与 `totalPrdFeaturesRaw`（原始）。

**3. facts.prdItems 必须传分层后的子集。** 这是实现里最容易错的一步：若给 LLM 的仍是全量，`excludedItems` 会被重新计入 LLM 的覆盖率输出，分层白做。已用集成测试锁死（断言「播客托管」不出现在 prompt 里）。

**4. 默认参数绑定常量是 Python 侧同型坑的 JS 版。** `hash_password(iterations=PBKDF2_ITERATIONS)` 那类坑在本次以另一种形式出现：判据若在 workflow 里写字面量，本地复现与 CI 就会漂移。两处都按「函数体内读取 / 模块单一真源」处理。

### 遗留（不假装已闭合）

- **PRD 357 项的状态标注尚未回填**：本次只建立了标注约定与判据，未逐条给既有 PRD 条目补标注（工作量 357 项，需按章节分批）。在回填完成前，分层只对**新写的**带标注条目生效，存量规划项仍会进分母 —— 覆盖率数字仍偏低，但不再影响只改 ops-center 的 PR（作用域分流已挡住）。
- **LLM 判分的随机性未消除**：空输出/两次结论相反（0.31 FAIL → NEED_HUMAN）的根因是 LLM 本身不稳定。本次只做到「未实际审计时可见」（verdict 探针 + Gate Result 打印），未做到「判定可复现」。彻底解决需要换确定性判据（如按 testid/路由做结构匹配），属另一专项。
- **`/rollout` 补锁的影响面**：此前非 admin 可地址栏直达生效看板。补锁后若实际有非 admin 用户在用该页面，会遇到跳首页。**待你确认**是否有此使用场景。
- **改密未接入审计日志**（上一任务遗留，仍未做）：凭据变更未记录到 `AuditLog`。
