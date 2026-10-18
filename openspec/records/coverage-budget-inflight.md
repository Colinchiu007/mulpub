---
record: coverage-budget-inflight
task: QG Coverage 预算 60→65（复测重定数）+ 采样器分离「在飞作业」与「漏样」，并把退出码判断抽成可行为断言的 refusalCode
date: 2026-10-19
---

## 本次执行记录：预算重定数 + 采样器在飞/漏样分离（coverage-budget-inflight，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动集 5 个文件：`scripts/coverage-budget-sample.js`（M）、`scripts/check-coverage-budget.test.js`（M）、`scripts/lib/coverage-budget-provenance.js`（M）、`.github/workflows/quality-gate.yml`（M，仅 `timeout-minutes` 那格与注释）、`01-docs/PRD-COVERAGE-TIMEOUT-PROVENANCE-2026-10-18.md`（M）、`CHANGELOG.md`（M）。含 CI 变更 ⇒ **不走 docs-only 通道**。隔离 worktree `mp-worktrees/mp-coverage-budget-refresh`，裸分支 `coverage-budget-refresh`，基线 `origin/main@bd73e4d53`；共享根全程留在 `main` |
| 第一性原因（QM-5 ①） | ✅ | 两个独立成因。①**预算不足**：60 是 2026-10-18 由 `ceil(39.7 × 1.5)` 定的，而真实耗时已涨到 max 43.3 / p90 41.4 ⇒ `ceil(43.3×1.5)=65 > 60`；没红只因真源里仍记旧窗口 39.7。②**采样器缺陷**：`collect()` 对无 `completed_at` 的作业一律写 `min:null`，`summarize()` 把「在飞（queued/in_progress）」与「已完成却无时长」混成同一格 `noDuration`，`main()` 据此 `rc=2` 拒绝 ⇒ **只要仓库有 CI 在跑就永远调不了预算** |
| 逃逸分析（QM-5 ②） | ✅ | ①**单元层**：采样器此前只有「零样本」「漏样必须被数出来」两条锁，**没有一条区分「在飞」**——因为写它时夹具里的行都不带 `status`，`status` 这一维在数据层根本不存在；②**判据层**：`check-coverage-budget.js` 只校验 `timeout ≥ ceil(floor×1.5)` 与样本量，`floor` 取自**真源里抄的数字**，真源不刷新则判据永远拿旧窗口自证（自证闭环）；③**执行层**：调预算必须跑复测，而复测连续三次 `rc=2` —— 工具拒绝工作这件事本身不会变红，只会在人手里看到"调不了"，于是**预算被冻结在过期读数上**。这正是本次的真实现场：`#3902` 立的机制没坏，但它的**采集入口已失效一周**而无人察觉 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修：`collect()` 记 `status`；`summarize()` 增 `inFlight`、`noDuration` 只数已完成；退出码抽 `refusalCode(sum, probeErrors)` 纯函数。数据：窗口 60→120（success 16→53，跨过 `MIN_SAMPLES=20`），`timeout 60→65`。回归保护：锁 14（在飞不算漏样）/ 15（已完成无时长仍阻断，双向对偶）/ 16（接线 + `refusalCode` 五档行为断言），见下表变异反证 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①决策抽成纯函数后，「阻断被架空」不再可能逃过测试（M3 的教训固化进锁 16 注释）；②汇总行强制打印 `in_flight=`，把"剔除了多少"暴露出来；③PRD 第 8 节写入**四步操作手册**（复测 → 逐字更新 PROVENANCE → 两处同值改 timeout → 对账），把"复测入口失效"这类故障的处理步骤前置；④`remeasureCommand` 随窗口同步改成 `--limit=120`，下一个人不会照旧值缩窗 |
| 行尾与 diff 对账 | ✅ | 见下方「行尾两口径」：全变更集两口径逐文件相等，删除数归因逐条写在同段 |
| 接线棘轮 | ✅ | 未新增 `*.test.js`（沿用已接线的 `scripts/check-coverage-budget.test.js`，`quality-gate.yml` Gate 2b7 的 `node scripts/check-coverage-budget.js` + `node --test …test.js` 两行早已在位）；`node scripts/check-unwired-tests.js` 读数见下 |
| QM-1 打包 / QM-4 视觉 | N/A | 改动集零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`、零 UI/样式 ⇒ 打包与像素门禁**不适用**（不是「跑了通过」） |
| QM-6 CCG 双模型外部评审 | 见下行 | 变更行数若低于判定器阈值则 `mode≠dual`，无需深度审查；实测判定记录与结论见「QM-6」段 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并前本篇还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红（change: `ban-record-closure-backfill-pr`）。main push 回读证据写在 PR 评论里 |

### 复测读数（改数的依据，可重跑）

```
node scripts/coverage-budget-sample.js --limit=120
runs_listed=120  有该作业=118  按设计跳过=25  活跃=93
in_flight=9  取不到时长=0  有时长=84  无该作业=2  probe_errors=0  ceiling=60
samples=53  max=43.3  p90=41.4  censoredAtCeiling=0  collectedAt=2026-10-18
rc=0
```

对账：`[COVERAGE-BUDGET] job=QG Coverage timeout=65 需≥65 余量=0 分 floor=43.3 samples=53 max=43.3 p90=41.4 censored_at_ceiling=0(绑 60 分那条天花板，非当前值) collected=2026-10-18 age_days=0 ⇒ OK`

### 变异反证（5 道，含一次 NOT_CAUGHT 的如实留痕）

驱动：把变异写进真文件 → 先断言「锚点命中 + 已落盘」→ 跑锁套件 → 按字节还原并核 sha256 相等。

| 变异 | 内容 | 结果 |
|---|---|---|
| M1 | 复原旧口径（在飞也计入漏样） | ✅ 锁 14 / 15 红 |
| M2 | `collect()` 不再记 `status` | ✅ 锁 16 红 |
| M3 | 架空阻断 `if (false && sum.noDuration > 0)` | ⚠️ **NOT_CAUGHT**（首轮） |
| M3' | 同上，改打在 `refusalCode` 上 | ✅ 锁 16 红 |
| M4 | `refusalCode` 把在飞也判阻断 | ✅ 锁 16 红 |
| M5 | `probe_errors` 不再阻断 | ✅ 锁 16 红 |

**M3 NOT_CAUGHT 是本片最有价值的读数**：锁 16 原先是正则结构断言，`if (false && …)` 照样匹配 ⇒
「结构锁看不出条件被短路」。处置不是补更花哨的正则，而是把决策抽成纯函数、改成行为断言。这条已写进
`coverage-budget-sample.js` 的 `refusalCode` 注释与 PRD §8.5，避免下一个人再走一遍。

### 遗留（不假装已闭合）

- **`余量=0`**：65 恰为 `ceil(43.3×1.5)` 规则下界，与上一代 60 = `ceil(39.7×1.5)` 同风格。未取整数富余，
  因为抬高会直接拉长 PR 侧排队；若下一轮 max 再涨，应由复测重新定数而不是在此预留。
- **65 这条天花板还没有任何数据**：本窗口 `censoredAtCeiling=0`，即没有一趟在 65 下被测到被杀的边界。
  「65 够不够」目前仍只有 ×1.5 规则一个依据 —— 与上一代 60 合并时的处境相同，只能靠下一轮复测回答。
- **耗时仍在涨**（窗口内 max 39.7 → 43.3）。HUGGING 警报线是 `max ≥ 0.9 × timeout`（65 下为 58.5），
  离当前读数还有距离，但**它需要有人去看那条读数**才生效。
- **其余 9 个 `timeout-minutes` 字面量仍是无对账的裸常量**（5 / 15 / 20 / 55）。本片只治理「已被现场证明
  丢过证据」的那一格，扩大治理面要逐作业采集，按「先修有证据的」排序留作后续。
- **合并后需要一次 main push 回读**：`timeout-minutes` 改动会改变该 job 在天花板下的行为，
  必须在「(merge SHA, quality-gate.yml)」这一格上有 push run 且 `conclusion=success` 才算收工（按收尾第 6 条）。
