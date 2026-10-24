---
record: dep-audit-zod-baseline
task: 登记 2026-10-23 同批同步的三条依赖公告（zod / body-parser / electron）到依赖审计基线，解全仓 PR 的「依赖漏洞审计」连红
date: 2026-10-24
---

## 本次执行记录：依赖审计基线登记三条公告（dep-audit-zod-baseline，2026-10-24）

> **来由**：2026-10-23 20:53 前后，GitHub Advisory Database **一次性同步了三条公告**
> （zod `20:53` 前、`body-parser` `20:53:11Z`、`electron` `20:53:41Z`），
> 使「依赖漏洞审计」这个 required check 在**全仓所有 open PR** 上同时转红 ——
> 该门禁**没有 paths 过滤**，每个 PR 都跑，所以「谁的改动弄红的」不成立。
> **归因纪律**：动手登记之前，先在**未做任何改动的 main** 上跑同一条判据复现同一句 `NEW_ADVISORY`；
> 是同一条红 ⇒ 这是主干级的存量债，正确出口是有人修主干，不是把当前 PR 硬合进红主干。
>
> **为什么覆盖三条而不是只登记 zod**：PR #4354 原先只登记 zod 那条，
> 但**只登记 zod 解不开队列** —— 另两条仍会让全仓 PR 的依赖漏洞审计继续红。
> 仓内既有先例同型：`dep-audit-baseline-2026-10` 那次一次登记 8 条（npm 5 + npm-opscenter 2 + pip 1）。
> ⇒ 本次把同批三条一并登记，且逐条独立判据（不是一刀切）。
> 分支名沿用 PR #4354 原名（`dep-audit-zod-baseline`），不改名以免动 PR 的 head ref。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 门禁数据文件（混合 PR，非 docs-only） | worktree `mp-worktrees/mp-dep-audit-zod-baseline`，裸分支 `dep-audit-zod-baseline`（非 C 盘，`scripts/start-mp-task.ps1` 建立）；改动含 `scripts/` ⇒ 走完整质量节拍，不借道快速通道 |
| 第一性原因（QM-5 ①） | ✅ | 公告库侧新增 advisory，而 `scripts/dep-audit-baseline.json` 是**快照式挂账**（顶层 `reviewBy: 2026-12-31` + 既有条目）。判据口径是「现实命中 ⊆ 基线登记」：现实长大、基线没长 ⇒ 多出来的那条即 `NEW_ADVISORY`。**判据本身是对的**，缺的是登记 |
| 逃逸分析（QM-5 ②） | ✅ | 这三条公告**此前从未命中过**（lockfile 一直锁 zod@4.3.6 / body-parser@1.20.5+2.3.0 / electron@43.7.7）⇒ 是库侧新增事实，不是代码退化。**没有任何 PR 内的代码改动能修好它** —— 只能由「谁先修主干」来解，这正是本 PR 存在的理由 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 基线新增 2 条（body-parser / electron）+ 修正 1 条的 `roots`（zod）。回归由判据自带的 `checkTargetEscapes` 与 `scripts/check-dep-audit.test.js` 承担（见下 §一 第 4 条：用**判据自带的真函数**逐条实跑，不是手推） |
| 防止再次发生（QM-5 ⑤） | ⏳（部分，见「遗留」） | 每条的 `note` 写清**实测来源**（lockfile 精确锁版本 / 依赖链 / 本仓触发面 / 为什么不马上修 / 动作是什么），不是抄模块名；顶层 `reviewBy` **未动**，仍是 `2026-12-31`，「到期即拦」的既有机制继续生效 |
| 行尾与 diff 对账 | ✅ | PR 自身变更集（merge-base `c276d4f1ff08` → head）两口径相等；`--ignore-cr-at-eol` 逐文件相等；diff 内 CR 字节数 = 0 |
| 接线棘轮 | N/A | 本 PR 不新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 只改门禁数据文件（JSON）与评审产物，未触 `apps/desktop/electron/`、未改依赖区间、未触 UI |
| QM-6 CCG 双模型外部评审 | 未执行 | 见 §二。**如实写「未执行」，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（只认 squash 尾注 `(#NNNN)`）推导归属 |

