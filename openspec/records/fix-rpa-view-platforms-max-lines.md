---
record: fix-rpa-view-platforms-max-lines
task: 代还 main 的行数债——rpa-view-platforms.js 被点名还账（目标 1484、容差 0），#4276 加 14 行后越界，令债务熔断检查在所有后续 PR 转红
date: 2026-10-23
branch: film-production-identity-followup
---

## 本次执行记录：代还 rpa-view-platforms.js 点名还账（fix-rpa-view-platforms-max-lines，2026-10-23）

> 载体：`openspec/records/fix-rpa-view-platforms-max-lines.md`；随 PR #4320 一同落地。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 代码变更（1 源文件拆分 + 1 新模块 + 1 测试基线）。本块随 `film-production-identity-followup` 分支经 PR 落地，未直推 main。（先曾另开独立分支 `fix-rpa-view-platforms-max-lines` 建 PR #4330，发现与 #4329/#4331/#4332 重复后**已自行关闭并删除远端分支**，同一 commit 改由 #4320 携带） |
| 第一性原因（QM-5 ①） | PASS | **这不是本 PR 引入的红，是 main 级的欠账**。`.github/scripts/max-lines-baseline.json` 把 `apps/desktop/electron/services/rpa-view-platforms.js` 列入 **targets = 1484（容差 0，「谁被点名谁从今天起一行都不能再涨」）**；`f84e1f79f fix(toutiao): click add-video before upload (#4276)` 给该文件加了 14 行 ⇒ 1496 > 1484 ⇒ **债务熔断检查在所有后续 PR 上转红**（含与该改动完全无关的 PR）。基线证据：main 最近两个已合并提交（#4310 / #4296）的同一 job 均 FAILURE，且**只有**这一道红 |
| 逃逸分析（QM-5 ②） | PASS | 见下「逃逸分析」 |
| 修复 + 回归保护（QM-5 ④） | PASS | **纯搬移、零行为变化**：三个函数（`readVisibleEditorToast` / `summarizePublishDiagnostics` / `parsePublishResponseEvidence`，连续 33 行）此前是 **mixin 私有、未导出**（`wechat-mp-draft-mediaid.test.js:163` 注释明说「未导出（mixin 私有），改走 mixin 出口验证」）⇒ 无任何外部调用点受影响。抽出到 `rpa-view-publish-diagnostics.js`（沿用该文件既有的拆分范式：前两次为 `rpa-publish-id-extract.js` / `rpa-view-navigation-helpers.js`）。**1496 → 1466 行**（目标 ≤1483，净减 30 行） |
| 防止再次发生（QM-5 ⑤） | PASS | ① 拆分沿用该文件**已两次使用**的既定范式（注释即写明「行数门禁」驱动），非新发明；② 依赖全部来自既有的 `./rpa-publish-id-extract.js`，未新增任何依赖；③ targets 记录**保持不动** —— 机制的本意是「谁被点名谁从今天起一行都不能再涨」，降回目标以下后它继续以 1484 为零增长上限盯着该文件；④ 不执行 `--prune`：它的语义是「从超限挂账表（>500）摘除并立碑」，前提是降到 500 以下，对 1466 行的平台发布逻辑不适用；workflow 明写的第二条路「在 review 中说明理由后一并上调 targets」**本 PR 不走** —— 降回目标以下已让门禁转绿，无需抬高标准 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 相等 |
| 接线棘轮 | N/A | 未新增 `*.test.js` 文件 |
| QM-1 打包 | PASS | 运行时代码变更 ⇒ 适用，证据取自 CI `build` job |
| QM-4 视觉 | N/A（已确认非跳过） | **未触碰任何 `.vue` / `.css`**；纯 JS 模块搬移 |
| QM-6 CCG 双模型外部评审 | **未执行（环境不具备）** | 本仓 REST API 对当前 token 全 404（git 通 ≠ API 通），`claude` / `opencode` / `codeagent-wrapper` 三后端均不可用；本仓无独立评审环境。如实记录 |
| 远程同步 | 由门禁推导 | 合并后由门禁按主干历史推导，不手工回填 |

## 终态：与并行 PR 的实际落点（合并后回填）

合并后 main 的真实状态是**混合解**，不是本记录上表所写的「targets 保持 1484」：

| 项 | 值 | 来源 |
|---|---|---|
| `rpa-view-platforms.js` 实际行数 | **1466** | 本 PR 的纯搬移 |
| `max-lines-baseline.json` 的 targets | **1497** | #4329（`98558636e`）**先于本 PR 合并** |
| 实际余量（targets − 实际行数） | **31 行** | — |

对照三种落点的余量：

| 落点 | 余量 | 评价 |
|---|---|---|
| 只上调节（#4329 单独生效） | 1497 − 1496 = **1 行** | 极脆 —— 下一次功能增长立刻再红 |
| 只降行数（本 PR 单独生效） | 1484 − 1466 = **18 行** | 够用，但目标值仍卡在旧锚点 |
| **两者叠加（实际落点）** | 1497 − 1466 = **31 行** | **余量最大**，且文件被拆得更干净、零行为变化 |

⇒ **实际落点是三者中余量最大的**，这一点符合预期。

**但要如实记一笔偏差**：本记录上表写的是「targets 记录保持不动……建议不要上调」——
该建议**未被采纳**：#4329 在本 PR 合并**之前**就已把目标上调到 1497。
本 PR **没有**改动 `max-lines-baseline.json`，也**没有**在合并后单方面改回 ——
推翻一个已合并的治理决策不在本次执行的授权范围内。
若后续希望把 targets 收回 1484（文件 1466 有 18 行余量，完全支持），应另开 PR 与提出者协商。

另：**#4332 在本次回填时仍处于 OPEN**，同样走「上调 targets」路线。若它再合并，
targets 只会再被上调、不会下降；建议以本 PR 的降行数路线为准，或直接关闭以免重复消耗 CI 资源。

## 逃逸分析（QM-5 ②）

**「点名还账」机制的设计意图是让增长归责到人**（谁被点名谁零增长），但它有个副作用：
**目标值锚定在设置那一刻的行数**，因此任何让该文件增长的 PR 都会**在后续所有 PR 上触发**——
包括与该改动完全无关的 PR。

本次调查链：
1. 本 PR（`film-production-identity-followup`）的 `债务熔断检查` 红，而它**没碰**该文件
2. 换回 `origin/main` 的源文件跑同一门禁 ⇒ **同样红** ⇒ 排除本 PR
3. 查 main 最近两个已合并提交 ⇒ **同样红** ⇒ 定位到 main 级的欠账
4. `git log -S` 定位到 `f84e1f79f`（#4276）把该文件从 1482 撑到 1496 ⇒ **越过 1484 目标**

**教训**：「某道门禁红了」与「是我的改动弄红的」是两件事。
**判据**：换回 `origin/main` 的对应源文件跑同一门禁做对照 —— 本 PR 正是靠这一步避免了误改自己的代码。

## 遗留

- **本 PR 不含本仓的独立评审**（见 QM-6 行）。
- `rpa-view-platforms.js` 仍 > 500 行，**仍在超限挂账表里**（`--prune` 的前提是降到 500 以下）——
  那是该文件长期的债务，不在本次范围内。
- **targets 终态与本记录上表的建议不一致**：实际是 1497 而非建议的 1484，差异源于并行 PR #4329 先合。
  本 PR 未改 baseline，也未擅自改回（见「终态」节）。
