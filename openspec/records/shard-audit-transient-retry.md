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
| 修复 + 回归保护（QM-5 ④） | PASS | ① `isTransientGhFailure`：签名清单**逐项取自本机现场读数**（wsarecv / forcibly closed / `\bEOF\b` / ECONNRESET / ECONNREFUSED / ETIMEDOUT / timed out / ENOTFOUND / EAI_AGAIN / HTTP 5xx / Server Error / proxyconnect）；② `withTransientRetry`：**只**对瞬时档重试，`k < attempts` 时打印 `attempt=k+1/N 因=…`，耗尽后抛 `… attempts=N`；判据类失败（404 / ENOENT / unknown flag / GH011 / JSON 解析）**一次就抛**；③ `makeGhApi({spawnImpl,sleepImpl,notice,attempts,baseMs})` 成为唯一默认取数面，`collect` 改走它 ⇒ 重试落在**真路径**上；旧的 `ghJson`/`ghText` 两份直连实现**一并删除**（留着就是第二份事实）；④ `resolvePositiveInt`：`MP_AUDIT_GH_ATTEMPTS` / `MP_AUDIT_GH_BACKOFF_MS` 可覆盖，`0`/负数/`NaN` 一律回落默认并**出声**（`attempts=0` = 关掉重试还谎称按配置走，`NaN` 让循环整条失效）；⑤ 新增 `sleepSync`（`Atomics.wait` + 忙等兜底，因 `collect` 是同步的）；⑥ provenance 从"一个数"改成**一册 append-only `readings`**，收下第一批同-runner 两片并行读数（10 趟 / 8 片 / p50 22.1 / max 23.6，逐字抄自审计输出），顶部扶正值仍是旧的 14 片档。锁：审计侧第 1 轮 +10、第 2 轮 +7 ⇒ 终态 26 条；步骤侧 +3 ⇒ 终态 15 条（第 2 轮改的是判据本身，不加条数）。变异 M1–M9（第 1 轮）+ M10–M17（第 2 轮，驱动与读数随本 PR 入库）|
| 防止再次发生（QM-5 ⑤） | PASS | ① 把"改回不重试"变成会红：M2 令分类器恒判非瞬时 ⇒ 5 条一起红；② 把"把判据失败也重试"变成会红：M1 恒判瞬时 ⇒ 精准红在「判据类失败一律不得判瞬时」+「404 只试一次」两条；③ 把"重试不落在真路径上"变成会红：M5 把 `collect` 的 attempts 写死 ⇒ 只红「attempts 是接进 collect 的活参数」这一条（证明 `opts`/env 确实被消费）；④ 把"册子只是装饰"变成会红：M7 让新档 max 越预算 ⇒ 红在 `预算 ≥ max(全部读数) × 倍数`；M8 让样本量不够的新读数被悄悄扶正 ⇒ 红在第三条；M9 在顶部另造一个册子里没有的数 ⇒ 红在「两份事实分账」；⑤ **provenance 追加必须配判据**：本仓「自锚数字没有门禁在看」那条老教训的反面做法是"把新数字写进注释"，这里的做法是让 `max(全部读数)` 进判据 ⇒ 追加一条读数会**可能**让 CI 变红，这才是它被读过的证据；⑥ 教训落内置记忆（#88 那条 python 侧同型已记，本条补 `gh` 侧落点）|
| 行尾与 diff 对账 | PASS | 四个被改的 `scripts/*.js` 实测 `i/lf w/crlf attr=text=auto`，记录与本轮两份新增评审产物是 `i/lf w/lf`（当场 `git ls-files --eol`，不按记忆）。所有写入一律 utf8 读 + utf8 写，追加块按**目标文件自身**的 EOL 拼装（不做"统一回写行尾"——那正是本仓幽灵行的来源），落盘后回读检查 U+FFFD。两口径对账：`git diff --cached --numstat` 合计 813，`--ignore-cr-at-eol --numstat` 合计 809，**差 4 行**；逐文件比对后 4 行全部落在第 1 轮那两份评审产物上（各 1/1）——它们本次唯一的变化是补上缺失的 EOF 换行（r2-i6），而 `--ignore-cr-at-eol` 会把"末行有无终止符"连同 CR 一起折叠，于是那两文件在该口径下显示为无差异。其余 10 个文件（含本轮新增 5 份产物/驱动）两口径逐字相等 ⇒ 没有行尾被改写。⛔ 未直改 CHANGELOG.md：条目写进本文件末尾的「CHANGELOG 条目」小节，由聚合器发版时搬运 |
| 接线棘轮 | PASS | 本片**不新增测试文件**：两把锁加在既有 `scripts/electron-ci-shard-audit.test.js` 与 `scripts/electron-ci-desktop-step.test.js`，二者均已显式点名进 `quality-gate.yml` 的 **changes 作业**（该 job 不被 docs-only 短路且在非 PR 早退之前，所以每个 PR 都跑）——当场核对：`node scripts/check-unwired-tests.js --root=.` ⇒ OK、rc=0；`node scripts/check-step-failfast.js` ⇒ rc=0。新代码只 require node 内置（`node:child_process` / `node:path` / `node:test` / `node:assert` / `node:fs`），满足 changes job 无 Install deps 的前提锁 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 生产代码、`packages/rpa-engine/`、任何 `.vue`/样式/locale；改的是 CI 取数工具与预算常量 ⇒ 与产物、像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | **两轮均已跑（外部 critic=claude / proposer=opencode 真实参与），第 1 轮 4 条 upheld 已修，第 2 轮 4 条 upheld 已修；机械状态仍 `self_play_blocked` ⇒ 合并决定交人工** | `sh scripts/deep-review.sh`（`CCG_ARL_DIR` 指向本机 Qoder 技能内的引擎）实跑两轮：第 1 轮对 `e7b39a89`、第 2 轮对新 head `8808bd5b`（critic 出 11 条、维度最低分 5 < 阈值 8）。两轮逐条裁决与落地见 §5 与 §6。**状态为什么仍然未闭合**：验证层的出口是自扮演裁决，而裁决里只要有一条 upheld 就判 `self_play_blocked`（引擎 `blockingFromAdjudication`），该值不在闭环白名单 `{cleared, needs_revision, self_play_resolved}` 内；发现本身成立且已修，不存在"假阳性"出口，我也**不手写** status 去凑闭环值（AGENTS「禁手写 status」）。另记一条实测的装饰旗标：`deep-review.sh --evidence` 会把 `--adjudication-evidence` 传给引擎，而引擎全文不读它（`grep -c adjudication-evidence` 在引擎侧 = 0）⇒ 传了等于没传，这条不是本 PR 的修法范围（动的是 `scripts/deep-review.sh` 与技能外引擎），记入 §4 遗留。 |
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

