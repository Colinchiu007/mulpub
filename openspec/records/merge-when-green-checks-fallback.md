---
record: merge-when-green-checks-fallback
task: 合并入口的 CI 检查取数不再被「老 gh 不认 --json」静默空转
date: 2026-10-24
branch: merge-when-green-checks-fallback
---

# 合并入口的取数层：老 gh 不认 `--json` ⇒ 120 分钟假等待

## 1. 现象（2026-10-24 实测，本会话亲身踩到）

`scripts/merge-when-green.sh` 是仓内**两个合并入口**之一（另一个是 `.ps1`；AGENTS.md:124
写明两者都强制调用 `scripts/check-main-red.js` 闸门）。

它用 `gh pr checks <n> --json name,state` 取 CI 状态。**`--json` 是后加的 flag**：
老 gh（实测 **2.46.0**）不认 ⇒ 命令返回 `unknown flag: --json` 并非 0 退出。

**致命处不在「取不到数」，而在「取数失败被读成 0 条检查」**：

- 脚本把取数包在 `|| echo 0` 形态里 ⇒ 失败回落成 `0`；
- 而 break 条件是「pending == 0 **且** total > 0」⇒ **total 恒为 0 ⇒ 永不 break**；
- 于是脚本在「**CI 其实早就全绿**」的状态下**无限 sleep 到 120 分钟超时**，
  日志一直打「尚未产生 CI 检查（runner 可能离线）」——**症状极具误导性**：
  看起来像 runner 离线，实际是 CLI 版本不够。

> 本会话处理另一个 PR 时用的就是这条路径的等价实现（`gh api --paginate commits/<sha>/check-runs`），
> ⇒ 绕法已被实测可行；本片把它收进仓内。

## 2. 修法（只改取数层，判定层一字不动）

**新增** `scripts/lib/pr-checks.js`（两个合并入口共用的**唯一真源**）：

1. **优先**走 `gh pr checks --json name,state`（新 gh 的原生路径，语义与真 gh 逐字一致）；
2. 老 gh ⇒ **降级**走 `gh api --paginate repos/<o>/<r>/commits/<sha>/check-runs`
   （`api` 子命令比 `pr checks` 老得多 ⇒ 覆盖面更广）；
3. 两条路都取不到 ⇒ **以非 0 退出并说明原因**，**绝不**回落成「0 条检查」
   ——这是本文件存在的全部理由：**把「取数失败」与「真的没有检查」分成两个值**。

**判定层未动**：哪些 state 算「未完成」（`PENDING IN_PROGRESS QUEUED WAITING REQUESTED`）、
哪些算「失败」（`FAILURE CANCELLED TIMED_OUT ERROR`）、break 条件、退出码语义，
全部**逐字保留在两个入口里**（取数器只负责产出 `{name, state}` 行）。

**降级路径的语义对齐**（关键）：`gh pr checks` 报的是**每个检查名的最新一次 run**
（GitHub check suite 的 rollup 语义），而 `check-runs` 返回该 commit 上**全部** run（含重跑）。
⇒ 必须**按 name 取最新**（`started_at` 最新，同刻取 `id` 最大）：
- 取「全部」⇒ 一次先红后绿的重跑会让脚本**永远判红**（实测同一 commit 上因
  `handle-ci-failure` 重跑可产生数十条同名 run）；
- 取「最严」⇒ 与真 gh 语义不一致（真 gh 取最新，不取最严）。

**状态映射**落在真 gh 的同一取值域（`SUCCESS/FAILURE/NEUTRAL/CANCELLED/TIMED_OUT/SKIPPED/
ACTION_REQUIRED/STALE/QUEUED/IN_PROGRESS/PENDING`）⇒ 降级路径与原生路径的判定不会分叉。
**未知 conclusion 归 `ERROR`**（失败档）——归「既非未完成也非失败」的空洞会被当成
「已完成且没红」⇒ **放行坏 PR**；合并门禁里漏判比误判贵得多。

## 3. 改动落点

| 文件 | 改动 |
|---|---|
| `scripts/lib/pr-checks.js` | **新增**：取数器（原生优先 / 降级 / 失败明确报错）+ 状态映射 + 同名取最新 + 三种 REST 输出形态的宽容解析 |
| `scripts/lib/pr-checks.test.js` | **新增**：20 个用例（node --test） |
| `scripts/merge-when-green.sh` | 取数点 3 处 → 调取数器（`--format=tsv`）；**判定集合逐字不变**；取数失败单独提示（不再回落成「0 条」） |
| `scripts/merge-when-green.ps1` | 取数点 2 处 → 调取数器（`--format=json`）；同上；BOM 保留 |
| `.github/workflows/quality-gate.yml` | changes job 显式点名新测试（**否则等于没写**：`scripts/check-unwired-tests.js` 会判红） |

## 4. 验证

### 4.1 单元（20/20 绿）

