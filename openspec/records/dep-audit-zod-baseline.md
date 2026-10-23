---
record: dep-audit-zod-baseline
task: 登记 GHSA-mrhx-c7xc-m3w5（zod / CVE-2023-54404）到依赖审计基线，解全仓 PR 的「依赖漏洞审计」连红
date: 2026-10-24
---

## 本次执行记录：依赖审计基线登记 zod 公告（dep-audit-zod-baseline，2026-10-24）

> **来由**：2026-10-23 新发布的 zod 公告（`GHSA-mrhx-c7xc-m3w5`）使「依赖漏洞审计」这个 required check
> 在**全仓所有 open PR** 上同时转红 —— 该门禁**没有 paths 过滤**，每个 PR 都跑，所以「谁的改动弄红的」不成立。
> **归因纪律**：动手登记之前，先在**未做任何改动的 main** 上跑同一条判据复现同一句 `NEW_ADVISORY`；
> 是同一条红 ⇒ 这是主干级的存量债，正确出口是有人修主干，不是把当前 PR 硬合进红主干。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 门禁数据文件（混合 PR，非 docs-only） | worktree `mp-worktrees/mp-dep-audit-zod-baseline`，裸分支 `dep-audit-zod-baseline`（非 C 盘，`scripts/start-mp-task.ps1` 建立）；改动含 `scripts/` ⇒ 走完整质量节拍，不借道快速通道 |
| 第一性原因（QM-5 ①） | ✅ | 公告库侧新增 advisory，而 `scripts/dep-audit-baseline.json` 是**快照式挂账**（顶层 `reviewBy: 2026-12-31` + 既有条目）。判据口径是「现实命中 ⊆ 基线登记」：现实长大、基线没长 ⇒ 多出来的那条即 `NEW_ADVISORY`。**判据本身是对的**，缺的是登记 |
| 逃逸分析（QM-5 ②） | ✅ | 这条公告**此前从未命中过**（lockfile 一直精确锁 `zod@4.3.6`）⇒ 是库侧新增事实，不是代码退化。**没有任何 PR 内的代码改动能修好它** —— 只能由「谁先修主干」来解，这正是本 PR 存在的理由 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 基线新增 1 条：`npm/GHSA-mrhx-c7xc-m3w5` / `zod` / `high` / `patched: >=4.6.6` / `targetVersion: 4.6.6` / `decision: upgrade-tracked`。回归由判据自带的 `checkTargetEscapes` 承担（见下 §一 第 3 条：目标版本必须真的逃出修复下界） |
| 防止再次发生（QM-5 ⑤） | ⏳（部分，见「遗留」） | 条目的 `note` 写清**实测来源**（lockfile 精确锁版本 / remotion 依赖链 / 本仓触发面为何窄 / 为什么不马上修 / 动作是什么），不是抄模块名；顶层 `reviewBy` **未动**，仍是 `2026-12-31`，「到期即拦」的既有机制继续生效 |
| 行尾与 diff 对账 | ✅ | PR 自身变更集（merge-base `c276d4f1ff08` → head）两口径相等：`57 0 .ccg/reviews/411ab1ce….json` + `13 0 scripts/dep-audit-baseline.json`；`--ignore-cr-at-eol` 逐文件相等；diff 内 CR 字节数 = 0 |
| 接线棘轮 | N/A | 本 PR 不新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 只改门禁数据文件（JSON）与评审产物，未触 `apps/desktop/electron/`、未改依赖区间、未触 UI |
| QM-6 CCG 双模型外部评审 | 未执行 | 见 §二。**如实写「未执行」，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（只认 squash 尾注 `(#NNNN)`）推导归属 |

## 一、本机实测（逐条亲自跑出来的，不抄 PR 正文）

1. **公告内容**：GitHub Advisory Database 的 `GHSA-mrhx-c7xc-m3w5` = CVE-2023-54404，CWE-770（资源未限流），
   「Zod can exhaust memory while validating oversized constrained collections」。
   影响面**仅可用性**（内存耗尽 / DoS），机密性与完整性均不受影响。
2. **本仓现状（实测 lockfile，不是抄依赖名）**：`pnpm-lock.yaml` 里 **zod 只有一个版本条目** `zod@4.3.6`
   （`grep -n '^  zod@' pnpm-lock.yaml` 只命中 7432 / 14943 两行，同一个版本）⇒ **精确锁**，无 range 可抬。
   依赖链实测：`packages/remotion-composer` 的 importer 直接声明 `@remotion/media: 4.0.484`，
   而 `@remotion/media@4.0.484` 的 dependencies 里写着 `zod: 4.3.6`（同样是精确版本）；
   `zod-to-json-schema@3.25.2(zod@4.3.6)` 也精确引 `zod: 4.3.6`。
   ⇒ **刷新 lockfile 就会连带牵动 remotion-composer 的渲染/构建链**，这就是本 PR 走「登记」而不走「立刻升级」的直接原因。
3. **目标版本逃逸（判据 `checkTargetEscapes` 的口径，逐段数值比较手工复算）**：
   `targetVersion = 4.6.6` vs `patched = >=4.6.6` ⇒ got `[4,6,6]` / want `[4,6,6]`，
   前两段相等、第三段 `6 > 6` ⇒ 逐段比较 break ⇒ **通过**（4.6.6 恰好满足 `>=4.6.6`，承诺得闭得上账）。
4. **基线元数据未动**：PR 版本的顶层 `reviewBy` 仍是 `2026-12-31`（与 main 逐字节相同），
   ⇒ 不会把这条挂账的复核期限偷偷往后拖。