## 2. 变异反证（第 1 轮 M1–M9 + 第 2 轮 M10–M17；控制跑各自全绿，红集互不相同，逐刀 byte-equal 还原）

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
| M10 | i2 反证：摘掉 rawStderr ⇒ 判据退回只看截断后的 200 字符 | r2-i2 回归：判定读完整 stderr，打印才截断 —— 签名落在第 200 字符之后不得被判成"一次就抛" | byte-equal |
| M11 | i2 对偶反证：判据恒真 ⇒ "404 藏在长 stderr 尾部"被洗成概率事件 | 瞬时故障分类 · 判据类失败一律不得判瞬时（重试它们就是把红藏起来） | 判据类失败只试一次：HTTP 404 不得被重试洗成"多跑几次就绿了" | i4 回归：HTTP 5xx 的多种真实形态都要判瞬时，而 4xx 与毫秒数不得被误判 | r2-i2 对偶：全文判定不得变宽判据 —— 404 藏在长 stderr 尾部仍一次就抛，且打印仍然截断 | byte-equal |
| M12 | i4 反证：摘掉退避总预算 ⇒ "有界"退回输入的善意假设 | r2-i4 回归：退避总时长有硬上限 —— attempts=100 / baseMs=30000 不得把人质成 42 小时 | byte-equal |
| M13 | i8 反证：把空串退回静默回落（被禁的旧形态本身） | r2-i8 回归：空串是最容易手滑的"关掉重试"写法，必须回落默认并出声（静默吞掉等于配置坏了没人知道） | byte-equal |
| M14 | i11 反证：摘掉参数点名 ⇒ 坏 attempts 演成 TypeError | r2-i11 回归：makeGhApi 收到 attempts<1 必须当场点名，不得抛"读 undefined.message"的 TypeError | byte-equal |
| M15 | i7 反证：整段退回"守卫不存在 + opts.api 旁路" | r2-i7 回归：取数面只剩一条 —— collect 不得再接受能整体绕过重试与非法值校验的 opts.api | byte-equal |
| M16 | i3 反证：扶正分支摘掉样本量下限 ⇒ 8 片档照样能扶正 | 册子里更新的一档要么已被扶正、要么样本量确实更小（既挡悄悄漂移，也让"够了就换"可达） | byte-equal |
| M17 | i10 反证：从新档读数里抹掉分布下界 ⇒ 字段锁必须红 | provenance 是一册 append-only 读数账，顶部的数必须能在册子里对上号 | byte-equal |

