---
record: ccg-probe-external-review
task: 让收敛出口探针现读 vendor 是否能表达「外部复核」，不再把旧结论写死
date: 2026-10-20
branch: ccg-probe-external-review
---

# 执行记录：探针反映 vendor 的 externalReview 表达（ccg-probe-external-review，2026-10-20）

## 0. 动因

本机给 vendor 驱动加了 `externalReviewSatisfied` + `expectedExternalBackend`（解除高危域无条件阻断）。
`scripts/ccg-convergence-probe.js` 每次 PR 都在 Gate 2b6 打印「self-play 对 crypto 项无条件计阻断 ⇒ 深度审查闭环不可达」——
补丁一生效，这句就成了**会说谎的常驻判据**。本刀只让探针现读 vendor，不改判定器的宽严。

## 1. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | `scripts/` 工具脚本（探针本体 + 其测试），不触运行时、不触 `check-pr-exec-record.js` |
| 落地方式 | 独立 worktree `mp-ccg-anchor-land`、独立分支 `ccg-probe-external-review`（起点 = 当时 origin/main），经 PR 落地 |
| 为何不并进 #3919 | 那把在重写同一判据函数；探针文件 59.3 小时无人动，独立落可零冲突 |

## 2. 实现

- 新增并导出谓词 `externalReviewCapable(driverSrc)`：**两条同时成立**才算在位 —— 解除谓词被定义为函数（注释/散文里出现字样不算）+ 驱动把期望后端写进裁决模板。
- 读数进 `--json`（`externalReviewCapable` 字段），人读档结论正文按在位与否分叉；**在位不走 `problems`**，即不得改退出码语义。
- 为什么只测纯谓词不做端到端：CI 的 changes 作业上没有 vendor 引擎（探针走失明档），端到端断言在 runner 上永远测不到 —— 收敛成可纯测的谓词才有 CI 覆盖得住的锁。

## 3. 门禁

| 门禁 | 状态 | 证据（本机在最终基线上重取） |
|---|---|---|
| TDD 红→绿 | PASS | 先只加两条锁：`tests 10 / pass 8 / fail 2`（P9、P10 指名红，其余 8 条不受影响 ⇒ 红可归因）；实现后 10/10 |
| 变异反证 | PASS | E-M1 在位判定退回恒 `false` ⇒ 只红 P9；E-M2 退回恒 `true` ⇒ 只红 P10；两条各用自己的判别输入，驱动断言 `collected>0`，红集互不相同 |
| 现场回读 | PASS | 本机 `node scripts/ccg-convergence-probe.js` rc=0，结论行改为「vendor 已能表达外部复核 ⇒ 填齐三格后可闭合为 self_play_resolved，旧结论自此次表达起失效不得沿用」 |
| 退出码档位 | PASS | 在位/不在位都不进 `problems`；0=合规、1=读数偏离、2=探针失明三档不变 |
| 行尾两口径对账 | PASS | 探针与其测试均为纯 CRLF 工作副本，逐行按原行尾回写；提交前跑 `--numstat` 与 `--ignore-cr-at-eol --numstat` 对账 |
| 旧载体冻结 | PASS | 只写本篇 `openspec/records/`，未碰 `.quality-gates.md` / ledger |
| QM-1 / QM-4 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 | 见 §4 | 变更规模由判定器判 |
| 远程同步 | 由门禁推导 | 不写状态词、不做回填提交 |

- 保留门禁：变更类型与隔离 ✅ | TDD 红→绿 ✅ | 变异反证 ✅ | 行尾对账 ✅ | 旧载体冻结 ✅ | 远程同步 PR #<本 PR 号>

## 4. QM-6

改动面是「探针读数 + 一个纯谓词」，不新增判定分支、不改闭环词表；判定由 pre-commit 的 `ccg-review-decider.js` 落产物。
若被判 dual 而落到 `self_play_blocked`（高危域无条件计阻断仍在 vendor 侧），按本仓口径转人工，不手写状态字段。

## 5. 未闭合（不假装闭合）

1. vendor 那侧的 `externalReview` 表达是**本机补丁**（原文件 sha256 `8e3d65c6…` 已记在补丁注释里），未投上游、也无重装/升级防护 —— 一次技能升级就会静默回到「不可达」，届时探针会如实报旧结论，但至少不会说谎。
2. 强度边界照旧：三格是形状 + 一致性判据，不联网核评论真伪；真绑定属上游 issue（`openspec/changes/ccg-convergence-exit/artifacts/upstream-issue-external-review-field.md`）。
3. #3919（台账双读 + 载荷锚）仍等 QM-6 三片在同一函数上收口后再重放，不在本刀范围内。
