---
record: dep-audit-envelope
task: 修依赖审计判据：错误信封不得被当成「空审计报告」
date: 2026-10-22
---

# 依赖审计判据：错误信封 ≠ 没有漏洞

## 1. 现场

PR #4219（会员中心订单页）的 `依赖漏洞审计` **连续三次**失败（attempt=1/2/3），红灯文案：

```
命中分布: npm=24 npm-opscenter=0 pip=2 命中=26 挂账=28
❌ RESOLVED_STILL_BASELINED: npm-opscenter/GHSA-68FV-2MGG-JV7Q 已不再命中（多半已升级），请 --update 清账
❌ RESOLVED_STILL_BASELINED: npm-opscenter/GHSA-G2V6-RQMX-R4W6 已不再命中（多半已升级），请 --update 清账
```

三条事实让它不可能是「分支把依赖弄坏了」：

1. 该 PR **没有**改 `pnpm-lock.yaml` / `package.json`（`git diff --name-only` 为空）
2. 同一门禁在 #4212 / #4213 / #4215 / #4217 / #4218 上均 `pass`
3. 本机同时刻手动跑 `npm audit --omit=dev` 报
   `request to .../security/audits/quick failed, reason: socket hang up`

## 2. 根因：扫描器失败被当成「量到了 0」

`check-dep-audit.js` 的 `shellRun()` 只做一件事：从 stdout 找第一个 `{`，然后 `JSON.parse`。
而 `npm audit` / `pnpm audit` 在请求失败时**恰好把错误 JSON 打到 stdout**：

```json
{"message":"request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: socket hang up",
 "error":{"code":"ECONNRESET"}}
```

它能通过 `JSON.parse` ⇒ `ok:true` ⇒ `parseNpmAuditV2()` 拿到 0 个 vulnerabilities ⇒ **0 命中**
⇒ 基线里该域全部条目被判 `RESOLVED_STILL_BASELINED`。

**危害不是「报红」，是「指错方向」**：文案让人去删基线。照它 `--update`，会把真实挂账清空，
门禁从此恒绿 —— 这正是 AGENTS 点名的「把工具的失明读成结论」的同型，且是它的**红文版本**。

`runCheck` 其实早就有 `SCANNER_UNAVAILABLE` 语义（「该域本轮不判，其挂账条目也不判成已不再命中」），
只是错误信封根本走不到那条路 —— 它被当成了一次成功的扫描。

## 3. 修法（三处，最小面）

| # | 改动 | 说明 |
|---|---|---|
| 1 | 新增 `isAuditReport(json)` | 只有含 `vulnerabilities`（npm v2）或 `advisories`（pnpm/旧版）**键**才算报告。用「键存在」而不是「数量为 0」，才能区分「真的没漏洞」与「没量到」 |
| 2 | `shellRunOnce` 校验形状 | 两个 npm 域传 `expectAuditReport: true`；错误信封 ⇒ `ok:false`，文案写明「扫描器返回的不是审计报告（多是端点不可达）」 |
| 3 | `shellRun` 带重试 | 默认 3 次、间隔 2s/5s。端点失败形态 `socket hang up` 是**瞬时**的，不重试会把一次抖动放大成一次门禁红 |

**没有改的东西**（刻意）：`SCANNER_UNAVAILABLE` 的**通过/失败语义**保持原样（仍是 warning + 该域不判）。
把它改成硬失败是**策略变更**，会决定「审计端点不可用时是否允许所有 PR 停摆」—— 那该由人拍板，
不该在一次 bug 修复里夹带。这里只把「错误的红」修成「诚实的警告」。

## 4. 修的过程中踩到自己挖的坑（必须记）

给 `shellRunOnce` 加校验时，一次**行级编辑**把 `cwd: opts.cwd || ROOT` 那一行吞掉了。
后果不是报错，而是：`npm audit` 跑在**仓库根**（那里没有 ops-center 的 `package-lock.json`）
⇒ 拿不到报告 ⇒ `npm-opscenter` 被判 `SCANNER_UNAVAILABLE` **永久跳过**。

**而结果是绿色的** —— 只是少扫一个域，不吵不闹。这正是最该上锁的形态。
补救：恢复 `cwd` 透传，并补一条接线锁 `shellRunOnce 必须把 cwd 透传给扫描器`
（注入 spawn 捕获 options，断言 `cwd` 逐字相等）。

教训：行级替换（`$i++` 跳过原行）必须逐行回读确认没有连带吞行；改完立刻用**真实端点**跑一次，
而不是只跑注入式单测 —— 单测全绿也掩盖不了「参数丢了」。

## 5. 判据

新增 7 例（`scripts/check-dep-audit.test.js`，总计 47 例）：

| 用例 | 断言 |
|---|---|
| `isAuditReport` 形状判定 | `{vulnerabilities:{}}`/`{advisories:{}}` 是报告；错误信封 / `{}` / `[]` / `null` 不是 |
| 错误信封 → `ok:false` | 文案必须含「不是审计报告」 |
| 合法零漏洞报告 → `ok:true` | 不能把「真的没漏洞」误判成扫描失败 |
| 不传 `expectAuditReport` 不改行为 | pip-audit 输出形状不同，不能被误伤 |
| 重试：先错后对 → 成功 | 恰好尝试 2 次 |
| 重试耗尽 → 返回最后错误 | 恰好尝试 3 次，由 `runCheck` 记 SCANNER_UNAVAILABLE |
| **cwd 接线锁** | 注入 spawn 捕获 options，断言 `cwd` 逐字相等 |

### 变异反证（两条，均双向）

1. 摘掉 `expectAuditReport` 形状校验 → **43 pass / 4 fail**，错误信封与两条重试用例精确变红
2. 删掉 `cwd: opts.cwd || ROOT` → **46 pass / 1 fail**，cwd 接线锁精确变红

两条均逐字节还原校验 True。

### 真实端点实测（同一台机、同一分钟内）

| 场景 | 修前 | 修后 |
|---|---|---|
| 端点抽风（`socket hang up`） | `RESOLVED_STILL_BASELINED` ×2 + 「请 --update 清账」+ rc=1 | `::warning::SCANNER_UNAVAILABLE: npm-opscenter(扫描器返回的不是审计报告…)` + rc=0，**不再指向删基线** |
| 端点正常 | `npm-opscenter=2`，28=28，rc=0 | `npm-opscenter=2`，28=28，rc=0（不变） |

## 6. 这是「改谁来守门」

改的是判据本体，按 AGENTS 必须人工过目，**不自动合并**。
本 PR 不改变任何通过/失败策略，只修「把失败读成 0」。若要进一步把
`SCANNER_UNAVAILABLE` 从 warning 改成硬失败，请在本 PR 或后续单独拍板。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