第 1 轮九刀 + 第 2 轮八刀（M10–M17）红集两两不同、各自非空，逐刀还原后与开局快照**逐字节相同**（驱动先写回再比对，不是"先比对再写回"——后者读过的是仍是变异态的文件，等于没验）。第 2 轮的驱动与原始读数随本 PR 入库：`node .ccg/reviews/shardaudit-r2-mutate.driver.js`，读数见 `.ccg/reviews/shardaudit-r2-mutations.txt`（M1–M9 那一轮的驱动仍未入库，见 §4 遗留）。

## 3. 验证

- `node --test scripts/electron-ci-shard-audit.test.js` ⇒ **26 pass / 0 fail**（起点 9：第 1 轮 +10、第 2 轮 +7）
- `node --test scripts/electron-ci-desktop-step.test.js` ⇒ **15 pass / 0 fail**（起点 12；第 2 轮没有加条数，改的是「新档不得被悄悄扶正」那条锁自身）
- 活路径（真实 gh，走重构后的默认取数面，一次通过、未手跑第二次）：
  `node scripts/electron-ci-shard-audit.js` ⇒ rc=0
  `runs=5 shards=10 min=12.8 p50=21.8 max=24.5 budgetFloorSec=2209 stepBudgetSec=2700 verdict=OK`，
  全部(分钟)=24.5,21.8,15.0,12.8,23.8,21.2,23.9,21.2,24.2,21.5
  ⚠ 这批与 §1 第 5 行**不是同一个窗口**：审计取的是「最近 N 趟 push」的滑窗，两天过去后窗口整体换了一批样本
  （max 23.6 → 24.5、shards 8 → 10、runs 10 → 5）。所以引用 provenance 读数必须连**窗口与日期**一起引，
  不能只引一个 max —— 这也是本轮把 provenance 改成"带 collectedAt/runnerShape 的一册账"而不是"一个数"的原因。
  **显示值 ≠ 判据用的未舍入值**（第 2 轮评审 i1 打的就是我把两者写进同一个等式）：审计打印 `max` 走 `toFixed(1)`，而 `budgetFloorSec = round(max × 60 × 倍数)` 用的是未舍入分钟数。按区间陈述才可复算：`budgetFloorSec=2209` ⇔ 未舍入 max ∈ [24.5389, 24.5500)（显示值 24.5，拿 24.5 复算会得 2205）；`floor=2122` ⇔ 未舍入 max ∈ [23.5722, 23.5834)（显示值 23.6，复算会得 2124）。要精确复算请重跑入口取原始 `elapsed=…ms`，不要拿显示值推 —— 那 2–4 秒差会被读成"读数错"。
  两批都判 OK：`2700 ≥ 两档 floor（2209 / 2122）`，且都未贴各自 `floor×1.1`（2430 / 2334）的贴脸线。
