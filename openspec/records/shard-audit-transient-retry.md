---
record: shard-audit-transient-retry
task: 给 CI 重测入口的取数路径加「只重试传输层抖动」的有界退避，并把第一批同-runner 两片并行读数追加进预算 provenance（且让它真的参与判据）
date: 2026-10-24
---

## 本次执行记录：重测入口对 TLS 抖动零重试 + provenance 变成一册被读的账（shard-audit-transient-retry，取证 2026-10-22 / 落地 2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（改 CI 消费的工具脚本本体 `scripts/electron-ci-shard-audit.js`、`scripts/electron-ci-desktop-step.js` 与两把锁）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-shard-audit-transient-retry`、裸分支 `shard-audit-transient-retry`（`git rev-parse --abbrev-ref HEAD` 实证）。入口 `scripts/start-mp-task.ps1 -TaskName shard-audit-transient-retry` 产物判据：`git worktree list` 含该条 + 分支名对上；依赖链 `pnpm install --frozen-lockfile` → `node scripts/ensure-electron.js`（dist 缺失时自装，实测装到 v43.7.7）→ `node scripts/verify-worktree-deps.js` ⇒ `消费方解析通过 11 项 / OK` |
| 第一性原因（QM-5 ①） | PASS | 不是"网络坏"，是**取数路径上没有任何重试**：`grep -na "attempt\|retries\|backoff" scripts/electron-ci-shard-audit.js` 在改动前实测 **0 命中**。同一台机器、同一凭据、同一条命令，2026-10-22 连续 4 次 SELF_FAULT（rc=2），第 5 次成功 —— 断点还会飘：3 次落在 `api repos/{owner}/{repo}/actions/jobs/<id>/logs`（目标是 `productionresultssa*.blob.core.windows.net`），1 次落在 `--runs=3` 的**第一条** `gh run list`（`read tcp …->198.18.0.241:443: wsarecv: An existing connection was forcibly closed`）。追溯到 `1dc7417ed`（#4192 第二笔）引入该入口时就是单发 `spawnSync`，即缺陷自引入起存续，不是后来被改坏 |
| 逃逸分析（QM-5 ②） | PASS | ① 既有 9 条锁全测**判据算术与退出码**（容差 / 两档不混记 / 零样本非零退出），**一条都不测取数失败** ⇒ 归类 测试场景缺失；② 取数面当时是模块级 `ghJson` / `ghText` 两个函数、内部直接 `cp.spawnSync` ⇒ "抖两次之后能不能自己恢复"这件事在测试里**不可达**，归类 接缝不存在（与 #88 那条 spawnSync 只判 status 同族：都是"失败路径不可注入 ⇒ 不可测"）；③ 更隐蔽的一层：审计脚本**确实**按 `rc=2` 出声，所以这个缺口在 CI 与本地都表现为"多跑几次就好"，永远不会有人来查它 |
| 系统性漏洞定位（QM-5 ③） | PASS | 「子进程/外部 CLI 失败的可重试性」这一格在本仓没有实现：`spawnSync` 的三态（`error` / `signal` / `status`）被压成一个布尔（#88 已就 python 侧修过一次），而 `gh` 这一侧连分类都没有。落点 = 必须有一处 `isTransientGhFailure` 纯函数持有分类口径 + 一处 `withTransientRetry` 持有"有界、只重试瞬时、每次出声、耗尽带次数"四条口径，调用点只许经 `makeGhApi` 拿；否则下一个采数脚本又是各抄一份 if |
| 修复 + 回归保护（QM-5 ④） | PASS | ① `isTransientGhFailure`：签名清单**逐项取自本机现场读数**（wsarecv / forcibly closed / `\bEOF\b` / ECONNRESET / ECONNREFUSED / ETIMEDOUT / timed out / ENOTFOUND / EAI_AGAIN / HTTP 5xx / Server Error / proxyconnect）；② `withTransientRetry`：**只**对瞬时档重试，`k < attempts` 时打印 `attempt=k+1/N 因=…`，耗尽后抛 `… attempts=N`；判据类失败（404 / ENOENT / unknown flag / GH011 / JSON 解析）**一次就抛**；③ `makeGhApi({spawnImpl,sleepImpl,notice,attempts,baseMs})` 成为唯一默认取数面，`collect` 改走它 ⇒ 重试落在**真路径**上；旧的 `ghJson`/`ghText` 两份直连实现**一并删除**（留着就是第二份事实）；④ `resolvePositiveInt`：`MP_AUDIT_GH_ATTEMPTS` / `MP_AUDIT_GH_BACKOFF_MS` 可覆盖，`0`/负数/`NaN` 一律回落默认并**出声**（`attempts=0` = 关掉重试还谎称按配置走，`NaN` 让循环整条失效）；⑤ 新增 `sleepSync`（`Atomics.wait` + 忙等兜底，因 `collect` 是同步的）；⑥ provenance 从"一个数"改成**一册 append-only `readings`**，收下第一批同-runner 两片并行读数（10 趟 / 8 片 / p50 22.1 / max 23.6，逐字抄自审计输出），顶部扶正值仍是旧的 14 片档。锁：审计侧 8 条（17 总）+ 步骤侧 3 条（15 总）|
| 防止再次发生（QM-5 ⑤） | PASS | ① 把"改回不重试"变成会红：M2 令分类器恒判非瞬时 ⇒ 5 条一起红；② 把"把判据失败也重试"变成会红：M1 恒判瞬时 ⇒ 精准红在「判据类失败一律不得判瞬时」+「404 只试一次」两条；③ 把"重试不落在真路径上"变成会红：M5 把 `collect` 的 attempts 写死 ⇒ 只红「attempts 是接进 collect 的活参数」这一条（证明 `opts`/env 确实被消费）；④ 把"册子只是装饰"变成会红：M7 让新档 max 越预算 ⇒ 红在 `预算 ≥ max(全部读数) × 倍数`；M8 让样本量不够的新读数被悄悄扶正 ⇒ 红在第三条；M9 在顶部另造一个册子里没有的数 ⇒ 红在「两份事实分账」；⑤ **provenance 追加必须配判据**：本仓「自锚数字没有门禁在看」那条老教训的反面做法是"把新数字写进注释"，这里的做法是让 `max(全部读数)` 进判据 ⇒ 追加一条读数会**可能**让 CI 变红，这才是它被读过的证据；⑥ 教训落内置记忆（#88 那条 python 侧同型已记，本条补 `gh` 侧落点）|
| 行尾与 diff 对账 | PASS | 三个被改文件工作副本实测 `i/lf w/crlf attr=text=auto`（当场 `git ls-files --eol`）。所有写入一律 utf8 读 + utf8 写并统一 `\r\n`，落盘前当场断言裸 LF=0 且 loneCR=0（本会话刚因 read utf8 / write latin1 把中文打成低字节、又被 `git add` 存进索引，故这次每步都回读并检查 U+FFFD）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等。⛔ 未直改 `CHANGELOG.md`：条目写进本文件末尾的 `## CHANGELOG 条目` 小节，由聚合器发版时搬运 |
| 接线棘轮 | PASS | 本片**不新增测试文件**：两把锁加在既有 `scripts/electron-ci-shard-audit.test.js` 与 `scripts/electron-ci-desktop-step.test.js`，二者均已显式点名进 `quality-gate.yml` 的 **changes 作业**（该 job 不被 docs-only 短路且在非 PR 早退之前，所以每个 PR 都跑）——当场核对：`node scripts/check-unwired-tests.js --root=.` ⇒ OK、rc=0；`node scripts/check-step-failfast.js` ⇒ rc=0。新代码只 require node 内置（`node:child_process` / `node:path` / `node:test` / `node:assert` / `node:fs`），满足 changes job 无 Install deps 的前提锁 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 生产代码、`packages/rpa-engine/`、任何 `.vue`/样式/locale；改的是 CI 取数工具与预算常量 ⇒ 与产物、像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | PENDING | 后端依赖体检当场 `sh scripts/deep-review.sh --check-deps` ⇒ `体检通过：后端可用`（critic=claude、proposer=opencode，均经绝对目录补 PATH 解析到 `.cmd`）。真实双模型评审在提交后跑，结论、发现项与处置随本行一起回填；**在拿到外部结论之前本行不得改成闭环值** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅（无竞品名） | 文档同步 ✅（provenance 与审计口径随代码同 PR） | 远程同步 由门禁推导