## 二、QM-6：为什么写「未执行」而不是「已通过」

本 PR 变更集带一条评审产物 `.ccg/reviews/411ab1cec1eb1b6634d4045725b61119620cfa22d8d72e4665cd944fd3a780ea.json`，
实测其内容为：`mode: "single"`、`deepReview: { required: true, status: "pending", tier: "unknown", performedBy: null, evidence: null, findings: null }`、
`decidedBy: "ccg-review-decider"`、`decidedAt: 2026-10-23T21:38:36Z`。

- `mode` 是 `single`（§12.6 常规专家分派）而不是 `dual`（双模型深度审查）。
  按 `scripts/check-pr-exec-record.js` 的**缺陷 G 口径**（`rec.mode !== 'dual' ⇒ continue`），
  `single` **不在深度审查欠账的判定域内** —— 这不是放水，是判据自己写明的取舍：
  「引擎对 mode != skip 一律置 required=true，那是『是否需要评审』，不是『是否需要**双模型深度**评审』」；
  若对 `single` 也要求闭环，就会形成「写完审查再提交、提交又生成新 single 记录」的**无法闭合的循环**。
- 但**事实是：双模型深度评审确未执行**（`status` 停在 `pending`、`performedBy`/`evidence`/`findings` 全为 null）。
  ⇒ 本行按模板要求如实写「未执行」，**不把 `required: true` 读成「已评审」**，也不以自审冒充通过。
- 本 PR 的改动面（一份门禁数据 JSON）不属高危面；即便按「非高危面写结构化 closureNote」那条出口，
  也不该在**评审根本没跑成**的时候把 `status` 手写成闭环值 —— 那正是 `closureNote` 机制要防的形态。

## 三、遗留（不假装已闭合）

- **本 PR 只登记、不升级**：`decision: upgrade-tracked` 的实际动作是「刷新 lockfile 把 zod 升到 >=4.6.6」，
  **这次一次都没做**。含义要写清楚：**这条漏洞在 main 上此刻仍然真实存在**，只是被登记为已知并挂账到
  `reviewBy: 2026-12-31`。升级需要连带回归 remotion-composer 的渲染/构建链，单独排期。
- **本机（云沙箱）不构成 npm 域的验证证据**：`node scripts/check-dep-audit.js` 在本机输出的首行是
  `::warning::SCANNER_UNAVAILABLE: npm(spawnSync pnpm ENOENT) pip(spawnSync pip-audit ENOENT)`
  —— **本机没有 pnpm / pip-audit，npm 域与 pip 域本轮「不判」**，
  那个 rc=0 只覆盖了 `npm-opscenter` 域（命中 2 / 挂账 27）。
  ⇒ **npm 域的判定以 CI 为准**，本记录不拿本机 rc=0 冒充 npm 域已验。
  （与 `dep-audit-baseline-2026-10` 那篇同一形态的坑：域不可用时最容易把「没判」读成「已通过」。）
- **触发面为何窄（复核时要盯的判据）**：本仓的 zod 校验对象是**内部生成**的渲染参数与配置，
  不接受外部直接投递超大集合 ⇒ 命中的是 CWE-770 的「超大受限集合」形态。
  复核条件写进 note：任一 zod 校验对象改为接受外部可控集合，即需重新评估本条的 `decision`。

## CHANGELOG 条目

# fix(dep-audit): 登记 zod 公告 GHSA-mrhx-c7xc-m3w5，解全仓 PR 的依赖漏洞审计连红（dep-audit-zod-baseline）

- 依赖漏洞审计门禁对每个 PR 都跑，2026-10-23 新发布的 zod 公告（GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404，
  CWE-770 资源未限流，影响面仅可用性）使**全仓所有 open PR 同时变红**，与各自改动无关。
- 本次按门禁给出的「升级依赖」或「登记 decision + note」两条出路走**登记**一条：
  `decision: upgrade-tracked`、`patched: >=4.6.6`、`targetVersion: 4.6.6`，并在 note 里写明本仓触发面为何窄、
  为什么不立刻修（刷新 lockfile 需连带回归 remotion-composer 的渲染/构建链）、动作是什么。
- 不改任何依赖版本、不改任何代码；复核日随基线顶层 `reviewBy`（2026-12-31），到期前必须完成升级，
  或改判 `accepted-risk` / `not-exploitable` 并给出复核依据。

## learnings

### lesson: 审计域不可用时，不得把「没判」读成「已通过」（dep-audit-zod-baseline）

**现场**：本机跑 `node scripts/check-dep-audit.js` 得到 rc=0，但输出首行是
`::warning::SCANNER_UNAVAILABLE: npm(spawnSync pnpm ENOENT) pip(spawnSync pip-audit ENOENT)`
—— 本机没有 pnpm / pip-audit，npm 域与 pip 域**本轮不判**，那个 rc=0 只覆盖 `npm-opscenter` 域。

**根因**：门禁脚本在缺扫描器时会**降级为不判**并继续跑完其余域，退出码仍是 0。
「域不判」与「域已通过」在退出码上同形，只有输出首行能区分。

**可复用的 N 条**：

1. 任何有「按域降级」的扫描器，**读数必须按域拆开看**：先看警告行，再看每个域的命中数。
2. 「域不可用」不是「域干净」—— 报告里必须写清本轮**哪些域真的判了、哪些没判**。
3. 复核者若按记录跑一遍，会拿到同一个 rc=0 —— 所以记录里要**明写缺哪个扫描器**，
   否则下一个人会拿这个 rc=0 当成 npm 域已验的证据。
