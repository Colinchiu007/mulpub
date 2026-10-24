---
record: dep-audit-fast-uri-undici
task: 登记 2026-10-23 21:36~22:14 同批同步的 7 条依赖公告（fast-uri ×4 / undici ×3）到依赖审计基线，解全仓 PR 的「依赖漏洞审计」连红
date: 2026-10-24
---

## 本次执行记录：依赖审计基线登记 7 条公告（dep-audit-fast-uri-undici，2026-10-24）

> **来由**：#4354 登记了 2026-10-23 20:53 前后那批的前 3 条（zod / body-parser / electron）后，
> 「依赖漏洞审计」**仍然红** —— GitHub Advisory Database 在 **21:36~22:14** 又同步进来 7 条
> （fast-uri ×4、undici ×3）。该门禁**没有 paths 过滤**，每个 PR 都跑 ⇒ 7 条不登记，全仓 PR 继续红。
>
> **实测读数（#4015 的 CI re-run，head `d9afa45c3`）**：
> `命中分布: npm=33 npm-opscenter=2 pip=2 命中=37 挂账=27`
> ⇒ 现实 37 条、基线 27 条 ⇒ 差 **10** 条 = 已由 #4354 登记的 3 条 + 本次这 7 条。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 门禁数据文件（混合 PR，非 docs-only） | worktree `mp-worktrees/mp-dep-audit-fast-uri-undici`，裸分支 `dep-audit-fast-uri-undici`；改动含 `scripts/` ⇒ 走完整质量节拍，不借道快速通道 |
| 第一性原因（QM-5 ①） | ✅ | 公告库侧**批量**新增 advisory，而 `scripts/dep-audit-baseline.json` 是**快照式挂账**（顶层 `reviewBy: 2026-12-31`）。判据口径是「现实命中 ⊆ 基线登记」：现实长大、基线没长 ⇒ 多出来的即 `NEW_ADVISORY`。**判据本身是对的**，缺的是登记 |
| 逃逸分析（QM-5 ②） | ✅ | 这 7 条**此前从未命中过**（lockfile 一直锁 fast-uri@3.1.8 / undici@7.30.0）⇒ 是库侧新增事实，不是代码退化。**没有任何 PR 内的代码改动能修好它** —— 只能由「谁先修主干」来解 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 基线新增 7 条（fast-uri ×4、undici ×3），逐条独立判据。回归由判据自带的 `checkTargetEscapes` 承担（见 §二：用**判据自带的真函数**逐条实跑，不是手推） |
| 防止再次发生（QM-5 ⑤） | ⏳（部分，见「遗留」） | 每条 `note` 写清**实测来源**（lockfile 实际版本 / 受影响区间 / 依赖链归属 / 为什么不马上修 / 动作是什么），不是抄模块名；顶层 `reviewBy` **未动**，仍是 `2026-12-31`，「到期即拦」的既有机制继续生效 |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 相等；diff 内 CR 字节数 = 0；JSON 往返逐字节一致（`json.dumps(..., ensure_ascii=False, indent=2)` 与原文件同形） |
| 接线棘轮 | N/A | 本 PR 不新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 只改门禁数据文件（JSON），未触 `apps/desktop/electron/`、未改依赖区间、未触 UI |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无外部评审通道（仓外 claude/opencode 不可用）⇒ **如实写「未执行」，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（只认 squash 尾注 `(#NNNN)`）推导归属 |

## 一、本机实测（逐条亲自跑出来的，不抄 CI 文案）