## 1. 现场读数（活数，引用时现跑）

取证与落地**不同日**：下表 5 次尝试与那批「新形状读数」都在 2026-10-22 凌晨取到（`provenance.readings[1].collectedAt` 就是它）；实现、变异反证与本次提交在 2026-10-24 —— 中间隔了两天，因为 #88 那条 main 红的修法先走。写记录与写常数时不要把两者混成同一个日期。

改动前后各跑一次同一条命令，同一台机器、同一凭据：

| 次序 | 调用 | 结果 | 断点 |
|---|---|---|---|
| 1 | `node scripts/electron-ci-shard-audit.js` | SELF_FAULT rc=2 | `jobs/119243367234/logs`（blob 主机） |
| 2 | 同上（先一次已失败的重跑） | SELF_FAULT rc=2 | `jobs/119169154201/logs` |
| 3 | 同上 | SELF_FAULT rc=2 | `run list --workflow=electron-ci.yml`（`… EOF`） |
| 4 | 同上 `--runs=3` | SELF_FAULT rc=2 | `run list`（`wsarecv … forcibly closed`） |
| 5 | 同上（默认窗口） | **OK rc=0** | `runs=10 shards=8 min=19.4 p50=22.1 max=23.6 floor=2122 budget=2700 verdict=OK` |