- `check-unwired-tests` / `check-step-failfast` / `check-debt-budget`（`maxFileLines 5356 ≤ 基线 5359`、`filesOver500 95 ≤ 95`）/ `check-doc-abs-paths` 全部 rc=0


## 5. 外部评审发现与处置（第 1 轮，四条 Warning 全部 upheld）

| 编号 | 发现（外部模型 claude 原文要点） | 我的最强辩护 | 裁决 | 落地 |
|---|---|---|---|---|
| i1 | 末行终止符被吃掉，与提案自己声明的「统一行尾 + 落盘前断言」矛盾，是实物证据级别的出入 | "Node 不要求尾换行，纯风格" | **upheld** | 补回尾换行；正向回归锁（含"判据本身能区分有/无"的形状自证）+ 变异 M11 |
| i2 | 「新读数不得被悄悄扶正」那条锁让**它自己声明的出路**（样本量够了就换顶部值）结构上不可达 | "当前数据上它是绿的，行为看起来正确" | **upheld** | 规则改成「最新一档已扶正 或 样本量确实更小」，补**正控**（扶正后必须通过）与**反控**（更厚却不扶正必须红），M12 证明两条都有牙 |
| i3 | 自证是 1/5 成功率，而 attempts=3 的残余失败率 (4/5)^3 ≈ 51%，正文却称 3 为「够用下界」 | "§4 已承认非分布支撑，重点是可归因不是必然成功" | **upheld** | 文案改成明写残余失败率与选择理由（代价不对称：几秒 vs 人重跑分钟级），常数 3→5；并如实保留「残余 ~33% ⇒ 降噪不是保证」，避免用一个过度声明换另一个 |
| i4 | `/HTTP 5\d\d/` 只认单空格字面形态，`HTTP/1.1 500`、`HTTP/2 503` 全漏 ⇒ 被判"一次就抛"的恰是要治的那类故障 | "窄判据是宁漏不藏红的取向，且本仓实测签名确实命中" | **upheld** | 取向对、覆盖面窄：pattern 改 `/HTTP(?:\/[\d.]+)?\s*5\d\d/`，补 3 类正控 + 5 类负控（`elapsed=500ms`、`port 1502`、4xx、3xx 都不许判瞬时），M10 |

三条可判定发现是**先写红测试再修**（i1、i4 各自红过：`末行没有终止符` / `server replied HTTP/2 503` 未命中），i2 是锁的可达性问题故以正控形式落地，i3 是文案与参数。九条未进入裁决的问题由引擎按维度分归档，未被我判成"无意见"——它们没构成阻断项，但第 2 轮外部评审会重新看这份 diff。

## 6. 外部评审发现与处置（第 2 轮，对新 head 8808bd5b：4 条 Warning 全部 upheld，7 条 Info 逐条给结论）

第 2 轮由外部 critic=claude 出 11 条（维度分 correctness 6 / security 8 / performance 7 / maintainability 5，最低分 5 < 阈值 8），其中 4 条进裁决。11 条本轮全部处理，处理方式各不相同——**没有一条是靠改判据、调阈值或改断言消化的**。