| 公告 | CVE | 级别 | CWE | 形态 | 受影响区间 | 修复版 |
|---|---|---|---|---|---|---|
| `GHSA-333x-w4r6-6crp` | CVE-2026-110725 | low | CWE-41 / CWE-116 | 后缀引用里首段冒号未转义 ⇒ scheme 注入 | `>= 3.0.0, < 3.1.9` | 3.1.9 |
| `GHSA-w74x-v6f9-j3xg` | CVE-2026-110306 | medium | CWE-172 / CWE-180 | 百分号编码的 scheme 解码 ⇒ 可伪装成另一个 scheme | `>= 3.0.0, < 3.1.9` | 3.1.9 |
| `GHSA-wjr9-j795-jxcr` | CVE-2026-110180 | medium | CWE-20 / CWE-436 | 未按 WHATWG 规则归一化 host ⇒ 主机混淆 | `>= 3.1.3, < 3.1.9` | 3.1.9 |
| `GHSA-xhq7-xmqj-769h` | CVE-2026-110095 | low | CWE-41 | 相对引用归一化时路径等价性判断不当 | `>= 3.0.0, < 3.1.9` | 3.1.9 |
| `GHSA-4qv8-2p9j-2685` | CVE-2026-109924 | medium | CWE-770 | EventSource 解析器内存无上界 ⇒ 可打爆内存 | `>= 7.0.0, < 7.30.1` | 7.30.1 |
| `GHSA-f72v-6w45-q472` | CVE-2026-109841 | medium | CWE-178 | 算法 token 非小写 ⇒ SRI 校验可被绕过 | `>= 7.15.0, < 7.30.1` | 7.30.1 |
| `GHSA-xjj6-f33q-929c` | CVE-2026-109869 | **high** | CWE-248 / CWE-459 | content-encoding 层数过多时未处理的错误 ⇒ 进程崩 | `>= 7.18.0, < 7.30.1` | 7.30.1 |

**本仓现状（实测 lockfile，不是抄依赖名）**：

- `pnpm-lock.yaml` 里 **fast-uri 只有一个版本条目** `fast-uri@3.1.8` ⇒ 落在 `>= 3.0.0, < 3.1.9` ⇒ **命中**。
  依赖链：`packages/remotion-composer` 的 importer 直接声明 `@remotion/media` / `remotion` 等，remotion 渲染栈把 fast-uri 带进来。
- `pnpm-lock.yaml` 里 **undici 只有一个版本条目** `undici@7.30.0` ⇒ 落在 `>= 7.18.0, < 7.30.1` ⇒ **命中**。
  依赖链：undici 是 `apps/desktop` 与 `packages/rpa-engine` / `packages/shared-utils` 的 HTTP 客户端传递依赖。
- 两条的 `roots` 直接照抄扫描器实报（`fast-uri` = `. | packages__remotion-composer`；
  `undici` = `. | apps__desktop | packages__rpa-engine | packages__shared-utils`），
  **不改写成别的形状** —— 这个字段虽不被任何判据校验，但它是「去哪找暴露面」的指针。

## 二、目标版本逃逸：用**判据自带的真函数**实跑，不是手推

判据 `checkTargetEscapes` 的口径是「把 `targetVersion` 与 `patched` 的下界**逐段数值比较**」：
`got[i] > want[i]` ⇒ 提前 break（通过）；`got[i] < want[i]` ⇒ 报「低于修复下界」；相等 ⇒ 继续比下一段。

用**仓内真函数**（`require('./scripts/check-dep-audit.js').checkTargetEscapes`）逐条实跑：

```
upgrade-traded 条目 35 条逐条验完，违规 0 条
GHSA-333x-w4r6-6crp => PASS
GHSA-xjj6-f33q-929c => PASS
```

本批 7 条的 `targetVersion` 都**恰好等于**修复下界（fast-uri 3.1.9、undici 7.30.1）⇒ 三段逐段相等，
既没触发「大于」也没触发「小于」，循环走完 ⇒ 返回 `null`（通过）。
**「恰好等于下界」算通过**（判据要的是「不低于下界」），而这 7 条的公告漏洞区间都是 `< 下界` ⇒ 升上去确实不再命中。

## 三、遗留（不假装已闭合）