## 一、本机实测（逐条亲自跑出来的，不抄 PR 正文）

### 1.1 三条公告的事实（取自 GitHub Advisory Database 实测响应）

| 公告 | CVE | 级别 | CWE | 漏洞形态 | 修复版 |
|---|---|---|---|---|---|
| `GHSA-mrhx-c7xc-m3w5`（zod） | CVE-2023-54404 | high | CWE-770 | 校验**超大受限集合**时耗尽内存（仅可用性） | 4.6.6 |
| `GHSA-27r3-jxmh-p828`（body-parser） | CVE-2026-111181 | high | CWE-248 | 压缩请求体读完后解压流仍在管道上、无 error 监听 ⇒ 尾随字节触发 uncaught exception **终止进程**；公告明写**无需认证、无需匹配路由**（解析在路由之前） | 2.x→2.4.0、1.x→1.20.9 |
| `GHSA-jr5w-w6x2-84p9`（electron） | CVE-2026-115570 | high | CWE-299 | eMudhra 中间证书被攻陷并被浏览器封禁；未修复版本上，能劫持流量的攻击者可**冒充 TLS 服务端**。公告明写**无应用侧规避手段，只能升级** | 43.8.1（另 42.11.16 / 44.9.1 / 45.0.0-beta.6） |

### 1.2 本仓现状（实测 lockfile 与源码，不是抄依赖名）

- **zod**：`pnpm-lock.yaml` 里 **zod 只有一个版本条目** `zod@4.3.6` ⇒ **精确锁**，无 range 可抬。
  依赖链实测：`packages/remotion-composer` 的 importer 直接声明 `@remotion/media: 4.0.484`，
  而 `@remotion/media@4.0.484` 的 dependencies 里写着 `zod: 4.3.6`（同样是精确版本）；
  `zod-to-json-schema@3.25.2(zod@4.3.6)` 也精确引 `zod: 4.3.6`。
  ⇒ **刷新 lockfile 就会连带牵动 remotion-composer 的渲染/构建链**。
- **body-parser**：lockfile 同时解析出 `body-parser@1.20.5` 与 `body-parser@2.3.0` ——
  公告的两个漏洞族**两条线都命中**（1.20.5 < 1.20.9；2.3.0 ∈ [2.0.0, 2.4.0)）。
  扫描器汇总报出的修复下界是 `>=2.4.0`。
  **本仓暴露面实测**（这是本条最要紧的一段，不是抄公告）：
  `packages/ai-writer-api/src/server.js:35` 用 `express.json()`（默认 `inflate: true` ⇒ 会建解压流）；
  `src/server.js:112` 的 `app.listen(port, ...)` **未传 host** ⇒ Node 默认绑全部网卡（默认端口 3487）；
  而鉴权中间件挂在 `app.use("/api/ai", ...)` **之后**（`server.js:40`）⇒ **body 解析发生在鉴权之前**。
  ⇒ 公告说的「无需认证」在本仓是**字面成立**：这是**未认证可触发的进程级 DoS**，不是纸面风险。
  缓解手段（公告给的 work-around）：不需要压缩请求体时用 `express.json({ inflate: false })`。
- **electron**：lockfile 解析到 `electron@43.7.7`，落在受影响区间 `>=43.0.0-alpha.1, <43.8.1`。
  `roots` 是 `pnpm audit --prod` 口径下的**直接依赖方**：根 `package.json` 的 `dependencies` 里 `electron ^43.7.7`
  （`apps/desktop` 的 electron 是 **devDependency**，被 `--prod` 排除），
  `packages/rpa-engine`（peer `>=33.0.0`，optional）、`packages/shared-utils`（peer `>=20.0.0`，optional）。
  桌面端会对外发 TLS 连接（模型服务商 / 发布平台 API）⇒ **不是纯可用性问题**，属中间 CA 信任链被冒充。