| 编号 | 发现（外部模型原文要点） | 我的最强辩护 | 裁决 | 落地 |
|---|---|---|---|---|
| r2-i1 | 记录把**显示值**当精确值写进等式：`24.5×60×1.5 = 2209`（实为 2205）、`floor=2122` 对 `23.6` 复算（实为 2124）——正是第 1 轮 i5 指出的同一族 | "数字逐字抄自审计输出，没抄错" | **upheld** | 抄写没错、等式错：`budgetFloorSec = round(max × 60 × 倍数)` 用未舍入分钟数，而打印走 `toFixed(1)`。§3 改为按**区间**陈述（2209 ⇔ max ∈ [24.5389, 24.5500)）并给出精确复算的路子（重跑入口取原始 `elapsed=…ms`），不再留会被读成"读数错"的假等式 |
| r2-i2 | `runGhOnce` 把 stderr 截到 200 字符**之后**才造 Error ⇒ 判据只能看见截断文本；本仓 2026-10-22 现场签名正是两行、`wsarecv` 在尾部 | "实测那条签名长度 < 200，实际不会命中" | **upheld** | 长度是巧合不是性质。改为 `e.rawStderr` 挂全文、判据读全文，**打印仍截断**；两条锁一正一反：长尾签名必须重试满 attempts / 404 藏在 5000 字符尾部仍只试一次且文案仍短（防止把"读全文"写成宽判据）；M10、M11 各打这一格 |
| r2-i3 | 「新档不得被悄悄扶正」那条锁只比 `collectedAt`、不查样本量 ⇒ 记录声称的"8 片扶正当场就该红"在锁里**没有执行体**，任意一片写上顶部日期都能全绿 | "当前数据上它是绿的，行为看起来正确" | **upheld** | 第 1 轮我为这条锁补的正控**方向写反了**：它断言"任何扶正都通过"，把不足下限的那一档也算成合法出路。现在下限（`MIN_GOVERNING_SAMPLES = 10`，与「预算取值必须有实测出处」那条共用一个常量）进判据；正控换成"样本达标的新档被扶正"，另加反控"把 8 片档扶正必须红"；M16 打这一格 |
| r2-i4 | `resolvePositiveInt` 无上界 ⇒ 退避总时长 Σ k·baseMs 随 attempts 呈 O(n²)：`attempts=100 × baseMs=30000` ≈ 42 小时，而文案称"有界重试" | "env 是人手设的，不会设这么大" | **upheld** | "有界"不能建立在输入的善意上。新增 `GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT = 120s` 硬上限：预算不足即停手、出声 `退避预算耗尽 slept=… next=… budget=…`、把 `sleptMs/backoffBudget` 写进抛错文案；默认档不受影响（对偶锁保证没为了安全把重试砍成一次不试）；M12 打这一格 |

Info 七条（逐条给结论，不合并计一条）：

| 编号 | 发现 | 处置 |
|---|---|---|
| r2-i5 | 记录写「审计侧 8 条（17 总）」，与 diff 实际新增 10 个 test 块不符 | **是**。按当场 `grep -c '^test('` 重取（起点 9 → 第 1 轮 19 → 第 2 轮 26）改写 QM-5 ④ 行与 §3 两条 |
| r2-i6 | 随记录一起提交的两份评审产物都以 `\ No newline at end of file` 结尾——正是第 1 轮 i1 用实物证据打红过的形态 | **是**。先量 `CR=0` 再补单个 `\n`（不是统一回写行尾），两份各 +1 字节，`git status` 只列这两条 M |
| r2-i7 | `collect` 仍接受 `opts.api`，注入即整体绕过重试与非法值校验，而注释声称 `makeGhApi` 是唯一取数面 | **是**。删掉这条旁路：`opts.api` 直接抛 `BAD_COLLECT_OPTS`；两份两档采样夹具改注入 `spawnImpl` ⇒ 现在只有一条取数面，且夹具真的过 `JSON.parse`、退避与校验；M15 打这一格（第一版驱动只放开 `|| opts.api` 没摘守卫，该刀恒 MISSED，已按"变异必须取被禁形态本身"改正） |
| r2-i8 | `MP_AUDIT_GH_ATTEMPTS=`（空串）被静默吞掉，而 `' '` 却走"非法 ⇒ 出声"分支，与自述政策矛盾 | **是**。只有"根本没设置"安静；空串进非法分支出声。另加一条对偶"未设置必须安静"，否则每次正常跑都刷噪音 |
| r2-i9 | §5 引用 M10/M11/M12，而 §2 只登记 M1–M9，diff 里没有执行器或读数 ⇒ 变异证据无法从交付物复现 | **是**。驱动与读数随本 PR 入库（`.ccg/reviews/shardaudit-r2-mutate.driver.js` + `shardaudit-r2-mutations.txt`），§2 合并登记 M1–M17。**仍留的半格**：M1–M9 那一轮的驱动没入库，见 §4 遗留 5 |
| r2-i10 | `readings` 条目丢掉审计明确打印的 `minShardMin` ⇒ 册子作为唯一历史读数载体少了分布下界，未来调预算只能被 max 牵着走 | **是**。两条读数各补 `minShardMin`（11.2 / 19.4，两个数本来就在同一 PR 的 `source` 散文里，本轮搬进结构化字段），字段锁 KEYS 加 `minShardMin`；M17 打这一格 |
| r2-i11 | `makeGhApi` 不校验 `attempts`，直接传 0 时循环体一次不跑、末尾读 `undefined.message` 抛 TypeError | **是**。进函数即点名 `BAD_GH_API_OPTS attempts=…`；M14 打这一格 |