⇒ 5 次里 1 次成功。修完之后另有一次真跑（见下节"验证"），同一条命令一次通过。

## 2. 变异反证 M1–M9（控制跑各自全绿，红集互不相同，逐刀 byte-equal 还原）

| 编号 | 变异（取被禁形态本身） | 红在哪条锁 | 还原 |
|---|---|---|---|
| M1 | 分类器恒判瞬时（把判据类失败也重试） | 「判据类失败一律不得判瞬时」+「404 只试一次」 | byte-equal |
| M2 | 分类器恒判非瞬时（整条重试失效） | 5 条：两条分类 + 恢复 + 有界 + attempts 活参数 | byte-equal |
| M3 | 摘掉每次重试的出声（`ctx.notice(` → `void (`） | 「重试落在 collect 真走的路上」 | byte-equal |
| M4 | 耗尽后不写次数（`' attempts='` → `' retried='`） | 「重试必须有界」+「attempts 是活参数」 | byte-equal |
| M5 | `collect` 的 attempts 写死成默认 | 仅「attempts 是接进 collect 的活参数」 | byte-equal |
| M6 | `resolvePositiveInt` 放行 `0`（`n < 1` → `n < 0`） | 仅「非法值必须回落并出声」 | byte-equal |
| M7 | 新档 max 改成 45（越预算） | 仅「预算 ≥ max(全部读数) × 倍数」 | byte-equal |
| M8 | 新档 shards 改成 20（悄悄超过扶正档而不换顶部） | 仅「新读数不得被悄悄扶正」 | byte-equal |
| M9 | 顶部 `maxObservedShardMin` 改成册子里没有的 30 | 仅「顶部的数必须能在册子里对上号」 | byte-equal |

九条红集两两不同（脚本自动比对：`红集互不相同: YES`、`逐字节还原: OK`）。

## 3. 验证