### 1.3 逐条 decision 不同（不是一刀切）

| 公告 | decision | targetVersion | 依据 |
|---|---|---|---|
| zod | `upgrade-tracked` | 4.6.6 | 修复版已发布；本仓触发面窄（内部生成的校验对象），但刷新 lockfile 需连带回归 remotion-composer 渲染/构建链 ⇒ 登记挂账、单独排期 |
| body-parser | `upgrade-tracked` | 2.4.0 | 修复版已发布且是补丁版本；暴露面虽是「未认证可崩进程」，但**有 work-around**（`inflate: false`）⇒ 登记挂账 + 在 note 里写明 work-around 与暴露面，供复核时定优先级 |
| electron | `upgrade-tracked` | 43.8.1 | 公告明写**无应用侧规避手段** ⇒ 只能升级；electron 是桌面运行时二进制，升级需连带回归打包与启动链 ⇒ 登记挂账、单独排期 |

### 1.4 目标版本逃逸：用**判据自带的真函数**实跑，不是手推

判据 `checkTargetEscapes` 的口径是「把 `targetVersion` 与 `patched` 的下界**逐段数值比较**」：
`got[i] > want[i]` ⇒ 提前 break（通过）；`got[i] < want[i]` ⇒ 报「低于修复下界」；相等 ⇒ 继续比下一段。

用**仓内真函数**（`require('./scripts/check-dep-audit.js').checkTargetEscapes`）逐条实跑：

```
upgrade-tracked 条目全部逐条验完，违规 0 条
GHSA-mrhx-c7xc-m3w5 => PASS (null)
GHSA-27r3-jxmh-p828 => PASS (null)
GHSA-jr5w-w6x2-84p9 => PASS (null)
```

三条的 `targetVersion` 都**恰好等于**修复下界（4.6.6 / 2.4.0 / 43.8.1）⇒ 三段逐段相等，
既没触发「大于」也没触发「小于」，循环走完 ⇒ 返回 `null`（通过）。
**「恰好等于下界」算通过**（判据要的是「不低于下界」），而这三条的公告漏洞区间都是 `<下界` ⇒ 升上去确实不再命中。

### 1.5 顺带修正的一处元数据（非校验字段）

原 zod 那条的 `roots` 写的是 `["zod"]`（模块名），而全表其余条目的 `roots` 语义是
**「扫描器口径下的直接依赖方 / importer 路径」**（如 `apps__desktop`、`packages__ai-writer-api`）。
⇒ 已改成扫描器实报的 `[".", "packages__remotion-composer"]`。
`roots` **不被任何判据校验**（只用于打印与人工定位），改它不影响 CI；
但留着会让下一个人按 `roots` 去找暴露面时找不到地方。

### 1.6 基线元数据未动

顶层 `reviewBy` 仍是 `2026-12-31`（与 main 逐字节相同），条目总数 27 → 30，
**没有重复主键**（`source/id` 逐条查重：0 重复）⇒ 不会把这条挂账的复核期限偷偷往后拖。

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

- **本 PR 只登记、不升级**：三条的 `decision: upgrade-tracked` 的实际动作都是「刷新 lockfile」，
  **这次一次都没做**。含义要写清楚：**这三条漏洞在 main 上此刻仍然真实存在**，
  只是被登记为已知并挂账到 `reviewBy: 2026-12-31`。
  升级排期建议按暴露面排序：**body-parser（未认证进程级 DoS）> electron（中间 CA 信任链）> zod（仅可用性）**。