**为什么第 2 轮仍然不把状态做成闭环值**：验证层的出口是自扮演裁决，而引擎的 `blockingFromAdjudication` 是"任何 upheld 即阻断"——这两轮 8 条 Warning 全部成立（只是已在代码里修掉），所以工具判 `self_play_blocked`，该值不在闭环白名单 `{cleared, needs_revision, self_play_resolved}` 内。剩下的两条路我都不走：① 把裁决改成 rejected 去凑 `self_play_resolved` —— 那是撒谎，发现确实成立；② 手写 `status` / `closureNote` 去凑闭环值 —— AGENTS 的出口 ② 只覆盖"确属假阳性"，本 PR 不是。**因此本 PR 的合并决定交人工，不自动合**（另见 §4 遗留 6：`deep-review.sh --evidence` 是装饰旗标，"拿工具签名收口"这条路当前不存在）。

引擎给出的阻断清单（逐字）：`blocking = [i1:self_play_upheld, i2:high_risk_requires_external, i3:self_play_upheld, i4:self_play_upheld]`。其中 **r2-i2 被引擎打上 `highRiskDomains: ["crypto"]`**，而本 PR 的改动集里没有任何凭证/加解密文件（无 `credential-store` / `account-state-lock` / `logto-*`）——这正是 AGENTS 说的"两个轴"的实测样本：路径前缀轴判非高危（所以 `closureNote` 出口在仓内判据这一侧仍然成立），引擎的域标签轴判高危（所以 `blockingFromAdjudication` 里这一条**与我裁决成什么无关**，直接记 `high_risk_requires_external`）。两边都记下来，不许只报对自己有利的那一格。

## 4. 遗留（不假装已闭合）

1. **退避常数仍非分布支撑**：`attempts=3`、`baseMs=1500` 的依据是"5 次里 1 次成功"这一个现场，不是量出来的失败率分布；本仓对 `*_PROVENANCE` 的口径要求攒够样本再调，所以本轮**没有**动 job 级预算，只让取数更耐用。
2. **同形态的第二、三处未做全仓收敛**：判据是 `git grep -na "spawnSync" -- scripts .github/scripts` 逐条问"error / signal 有没有被读、瞬时档有没有重试"，本轮只收了审计入口这一处（#88 收了 python 那一处）。
3. `sleepSync` 是同步阻塞：`collect` 整条链目前是同步的，改成异步会牵动所有调用方与退出码三档的测试形状，属另一片。
4. **单次 gh 调用挂死仍不设超时**：`GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT` 只约束**退避**总时长，
   `spawnSync` 没传 `timeout` ⇒ 一次挂死的 gh 依然能让入口不动。本轮不顺手加，因为超时值需要分布支撑
   （#4192 刚因"预算写在注释里当愿望"被点名，不想再造一个没量过的数）。