覆盖：状态映射逐个取值 / 未知值归失败档 / 同名取最新（含「先红后绿」「同刻取 id 大」）
/ 只把「flag 不认」当版本问题（网络与权限错误**不**降级）/ 取数失败 vs 0 条是两个值 /
降级路径缺 slug 明确失败 / 四种 REST 输出形态的包装层剥离 / CLI rc 语义。

### 4.2 变异验证（3 组，均红在目标断言上）

| 变异 | 结果 |
|---|---|
| 取数失败改成 `ok=true` + 空行 | ✅ 红 2 条（★「取数失败 vs 0 条」这条安全断言有牙齿） |
| 同名取「最早」那次（= 取最严的效果） | ✅ 红 3 条 |
| 任何非空错误都当「flag 不认」⇒ 降级 | ✅ 红 2 条 |

> 记一笔：第二轮变异**首轮没红**——不是锁没牙齿，**是变异本身写反了**
> （条件写成了「当前是 FAILURE 就覆盖」）⇒ 重做后才红。**变异首轮不红，先怀疑变异。**

### 4.3 端到端（真实 PR #4396 + 假 gh 模拟老 gh）

用 PATH 劫持一个假 `gh`（`pr checks` 一律回 `unknown flag: --json`，其余转交真 CLI），
跑真实 PR 的取数：

- 降级路径**取到真实数据**：`TOTAL=20 PENDING=11 FAILED=0`，
  `first=QG Desktop Shards (1/2)/QUEUED`；
- bash 侧过滤（`.sh` 里那段 `while`）与 pwsh 侧过滤（`.ps1` 里那段 `Where-Object`）
  **读数完全一致**（TOTAL=20 / PENDING=11 / FAILED=0）；
- ⚠️ API 报 `total_count=21`、取数器出 20 行 ⇒ 差的 1 条是**同名去重**
  （「同名取最新」的设计效果，符合预期）。

### 4.4 PowerShell 侧

沙箱装 pwsh 7.2.21（解包 .deb 运行），用**真解释器**验：

- `Parser::ParseFile` ⇒ **PARSE-OK**（无语法错误）；
- 真跑取数片段（node 子进程调用 + `ConvertFrom-Json` + `2>$errFile` stderr 分流）⇒
  `TOTAL=20 PENDING=11 FAILED=0` ⇒ 与 bash 侧一致；
- ⚠️ `.ps1` 的 **BOM 保留**（`ef bb bf`）——改写时用 `utf-8`（非 `utf-8-sig`）读写，BOM 作为
  U+FEFF 留在内容里 ⇒ 写回仍是 BOM。

## 5. 端到端实测抓到的真 bug（单测没抓到）

单测最初用「逐行一个 JSON 对象」的 fixture，而**真实 CLI 的分页输出是带包装层的**：

- `[{total_count, check_runs:[...]}]`（**包装对象被套在数组里**）
- `[[{...}],[{...}]]`（每页一个数组直接拼接）

⇒ 解析器漏剥包装层 ⇒ 得到「**0 行**」⇒ **静默假绿**（读起来像「没有 CI 检查」）。

⇒ 修法：递归剥壳（`flattenRows`），并把单测 fixture 改成**真接口的输出形态**（4 条）。
⇒ 教训与「统计脚本必须照抄被测代码的判据」同族：**fixture 必须照抄真接口的形态**，
否则单测全绿而真实环境静默失效。

## 6. 边界

- 本片**只改取数层**：判定集合、break 条件、退出码语义、`check-main-red` 闸门调用位置**一字未动**；
- 本片**不碰** `gh pr merge` / REST 合并动作（AGENTS.md 已写明「合并成败只认三条产物，不认 rc」）；
- 本片**不升级**任何 CLI（降级路径就是为了让老 gh 也能用）；
- ⚠️ 「同名取最新」与真 gh 的 rollup **不是逐字等价**（真 gh 的 rollup 由服务端算，本片按
  `started_at`/`id` 推）⇒ 极端并发下可能与真 gh 差一次 run；已在注释里写明这个边界。

## 7. 门禁（本地实跑，全 rc=0）

| 门禁 | 读数 |
|---|---|
| `check-max-lines` | rc=0 —— 「无新增超大文件，挂账清单与现实一致」；新文件 385 / 271 行（限 500），改动的两个既有脚本**不在** baseline 名单 |
| `check-gate-record-debt` | rc=0 —— 「两源所有未收口的 远程同步 行均已登记…」 |
| `check-no-brand-residue` | rc=0 —— PASS（扫描 12562 个 tracked 文件） |
| `check-unwired-tests` | rc=0 —— 「检查域内测试文件 134 个，全部测试均已接线或按欠账登记」 |
| `check-text-encoding-integrity` | rc=0 —— 「无新增编码损坏」 |
| `check-doc-abs-paths --all` | rc=0 —— PASS（5857 个受管文件，无新增本机绝对路径） |
| `classify-docs-only` | rc=0 ⇒ **docs-only=false**（含代码与 workflow ⇒ 走完整门禁，不借道） |
| `node --test scripts/lib/pr-checks.test.js` | 20/20 绿 |

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