- `node --test scripts/electron-ci-shard-audit.test.js` ⇒ **17 pass / 0 fail**（起点 9）
- `node --test scripts/electron-ci-desktop-step.test.js` ⇒ **15 pass / 0 fail**（起点 12）
- 活路径（真实 gh，走重构后的默认取数面）：见本文件末尾补记
- `check-unwired-tests` / `check-step-failfast` / `check-debt-budget`（`maxFileLines 5356 ≤ 基线 5359`、`filesOver500 95 ≤ 95`）/ `check-doc-abs-paths` 全部 rc=0

## 4. 遗留（不假装已闭合）

1. **退避常数仍非分布支撑**：`attempts=3`、`baseMs=1500` 的依据是"5 次里 1 次成功"这一个现场，不是量出来的失败率分布；本仓对 `*_PROVENANCE` 的口径要求攒够样本再调，所以本轮**没有**动 job 级预算，只让取数更耐用。
2. **同形态的第二、三处未做全仓收敛**：判据是 `git grep -na "spawnSync" -- scripts .github/scripts` 逐条问"error / signal 有没有被读、瞬时档有没有重试"，本轮只收了审计入口这一处（#88 收了 python 那一处）。
3. `sleepSync` 是同步阻塞：`collect` 整条链目前是同步的，改成异步会牵动所有调用方与退出码三档的测试形状，属另一片。

## CHANGELOG 条目

# [未发布] fix(ci): electron-ci 预算重测入口对 TLS 抖动做有界退避 + provenance 改成被门禁读的一册账（shard-audit-transient-retry）

- **现场**：`node scripts/electron-ci-shard-audit.js`（#4192 第二笔落的"重定预算前必须先跑"的入口）在一台机器、一份凭据下**连吃 4 次 SELF_FAULT（rc=2）、第 5 次才成功**，断点还在 `run list` 与 `jobs/<id>/logs` 之间飘。根因不是 GitHub 坏，是脚本里**零重试**（`grep -na "attempt|retries|backoff"` 改动前实测 0 命中）——一个 5:1 成功率的采集入口，等于把 #4192 刚消灭的"凭手感调预算"请回来。
- **修法**：① `isTransientGhFailure` 按本机实测签名分类（wsarecv / forcibly closed / `\bEOF\b` / ECONNRESET / ECONNREFUSED / ETIMEDOUT / timed out / ENOTFOUND / EAI_AGAIN / HTTP 5xx / Server Error / proxyconnect）；② `withTransientRetry` **只**重试瞬时档、有界 3 次、每次出声 `attempt=k/N`、耗尽抛 `… attempts=N`，判据类失败（404 / ENOENT / unknown flag / GH011 / JSON 解析）**一次就抛**——把红洗成"多跑几次终于绿了"是本仓「装饰性门禁」的同型；③ 重试落在 `collect` 真走的 `makeGhApi` 上，旧的 `ghJson`/`ghText` 两份直连实现一并删除；④ `MP_AUDIT_GH_ATTEMPTS` / `MP_AUDIT_GH_BACKOFF_MS` 可覆盖但 `0`/负/`NaN` 一律回落并出声。
- **provenance 从"一个数"改成"一册账"**：收下第一批**本步真实形状**（同 runner 两片并行）读数 10 趟 / 8 片 / p50 22.1 / max 23.6（逐字抄自审计输出），但**不扶正**为定预算的依据（8 片 < 样本量下限 10）；同时让 `预算 ≥ max(全部读数) × 倍数` 成立 ⇒ 追加读数**会**能让 CI 变红，这是它被读过的唯一证据。
- **反证**：M1–M9 逐刀 CAUGHT、红集两两不同、逐字节还原；锁 8+3 条（审计 17 总、步骤 15 总）。
- **边界**：不新增测试文件（两把锁加在已点名进 changes job 的既有文件里）；退避常数非分布支撑、同形态其它 spawnSync 点未全仓收敛，均记入执行记录 §4 遗留。