5. **第 1 轮 M1–M9 的驱动未入库**：本轮只把 M10–M17 的驱动与读数收了进来。两批一起收口属任务 #92
   （"把变异驱动收进仓库并接进每周档"），那片会同时处理驱动的可复用形态（现在是本片专用一次性清单）。
6. `deep-review.sh --evidence` 是**装饰旗标**：它把 `--adjudication-evidence` 传给引擎，而引擎全文不读该
   参数（实测 `grep -c adjudication-evidence` 在技能内引擎 = 0）⇒ 传了等于没传。AGENTS 里"自扮演收口要拿
   工具签名"那条文案当前没有执行体；本 PR 不改它（动的是 `scripts/deep-review.sh` 与仓库外的技能引擎）。

## CHANGELOG 条目

# [未发布] fix(ci): electron-ci 预算重测入口对 TLS 抖动做有界退避 + provenance 改成被门禁读的一册账（shard-audit-transient-retry）

- **现场**：`node scripts/electron-ci-shard-audit.js`（#4192 第二笔落的"重定预算前必须先跑"的入口）在一台机器、一份凭据下**连吃 4 次 SELF_FAULT（rc=2）、第 5 次才成功**，断点还在 `run list` 与 `jobs/<id>/logs` 之间飘。根因不是 GitHub 坏，是脚本里**零重试**（`grep -na "attempt|retries|backoff"` 改动前实测 0 命中）——一个 5:1 成功率的采集入口，等于把 #4192 刚消灭的"凭手感调预算"请回来。
- **修法**：① `isTransientGhFailure` 按本机实测签名分类（wsarecv / forcibly closed / `\bEOF\b` / ECONNRESET / ECONNREFUSED / ETIMEDOUT / timed out / ENOTFOUND / EAI_AGAIN / HTTP 5xx / Server Error / proxyconnect）；② `withTransientRetry` **只**重试瞬时档、默认 5 次，且退避**总时长**另有硬上限（`GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT = 120s`，超限即停手并出声——只限次数不限总时长时 `attempts=100 × baseMs=30000` 是 Σ k·baseMs ≈ 42 小时）、每次出声 `attempt=k/N`、耗尽抛 `… attempts=N`，判据类失败（404 / ENOENT / unknown flag / GH011 / JSON 解析）**一次就抛**——把红洗成"多跑几次终于绿了"是本仓「装饰性门禁」的同型；③ 重试落在 `collect` 真走的 `makeGhApi` 上，旧的 `ghJson`/`ghText` 两份直连实现一并删除；④ `MP_AUDIT_GH_ATTEMPTS` / `MP_AUDIT_GH_BACKOFF_MS` 可覆盖但 `0`/负/`NaN`/**空串**一律回落并出声（只有"根本没设置"才安静）。
- **provenance 从"一个数"改成"一册账"**：收下第一批**本步真实形状**（同 runner 两片并行）读数 10 趟 / 8 片 / p50 22.1 / max 23.6（逐字抄自审计输出），但**不扶正**为定预算的依据 —— 这条下限现在由锁机械执行（第 2 轮 i3：原先只在散文中声称，把不足下限的一档写上顶部日期照样全绿）；同时让 `预算 ≥ max(全部读数) × 倍数` 成立 ⇒ 追加读数**会**能让 CI 变红，这是它被读过的唯一证据。
- **反证**：M1–M17 逐刀 CAUGHT、红集两两不同、逐字节还原；第 2 轮的驱动与读数随本 PR 入库为 `.ccg/reviews/shardaudit-r2-mutate.driver.js` + `shardaudit-r2-mutations.txt`（第 1 轮评审 i9 打的是"变异证据无法从交付物复现"）。锁：审计侧终态 26 条、步骤侧 15 条。
- **边界**：不新增测试文件（两把锁加在已点名进 changes job 的既有文件里）；退避常数非分布支撑、同形态其它 spawnSync 点未全仓收敛，均记入执行记录 §4 遗留。