- **body-parser 的暴露面比公告本身更值得单独开刀**：本次登记只是「不再挡住全仓 PR」，
  **不是**把风险处理掉了。要真正处置有两条路：
  ① 升 body-parser 到 1.20.9 / 2.4.0 以上；
  ② 不依赖压缩请求体时，给 `express.json()` 加 `{ inflate: false }`（公告给的 work-around），
  并把 `app.listen(port)` 改成显式绑回环地址（当前未传 host ⇒ 默认绑全部网卡）。
  这两条都是**改动运行面**的动作，不该塞进「只登记」的 PR ⇒ 单独排期。
- **本机（云沙箱）不构成 npm 域的验证证据**：`node scripts/check-dep-audit.js` 在本机输出的首行是
  `::warning::SCANNER_UNAVAILABLE: npm(spawnSync pnpm ENOENT) pip(spawnSync pip-audit ENOENT)`
  —— **本机没有 pnpm / pip-audit，npm 域与 pip 域本轮「不判」**，
  那个 rc=0 只覆盖了 `npm-opscenter` 域（命中 2 / 挂账 27）。
  ⇒ **npm 域的判定以 CI 为准**，本记录不拿本机 rc=0 冒充 npm 域已验。
  （与 `dep-audit-baseline-2026-10` 那篇同一形态的坑：域不可用时最容易把「没判」读成「已通过」。）
- **`reviewBy` 未动**：仍是 `2026-12-31`。三条新登记全部挂到这个日期，**没有为它们单独设更近的复核期限** ——
  body-parser 那条是未认证 DoS，等到年底才复核偏晚，值得单独定一个更近的期限。

## CHANGELOG 条目

# fix(dep-audit): 登记 2026-10-23 同批同步的三条依赖公告，解全仓 PR 的依赖漏洞审计连红（dep-audit-zod-baseline）

- 依赖漏洞审计门禁对每个 PR 都跑，2026-10-23 20:53 前后 GitHub Advisory Database 一次性同步了三条公告
  （zod / body-parser / electron，均为 high），使**全仓所有 open PR 同时变红**，与各自改动无关。
- 本次按门禁给出的「升级依赖」或「登记 decision + note」两条出路走**登记**，逐条独立判据：
  zod → `upgrade-tracked` / 4.6.6；body-parser → `upgrade-tracked` / 2.4.0；electron → `upgrade-tracked` / 43.8.1。
  每条 note 写明本仓触发面、为什么不立刻修、动作是什么；body-parser 那条另记了本仓的暴露面
  （`express.json()` 默认开 inflate、鉴权中间件挂在 body 解析之后、监听未绑回环地址）。
- 不改任何依赖版本、不改任何代码；复核日随基线顶层 `reviewBy`（2026-12-31），
  到期前必须完成升级，或改判 `accepted-risk` / `not-exploitable` 并给出复核依据。

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

### lesson: 一条门禁卡住全仓时，「登记一条」不等于「解开了」（dep-audit-zod-baseline）

**现场**：PR #4354 原先只登记 zod 那条公告。推上去后依赖漏洞审计**仍然红** ——
同批同步进来的还有 body-parser 与 electron 两条，`NEW_ADVISORY` 一条一条冒出来。

**根因**：这条门禁的基线是**快照式**的，现实与基线的差集**每一条都要单独登记**才清零；
而公告库的同步是**批量**发生的（这次三条在 30 秒内一起进库）⇒ 「登记一条」只解决一条。

**可复用的 N 条**：

1. 修「全仓被同一条门禁卡住」时，**先取全量差集**再动手，不要按 PR 正文里提到的那一条登记。
   判据：登记完之后，那条门禁在**未改动的 main** 上还红不红？还红就是没修完。
2. 公告/依赖类快照基线，同步是**批量**的 ⇒ 一条 PR 里登记同批全部是常态
   （仓内先例：`dep-audit-baseline-2026-10` 一次登记 8 条）。
3. 登记 ≠ 风险已处置。body-parser 那条登记完仍是真的未认证 DoS ⇒ note 里必须把暴露面写实，
   并把「真正的处置动作」与「登记动作」分开写。
