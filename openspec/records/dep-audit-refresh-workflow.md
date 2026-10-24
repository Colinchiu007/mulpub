---
record: dep-audit-refresh-workflow
task: 给 dep-audit 加定期自动刷新 workflow（机器跑 --update，人给 decision），把「基线追公告」从人肉变成机器
date: 2026-10-24
---

## 本次执行记录：依赖漏洞基线自动刷新（dep-audit-refresh-workflow，2026-10-24）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动落在 `.github/workflows/**` 与 `scripts/**` ⇒ 属**混合 PR**（`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 判 docs-only=false，不走 docs-only 快速通道）。本片在独立克隆的工作区完成，分支 `dep-audit-refresh-workflow`，经 PR 落地，未直推 `refs/heads/main` |
| 第一性原因（QM-5 ①） | ✅ | `scripts/dep-audit-baseline.json` 这份挂账台账此前**全靠人肉记性**维持：新公告发布 → 人**记得**跑 `--update` → 人**记得**给每条补 `decision`/`note` → 人**记得**看 `reviewBy` 到期没有。漏掉任一步，审计结论静默过期；且过期形态是**指错方向**的 —— 「本轮 0 命中」被读成「已修」，于是仍有效的挂账被从安全基线里抹掉（`check-dep-audit.js` 里的 `UNVERIFIED_ZERO_SCAN` 闸就是为这个形态立的） |
| 逃逸分析（QM-5 ②） | ✅ | ①**自动刷新会覆盖人工结论**：`--update` 按 `found` 全量重写，而 `decision`/`note`/`targetVersion` 只在「底里有这条」时才被保留 ⇒ 刷新若拿主干基线当底，分支上人刚补的结论会被冲成 `TODO`（= 删掉人的风险分析）；②**主干上补的结论会被当成新公告**：分支上还没有它 ⇒ 要人重补一遍；③**换号会被误当成清账**：公告库换主 id 时旧键消失、新键出现，若不分档就会把「同一条公告改名」说成「一条没了 + 一条新增」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`check-dep-audit.js` 新增 `mergeBaselines`（合成底 = 主干 ∪ 分支，人工字段以分支为准，`reviewBy` 只许往后走）、`buildRefreshReport`（新增/清账/换号三档分开）、`renderRefreshBody`（给人做决定的清单）；②新增 `.github/workflows/dep-audit-refresh.yml`（每天 03:17 UTC，扫描三域 → `--update` → 推常驻分支 `chore/dep-audit-refresh` → 开/更新 PR，正文即待办清单）；③**回归锁**：`scripts/check-dep-audit.test.js` 67 例全绿（新增 10 例：合成底保结论、`reviewBy` 只许往后、`--merge-from` 保住人工结论、读不到分支基线必须拒刷、`--merge-from` 误配必须被拒、报告三档分开、待补清单含「此前就没人补的」、正文三要素、空表不冒充待办） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**不覆盖**：推送是快进推送、**不带 `--force`**，且刷新底 = 主干 ∪ 分支 ⇒ 人在刷新分支上的提交永远留在历史里、结论永远不丢；②**不代劳决策**：新公告一律 `decision: "TODO"`，机器**不推进 `reviewBy`**（复核日是「人看过这批账」的证明，机器续期等于把复核变成永续挂账）；③**不绕开既有闸**：扫描器不可用 / 「0 产出但仍有挂账」时脚本自己拒写基线并判红，workflow 不加任何旁路；④**不重复造扫描域**：`ops-center/frontend` 照 `dep-audit.yml` 原样装依赖（不装则该域 0 命中，踩 `UNVERIFIED_ZERO_SCAN`）；⑤**人机分工写进产物**：PR 正文里逐条列出要填哪个字段、合法取值是什么、以及两处「看起来像挂了其实是机制」的坑（`GITHUB_TOKEN` 触发的事件不再触发工作流 ⇒ 首轮 CI 不自动跑；`main-red` 的 `rc=2` 档与 `--allow-main-red` 出口） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致（`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 同值），删除数为 0、全部是新增行；无 CRLF 混入 |
| 接线棘轮 | ✅ | ①新 workflow 声明了 `schedule` ⇒ **必须**登记进 `.github/workflows/ci-failure-handler.yml` 的 `workflows:` 名单，否则 `scripts/check-schedule-failure-watch.js` 判 `UNCOVERED`（已登记，本地实跑 `未覆盖=0 陈旧名单项=0 判定=OK`）；②新作业的 `timeout-minutes` 已登记进 `scripts/gate-timeout-registry.json`（`state: seeded` / `samples: 0` / 30 天宽限期，与 `schedule-heartbeat.yml` 那格同形），本地实跑 `check-coverage-budget.js` ⇒ `OK 全部 26 格与注册表同源…清单棘轮通过`；③新增用例写进**已接 CI 的** `scripts/check-dep-audit.test.js`（`dep-audit.yml` 的「门禁用例」步骤会跑），未新增需要另行点名的测试文件 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无 `apps/`、`packages/`、`ops-center/backend` 改动），不涉及打包与视觉 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本环境未探测到 `codeagent-wrapper` 类外部评审通道；**如实记为未执行，不以自审冒充通过**。替代验证：本地实跑 workflow 的 git/bash 全流程（见下） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### 实测证据（本片全部技术判断的依据，不是推理）

**① workflow 的 git/bash 全流程本地实跑**（建了假 origin + 假扫描器，脚本本体是真的）：

| 场景 | 期望 | 实测 |
|---|---|---|
| A 人已在刷新分支补了 decision，扫描结果不变 | 不推空提交 | `CHANGED=0` ⇒ 不推送；分支历史无新增提交；分支上那条的 `decision=accepted-risk` 原样在 |
| B 扫描多出一条新公告 | 在**人的提交之上**再叠一层 | 新提交是 `人补 decision` 的**子提交**；`GHSA-new` 落成 `decision=TODO`；`GHSA-x` 的人工结论未被冲掉 |
| C 主干上有人补了结论、刷新分支上没有 | 不得要求人重补一遍 | 刷新报告 `needDecision: []`、`added: []` —— 主干那条的结论被合成底认领，**没被当成新公告** |
| D 分支基线读不到 | 拒刷 | `MERGE_BASELINE_UNREADABLE` ⇒ rc=1，基线**一字节不变**（拿主干当底硬刷会把人刚补的结论冲成 `TODO`） |

**② 门禁本地实跑**（改动后）：

```
node --test scripts/check-dep-audit.test.js                 → 67/67 绿
node --test .github/scripts/workflow-contract.test.js       → 46/46 绿
node --test scripts/check-schedule-heartbeat.test.js        → 16/16 绿
node --test scripts/check-schedule-failure-watch.test.js   → 13/13 绿
node --test scripts/check-coverage-budget.test.js           → 26/26 绿
node scripts/check-schedule-failure-watch.js                → 未覆盖=0 陈旧名单项=0 判定=OK
node scripts/check-coverage-budget.js                       → OK 全部 26 格…清单棘轮通过
```

**③ 新 workflow 的形状**：cron `17 3 * * *`（每天 03:17 UTC，刻意避开整点拥堵）；权限 `contents: write` + `pull-requests: write`（只给「推分支 + 开 PR」两件事）；`concurrency` 串行不取消（并发两轮会在同一条分支上互相踩）。

### 一处必须说清的既有事实（不是本片引入，但本片依赖它）

`依赖漏洞审计` **不在仓库的 required checks 名单里**（名单只有 QG Static / QG Unit Tests / electron-tests / 文档同步检查 / 债务熔断检查 / 单元测试+Lint / GUI Gate Result）。
⇒ 「不补 decision 就不许合」目前是**纪律**（本仓合并纪律：门禁未绿不合并），不是 GitHub 层面拦得住的**硬闸**。
本片**没有**改分支保护规则 —— 按 AGENTS.md，「改谁来守门」归人工拍板。这件事写进了刷新 PR 的正文里，
让读 PR 的人看见「这条门禁的分量」，而不是以为它拦得住。

### 遗留（不假装已闭合）

- `依赖漏洞审计` 不在 required checks ⇒ 决策门禁仍靠人自觉。要变成硬闸需改分支保护规则，待人工决定。
- 新作业的超时登记是 `state: seeded` / `samples: 0` ⇒ 30 天宽限期内必须用 `scripts/gate-timeout-sample.js` 重采并如实升级为 `measured`。
- 刷新 PR 首轮不自动跑 CI（`GITHUB_TOKEN` 触发的事件不再触发工作流）⇒ 人推第一次 decision 改动后 CI 才起来。已写进 PR 正文，但**首轮体验仍需人知道**。

## CHANGELOG 条目

# feat(deps): 依赖漏洞基线改为机器定期刷新，人只给风险结论（dep-audit-refresh-workflow）

- **「基线追公告」从此不再靠人记性**：新增定时作业（每天 03:17 UTC）在真联网环境扫完 `npm` / `npm-opscenter` / `pip` 三域，自动执行 `--update` 刷新 `scripts/dep-audit-baseline.json`，并把结果推到一个常驻分支上开成待审 PR。
- **机器只做能做的**：登记新公告（`decision` 留 `TODO`）、清掉已不再命中的挂账、保留已有人工结论。**风险结论仍由人给** —— 每条新公告补 `decision` + `note`（选 `upgrade-tracked` 还必须写能闭合的 `targetVersion`），不补则 `依赖漏洞审计` 门禁判红。
- **刷新不会覆盖人的结论**：刷新底取「主干基线 ∪ 刷新分支基线」，推送是快进推送且不带 `--force` ⇒ 人在刷新分支上补的结论永远留在历史里；主干上补的结论也不会被当成新公告要求重补一遍。
- **机器不推进挂账复核日** `reviewBy`（复核日是「人看过这批账」的证明，机器续期等于把复核变成永续挂账）。
- 刷新 PR 正文即待办清单：逐条列出要填哪个字段、合法取值、以及「本轮 CI 不会自动跑」「主干红要走 `--allow-main-red`」两处机制坑。
- 顺带把「公告换号」与「清账」分成两档汇报 —— 同一条公告改主 id 不再被说成「一条没了 + 一条新增」。

## learnings

### lesson: dep-refresh-keep-human-decisions（机器刷新台账时，人工结论是不可再生的那一半）

**现场**：给 `dep-audit` 加自动刷新时，第一版直接把「主干基线」当 `--update` 的底。推演一遍就出事：
刷新分支上人刚补的 `decision`/`note` 会被 `writeBaseline` 按 `found` 全量重写**冲成 `TODO`** ——
等于「自愈」顺手把风险分析删了；而人**在主干上**补的结论，因为分支上还没有，会被当成**新公告**要求重补一遍。

**根因**：`writeBaseline` 只在「底里有这条」时保留人工字段，所以「底选谁」不是实现细节，而是**谁拥有结论**的问题。
台账里可再生的部分（公告清单、严重度、修复版本）可以随时重算；不可再生的只有人的结论。

**可复用的 3 条**：

1. 任何「机器刷新 + 人工确认」的台账，**刷新底必须是「权威源 ∪ 人工源」的并集**，不是其中之一。
2. 人工字段的归属要写进代码注释与测试断言（本次用「分支优先、主干兜底、`reviewBy` 只许往后」三条口径 + 10 条用例钉住），
   否则半年后没人说得清为什么这条结论会丢。
3. **推送永不 `--force`**：快进推送 + 把人工提交留在历史里，是比任何脚本判断都可靠的一层保险 ——
   脚本判断错了还能靠 git 历史看出来，force push 覆盖掉就直接没了。