- **本 PR 只登记、不升级**：7 条的 `decision: upgrade-tracked` 的实际动作都是「刷新 lockfile」，
  **这次一次都没做**。含义要写清楚：**这 7 条在 main 上此刻仍然真实存在**，只是被登记为已知并挂账到
  `reviewBy: 2026-12-31`。升级需连带回归 remotion 渲染链与 HTTP 客户端链，单独排期。
- **`undici` 那条 high（`GHSA-xjj6-f33q-929c`）值得单独盯**：它是「content-encoding 层数过多 ⇒
  未处理的错误 ⇒ 进程崩」，属**进程级**影响面，不是纯可用性降级。
- **这条门禁是「跑步机」**：公告库在 2026-10-23 的 20:53、21:36~21:42、22:12~22:14 三次批量同步，
  合计 10 条；**本 PR 只能把当下这批清零，下一批仍会再来**。
  ⇒ 根治方向不是「每次都手工登记」，而是把「公告库新增 ⇒ 基线落后」做成**可观测**的读数
  （例如在依赖审计作业里打印「现实条数 vs 基线条数」的差值并在差值 > 0 时点名），
  否则每次都要靠「全仓 PR 忽然一起红了」来发现。本条作为该方向的动因登记在此。
- **本机（云沙箱）不构成 npm 域的验证证据**：本机没有 pnpm / pip-audit，`node scripts/check-dep-audit.js`
  的首行是 `::warning::SCANNER_UNAVAILABLE: npm(spawnSync pnpm ENOENT) pip(spawnSync pip-audit ENOENT)`
  ⇒ **npm 域与 pip 域本轮「不判」**，本机 rc=0 只覆盖 `npm-opscenter` 域。
  ⇒ **npm 域的判定以 CI 为准**，本记录不拿本机 rc=0 冒充 npm 域已验。

## CHANGELOG 条目

# fix(dep-audit): 登记 fast-uri ×4 / undici ×3 共 7 条公告，解全仓 PR 的依赖漏洞审计连红（dep-audit-fast-uri-undici）

- 依赖漏洞审计门禁对每个 PR 都跑，GitHub Advisory Database 于 2026-10-23 21:36~22:14 又同步进来 7 条公告
  （fast-uri 4 条、undici 3 条，其中 1 条 high），使**全仓所有 open PR 继续变红**，与各自改动无关。
- 本次按门禁给出的「升级依赖」或「登记 decision + note」两条出路走**登记**，逐条独立判据：
  fast-uri 四条 → `upgrade-tracked` / 3.1.9；undici 三条 → `upgrade-tracked` / 7.30.1。
  每条 note 写明本仓 lockfile 的实际版本、受影响区间、依赖链归属、动作是什么。
- 不改任何依赖版本、不改任何代码；复核日随基线顶层 `reviewBy`（2026-12-31），
  到期前必须完成升级，或改判 `accepted-risk` / `not-exploitable` 并给出复核依据。

## learnings

### lesson: 公告库是跑步机：门禁红了要问「差集有多少条」，而不是「又冒出一条」（dep-audit-fast-uri-undici）

**现场**：#4354 登记了同批的 3 条（zod / body-parser / electron）并合入主干后，
「依赖漏洞审计」**仍然红**。实测读数 `命中=37 挂账=27` ⇒ 差 10 条 = 已登记的 3 条 + 还没登记的 7 条。

**根因**：该门禁的基线是**快照式**的，而公告库在**同一天内分三次批量同步**（20:53、21:36~21:42、22:12~22:14）。
「登记一条」只解决一条；而且**红是批量出现的**，不是逐条冒出来。

**可复用的 N 条**：

1. 修这类门禁红，**先取全量差集**（现实条数 − 基线条数），再决定登记几条；
   按 PR 正文里提到的那一条登记 ⇒ 队列解不开。
2. 差集数字本身就是最好的读数：它直接告诉你这次要登记几条，而不是让你一条一条试。
3. 真正该做的是把「差集 > 0」变成**常驻可观测读数**，而不是靠「全仓 PR 忽然一起红」来发现 ——
   本条作为该方向的动因登记在「遗留」里。
