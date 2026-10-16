---
record: publish-frequency-v4
task: 发布频率策略 v4——平台间隔三档统一 1′、日配额 30/50/200 → 200/350/500，并按 QM-6 双轴补三道运行期锁
date: 2026-10-15
---

## 本次执行记录：发布频率策略 v4（publish-frequency-v4，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 📦 数值/配置变更 + 🔐 频控守卫面。隔离 worktree `D:\Data\projects\mp-worktrees\mp-publish-frequency-v4`（非 C 盘），裸分支 `publish-frequency-v4`，入口 `scripts/start-mp-task.ps1 -TaskName publish-frequency-v4`；判据取产物：`git worktree list` 有该路径且 `HEAD==origin/main`（`4cc19d4ee`，`rev-list --count HEAD..origin/main` = 0）。依赖就绪由 `node scripts/verify-worktree-deps.js` 实测：`消费方解析通过 11 项 … OK`（打包与测试证据前必须跑，AGENTS 明文）。共享根全程 main + clean（仅 2 个他人会话的 untracked 文档，不属本会话，未触碰） |
| 第一性原因（QM-5 ①） | PASS | 不是"数值选错"，而是**一个数被当成两道闸的输入**：v3 立过 `_rollbackCap=min(max(2,dailyMax),5)`，v4 再次放松配额（30→200）时，必须重新逐**使用点**核对而不是逐赋值点——本轮据此查出 ① 地板 `max(2,…)` 在 v4 三档读数下**永不生效且无人测过**（后端轴 C2），② `BASELINE_INTERVALS` 是手工同步的第二处真源，改档忘改基线只有测试看得见（后端轴 C1/W1）。第三条属决定而非缺陷：平台间隔分级不可验证，但**整条删除**会撤掉唯一约束"同机多号同平台并行"的闸，且该失效本地无信号（PRD §3） |
| 逃逸分析（QM-5 ②） | PASS | ① **单元层**：`publish-frequency-policy.test.js` 的 `byTier` 按档聚合时**取该档最后一个平台的值**，15 个平台里只有 3 个被精确断言 ⇒ 篡改某个非代表平台的派生数值可全程绿（后端轴 W2，已补逐平台交叉锁 + N9b 反证）。② **分支覆盖层**：`dailyMax<2` 这一格没有任何用例 ⇒ 删掉地板不被发现（C2 → N7 反证现咬得住）。③ **接线层**：判据函数有测试 ≠ 生产路径调用它；摘掉模块加载时的 `checkBaselineStrength()` 调用，三条注入式用例照样全绿（C1 → 加结构断言，N8 现咬得住）。④ **日志解析层**：我给测试起名用了 ` > `，被 vitest FAIL 行的 ` > ` 分隔符截断 ⇒ 驱动误报 MISSED，这是"测试名与日志协议同形"的逃逸（改名 + 注释；PRD §9 记录）。⑤ **审查盲区**：前端轴独立确认设置页夹具与生产 `_intervals` 逐字同形（v3 曾因夹具自补 `tier` 假绿），并核出 `currentTierText` 在 v4 下不会塌行 |
| 修复 + 回归保护（QM-5 ④） | PASS | 实现：`TIER_PRESETS.platformMinMs` 三档 1′、`accountDailyMax` 200/350/500、`BASELINE_INTERVALS` 5′/1′/200；新增 `checkBaselineStrength()`（运行期只出声不抛错，表可注入）+ 模块加载即跑；`index.d.ts` 同步声明（枚举式契约锁自动覆盖新名字）。回归锁新增 4 条：逐平台数值交叉、基线运行期自检（含"表为空必须报告自检未生效"）、加载调用结构断言、回滚许可地板。规模：`packages/shared-utils` **50 文件 / 1038 passed / 10 skipped**；apps/desktop 消费者并集（`git grep` 反查被改模块名）9 文件 **294 passed**。变异 **N1–N8 + N9a/N9b + N10 共 11 条全部 CAUGHT**（清单以驱动与 PRD §9 逐条对齐，**不存在 "N11"**——本行原先写 `N1–N11（11 条）` 是把"11 条"误当成"编号到 11"，回填时纠正）、红集互不相同、还原 `FINAL_RESTORE_MATCH=true`，驱动入库 `.ccg/reviews/freq-v4-mutate.driver.js` 可复跑 |
| 防止再次发生（QM-5 ⑤） | PASS | ① 反证入口落进仓库（不再是会话草稿）；② 新导出一旦漏声明，`frequency-declaration-contract.test.js` 的枚举式锁当场红（N10 实测）；③ 自检的"失明报告"写进判据本体（空表返回违规而非返回空），沿用「观察者要报告自己的失明」；④ `01-docs/learnings.md` 前插一节（重写已解决的工具＝重新引入问题；标识符不得含日志分隔符；限额型数值改动前 grep 使用点）；⑤ CHANGELOG 置顶收口；⑥ PRD v4 的 §3/§8/§9/§11/§12 把"为何不删平台档""锁抓不到什么""何时收紧"写成可核对条款，而不是留在对话里 |
| 行尾与 diff 对账 | PASS | 动手前当场测基线：`git ls-files --eol` 对 `CHANGELOG.md` / `01-docs/learnings.md` / `AGENTS.md` = `i/lf w/crlf attr/text=auto`；`openspec/**` 新文件 = `i/lf w/lf`。前插一律**逐行保留 CRLF**（`split('\n')` 不碰行内容再 `join('\n')`，禁止"探测多数派后统一回写"）；写后回读：`CHANGELOG CRLF=21385 loneCR=0 loneLF=0 NUL=0`、`learnings CRLF=19564 loneCR=0 loneLF=0 NUL=0`，冲突标记 0。条目数守恒用**差值**不用绝对值：`# [未发布]` 块 440 → **441**（+1＝本次）。两口径 numstat 逐行相等（见提交前 `git diff --cached --numstat` 与 `--ignore-cr-at-eol` 对照） |
| 接线棘轮 | PASS | 本次**未新增** `*.test.js` 文件，全部改动落在已被 vitest 按 workspace 收集的文件里（`packages/shared-utils/tests/**`、`src/__tests__/**`、`apps/desktop/**`），属 `check-unwired-tests.js` 的 `WORKSPACE_COVERED` 豁免域；入库的 `.ccg/reviews/freq-v4-mutate.driver.js` 不是测试文件名形态，不进检查域。实测 `node scripts/check-unwired-tests.js` rc=0 |
| re-sync（两轮）与合并后复跑 | PASS | 本 PR 打开后主干前进了两次，`mergeable` 两度变 CONFLICTING，冲突面**只有置顶追加型文档**。第 1 轮 `4cc19d4ee → 8a023cdcb`（29 个提交，含 **#3672 旧载体冻结**）冲突 `CHANGELOG.md` + `01-docs/learnings.md`，合并提交 `34608fae3`；第 2 轮 `8a023cdcb → e5e06a23f`（#3695）只冲突 `CHANGELOG.md`（learnings 由 git 自动合上），合并提交 `65525c649`。解冲判据：① 先证**我的改动是纯顶部插入**——`git show HEAD:<f>` 去掉前 n 行后与 merge-base 的 blob 逐字节相同（CHANGELOG n=12、learnings n=34），于是正解就是「主干 blob 原样 + 我的 n 行插回顶部」，主干本轮的**就地改写**（CHANGELOG「新增 P6 全量产物包含性锁」行、learnings「比滞后更难读」句）自动保留新形态；② 第 2 轮改为按**结构界定**取块（下一个 `^# [未发布]` 之前）并三条自锁同时成立才落盘（首行含「发布频率策略 v4」⇒ 取的是我自己的条目而非别人的、行数仍为 12、块内恰好 1 个条目头）；③ 行多重集无损对账 `lost_lines=0` + 行数守恒（21478 = 12 + 21466）+ CR=0/NUL=0/冲突标记 0；④ `git add` 后按**字节**校验 `git show :CHANGELOG.md` 与「我的块 + 主干 blob」拼接 `Buffer.equals` = true（2577000 / 2581659）；⑤ 自动合上的 learnings 也复核：我那一节 **1** 次（主干 0 次）、`## ` 小节总数 = 主干 + 1，没有把上一轮的行搬成孤儿。**合并后复跑（不沿用合并前的数）**：`packages/shared-utils` 全量 **51 文件 / 1047 passed / 10 skipped**（第 1、2 轮各一次、两次同数；比合并前多出的 1 文件 9 例来自主干 #3663 的 `article-body-format-parity.test.js`，实测该新增文件 `it/test` 行=9、两棵树 `tests/*.test.js` 文件数都是 15 ⇒ 合并前的 1038 与合并后的 1047 差额可解释，两侧数字都如实保留）；apps/desktop 消费者并集 9 文件 **294 passed**（与合并前逐字相同 ⇒ 吸收主干无回归）；`check-no-conflict-markers`/`check-changelog-growth`/`check-changelog-duplicate-entries`/`check-text-encoding-integrity`/`check-no-brand-residue`/`check-record-qm5-rows` 复跑均 rc=0；`check-pr-exec-record.js --base=origin/main --mode=enforce` rc=0（`新增记录 1 篇 / 载体M=0`，本 PR 不碰旧载体，符合 #3672）；`classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false files=20`（混合 PR，不借道）。QM-1 的**合并后**证据由 CI 的 `build` 作业承担（在 `main ⊕ 本分支` 的合并预览上真打包，job 见 PR #3664 的 `build`=pass），本会话未在新树上重跑本机打包——如实写明，不拿合并前那一次冒充 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：`build:vue` rc=0（`✓ built in 9.19s`）、`electron-builder --win --dir --publish never` rc=0（两条 `file source doesn't exist`＝`dist/fonts`/`.playwright-browsers`，与既有记录同形态、非本次引入）。**产物内容判据**经 `@electron/asar` 的 `extractFile` 直读，`entries=15001` 过规模下界，**11/11 命中 / 0 缺失**：v4 三档精确值 ×3、基线 5′/1′/200、**无 v3 残留**（`platformMinMs: 3 * MIN`/`2 * MIN` 与配额 30/50 各 0 命中）、封顶取 min、D1 判据接进 race、终身锁、`_intervals` 回传 tier、等待分钟用 round。⚠️ 一次真实踩坑：`extractFile` 的查找键必须**去掉前导分隔符并保留反斜杠**，我那版用正则剥前缀在该传递链路下没生效 ⇒ 报 `was not found in this archive`，改为逐字符剥离后通过——判据一律看产物读出的字节数。启动第③层：打包 exe 8 秒**存活** pid=29540、**stderr 0 字节**（stdout 22048 字节是应用自身日志，不进判据）、四类红线 0 命中，且 `%APPDATA%\Multi-Publish` 启动**前后均不存在**（userData 隔离到系统临时目录，不污染用户默认 profile）。QM-4 视觉 N/A：变更集不含 `.vue/.css/.less/.scss` 与基线 PNG（只改了 `locales/settings/*.js` 与策略模块），文案改动由 `PublishFrequencySettings.test.js` 的禁止旧句 + 要求新句两条锁覆盖；如实声明——像素门禁对这类 <0.1% 面积的文案与小控件本就读不到 |
| QM-6 CCG 双模型外部评审 | PASS（替代通道） | 本机 CC Switch `127.0.0.1:15721` 当场实测 `Test-NetConnection -InformationLevel Quiet` = **False**，而 `~/.claude/.ccg/config.toml` 两个 primary 都绑该网关 ⇒ 走 `opencode run --agent plan` 只读档双轴；通道正控先行 `PROBE_OK`（nemotron-3-ultra-free）。后端 2 Critical / 5 Warning、前端 0 Critical / 0 Warning / 3 Info，**逐条在当前树重放后再定归属**（见下）。评审原件入库 `.ccg/reviews/freq-v4-review-{backend,frontend}.md` |
| 远程同步 | PASS | **PR #3664 已 squash 合并**，merge SHA `dfead4cc55c7d59669021572db299d7bd615fc6d`、时间 `2026-10-16T13:27:13+08:00`。取证两源同 sha：`git log origin/main --grep='(#3664)$' --format=%H\|%cI` 恰好 **1 行** = `dfead4cc5…\|2026-10-16T13:27:13+08:00`；`gh pr view 3664 --json state,mergeCommit,mergedAt` = `MERGED` / `dfead4cc5…` / `2026-10-16T05:27:13Z`（UTC，与前者同一时刻）。远端分支已删：`git ls-remote --heads origin publish-frequency-v4` 返回 **0 行**。合并前复核：`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`、24 项检查 `23 pass / 0 fail / 0 pending / 1 skipping`（skipping 是 `release`，非 required）；required 并集逐个点到名（classic protection 4 条 `Gate Result`/`build`/`QG Unit Tests`/`QG Coverage` + ruleset `main-ci-gate`(23749994) 7 条 `QG Static`/`QG Unit Tests`/`electron-tests`/`文档同步检查`/`债务熔断检查`/`单元测试 + Lint`/`GUI Gate Result`，取数路径实测是 `.rules[].parameters.required_status_checks[].context`）。落地内容按主干 blob 回读：`origin/main:packages/shared-utils/src/publish-frequency-policy.js` 的 `TIER_PRESETS` = 5′/1′/200、3′/1′/350、1′/1′/500，`platformMinMs: 1 * MIN` 计 4 处（三档 + 基线）。**回填介质按 #3672 的新规矩**：只改本记录的这一行 + 删除 frontmatter 的 `sync_*` 三字段，**不回写 `.quality-gates.md`、不动 `scripts/gate-record-debt-ledger.json`**（本次 `git diff` 变更集对这两个路径 0 命中） |

### QM-6 发现处置

| # | 轴/严重度 | 主张 | 重放结果（当前树） | 处置 |
|---|---|---|---|---|
| B-C1 | 后端 Critical | `BASELINE_INTERVALS` 只被测试守，生产无运行期守卫；测试被绕过则语义静默反转 | **成立**：`grep` 证实 `BASELINE_INTERVALS` 只被 `resolveIntervals` 的 fallback 分支读，无加载期断言 | **部分采纳**：新增 `checkBaselineStrength()`（只出声不抛错，表可注入）+ 模块加载即跑 + 结构断言。**不采纳其"改成派生"**——派生会把"人为想清楚过的最严值"变成随档位漂移的自动值，正是该常量刻意独立的原因（注释与 PRD §2 已写明）。反证 N8 |
| B-C2 | 后端 Critical | `max(2, dailyMax)` 地板在 v4 三档下永不生效，且无用例覆盖 `dailyMax<2` | **成立**：逐条读既有 8 处 `policy:` 桩，最小的是 `accountDailyMax: 1` 但那条测的是日配额、不是 `_rollbackCap`；`dailyMax=3/200` 两式同值 ⇒ 删地板无人发现 | **采纳**：新增地板锁（0/1/2 三格 + `dailyMax=3` 反向钉），反证 N7 实测只红这一条。**不采纳其"导出 `MIN_ROLLBACK_PER_DAY` 常量"**——那会新增第 5 个"声明了没人接"的面，正是本 PR 在 PRD §8 登记要消灭的东西 |
| B-W1 | 后端 Warning | 同 B-C1（手工同步的操作风险） | 与 B-C1 同源 | 合并到 B-C1 处置 |
| B-W2 | 后端 Warning | 非代表平台未逐个精确断言，`byTier` 取最后一个平台的值代表整档 | **成立**：`for (const platform of SUPPORTED_PLATFORMS) byTier[r.tier] = …` 确实是"后写覆盖" | **采纳**：新增逐平台 == 自身档位代表平台的交叉锁（含 `compared===15` 规模下界，防空集合假绿）。反证 N9a/N9b 各测一类错，红集互不相同。并如实纠正我自己第一版把两条期望混写造成的假 MISSED |
| B-W3 | 后端 Warning | 要求本 PR 就把 `full-auto-pipeline` 接进守卫，并给出"单日 17280 条"量级 | **量级不成立**：该流水线的循环均为有限集合（`for (i < items.length)`、`maxWaitMs` 有界等待），产出受"给它多少条内容"限制，不是无界自旋。**"不经守卫"成立**（v2 起就登记） | **拒绝"本 PR 必修"**，采纳其"v4 后相对权重上升"：写进 PRD §8 并列为独立工单（#69 那片）；不在数值 PR 里顺手改执行模型 |
| B-W4 | 后端 Warning | 平手时 `bucket` 仍报 `account`（`platformRemaining > remainingMs` 用严格大于），与"不低于"文案有认知偏差 | **不成立**：`grep` 见比较式确为严格大于 ⇒ 平手归 account；但两桶剩余毫秒**相同**，用户看到的等待时长与是否可发**完全一致**，文案写的是"通常由账号档决定"，与实现同向 | **拒绝**（附比较式与平手语义）。改 `>=` 只会把归因标签换掉、不改行为，且会让跨账号桶的归因变模糊 |
| B-W5 | 后端 Warning | `minInterval` 兼容模式下数值被覆盖而 `tier` 仍取策略值 ⇒ UI 出现「long（1 min/1 min/200）」这种标签与数值矛盾 | **不可达**：`container.setup.js:378-385` 构造守卫时**不传** `minInterval`（唯一生产装配点）；electron 侧其余 `minInterval` 命中是 `rpa-progress-throttle.js` 的同名无关物；该分支只服务旧单值 API 与测试 | **拒绝**（按不可达）。不顺手改标签语义：那会给一条生产不走的分支新增第三种 `tier` 取值，反证成本高于收益。登记为"兼容模式若复活需一并处理"（PRD §8 语境） |
| F-I1 | 前端 Info | 日配额 UI 上界 `:max="999"` 与 env 无上界不对称 | **成立**（v2 起既有） | 登记进 PRD §8，修法是表单校验语义变更，单独一片（不在数值 PR 顺手改） |
| F-I2 | 前端 Info | 我的任务书把取整措辞写旧了 | 成立（**是我的任务书过期**，非代码缺陷）：两处均为 `max(1, round(...))` 且各有锁 | 不改代码；记一句"评审读到的旧措辞由我负责" |
| F-I3 | 前端 Info | 两处 `describe` 标题仍写 `publish-frequency-policy-v2` | **成立**（`PublishFrequencySettings.test.js:65`、`publish-progress-events.test.js:276`） | 采纳：改成不带版本号的中性标题，消除"按标题索引就误判文件没更新"的漂移点 |

采纳合计：5 条（B-C1 部分、B-C2、B-W2、F-I3、B-W3 的"权重上升"表述）；拒绝 3 条（B-W4、B-W5、B-W3 的"本 PR 必修 + 17280 量级"）；登记不认领 2 条（F-I1 属表单片、F-I2 是我自己的任务书）。

### 本轮我自己制造并当场抓到的问题（不抹平）

1. **重写变异驱动 ⇒ 把已解决的问题重新引入**：还原基线与变异后内容复用同一个 Map，
   导致"还原"写回的是变异态，五条改动**叠加残留在源码里**（含把 `_rollbackCap` 硬顶整条拆掉）。
   发现方式不是驱动自报，而是外部 `git diff` 对账 + `grep` 源码读数。正解：照已验证的 v3 驱动语义重写
   （`pristine` 快照与写入分离、`NO_COLOR=1`、`failedCount` 三值判据、`Buffer.equals`、异常路径也先还原）。
2. **探针失明被读成"6 条变异全没抓到"**：`rc=1` 而 `red=0`——丢了 `FORCE_COLOR/NO_COLOR` 与 `failedCount` 档。
   这正是本仓记过多次的「一个没跑的文件在摘要里与跑了且绿完全同形」的又一变体。
3. **测试名里写 ` > `**：`档间单调：长文 > 短视频图文 > 短内容` 被 FAIL 行的 ` > ` 分隔符截断，
   驱动据此误报未点名。锁其实红了 —— 报错的是我的期望清单与我的命名。
4. **PRD 里两个 testid 写错**（`pubfreq-account` / `pubfreq-platform-minutes`，实为
   `pubfreq-account-min` / `pubfreq-platform-min`）：靠"符号名落盘前必须 grep"这条既有纪律当场抓到并改正。

### 遗留（不假装已闭合）

- `checkBaselineStrength()` 的**真实进程运行**未被观测：N8 证明"加载调用还在源码里"（结构断言），
  但"启动时若基线被写坏确实会打出一行 warn"没有活体证据（构造它需要临时改坏源码并启动应用，
  属可做的下一步，本片没做）。
- ~~回填 PR 新增 `.quality-gates.md` 本体块~~ —— **这条在本 PR 生命周期内被上游 #3672 推翻，已按新规矩执行**：
  旧载体（`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`）自 #3672 起是**只读存档**，新 PR 只写
  `openspec/records/<分支>.md`；冻结判据 `carrierDrift` 在 **main 档**按「标题条数 + sha256」拦加块/删块，
  PR 档由 `quality-gate.yml` 的 `changes` job 按事件名降为 `visible`（实测本树 `--carrier-mode=visible` rc=0、
  默认 block 档 rc=1 且 6 个新增块全属**上游已合并 PR 在冻结落地前按旧惯例写的**，不代他人收口、也不去动它的基线——
  重取基线按 #3672 自己的口径属"改谁来守门"的人工动作）。因此本次回填**只**改上面那一行为 PASS、**只**删 frontmatter
  三个 `sync_*` 字段，不碰旧载体与 ledger（`check-pr-exec-record --mode=enforce` 现场 `载体M=0` 即此的产物证据）。
- ~~`openspec/changes/publish-frequency-policy-v4/tasks.md` 的 5.1/5.2 与 v3 遗留的 3.6/4.4 同形：
  收它们要改 `openspec/changes/**`，与"纯回填变更集只允许载体文件"冲突 ⇒ 归档与销账是两次独立 PR（已列工单 #70）。~~
  —— **本条已被「同源复述纠正片」自己推翻**：那道墙只挡**纯回填** PR（`CARRIER_RE` 只认
  `openspec/records/*.md` / `.quality-gates.md` / ledger），而纠正片本来就不是纯回填——它走的是
  **出路②「修订本分支记录」**，同一变更集里带 `openspec/changes/**` 与 `CHANGELOG.md` 完全合法。
  本会话原先把"不能夹带"当成"无处可放"，于是把它登记成工单 #72 挂着——那正是「先造一个不存在的约束，
  再为遵守它欠一笔账」的形态。
- v2/v3 的 change 目录仍未归档；主干规格本次刻意不动（数值无关），因此 v3/v4 的增量条款目前**只活在 change 目录里**。
- `platformMinMs` 统一 1′ 是否安全，只能由线上工单否证（PRD §11 第一条触发条件），本片不声称已验证。

### 纠正片：同源复述里的过期读数（2026-10-16，走「修订本分支记录」出路）

本篇记录被**修订**过一次。原因不是 v4 的实现变了，而是**同一个事实在四个地方各写一遍**，改一处漏一处：

| 位置 | 原写法 | 真值与取证 |
|---|---|---|
| `CHANGELOG.md` v4 块「测试与反证」 | 全量 50 文件 / **1035** passed | **1038**。取证：合并后复跑 51 文件 / 1047，主干只新增 1 个测试文件 `src/__tests__/article-body-format-parity.test.js`（实测其 `it/test` 行数 = 9），`1038 + 9 = 1047` 完全对得上；`1035` 是**第一笔提交时点**的读数，QM-6 采纳的三条锁落地后没回改 ⇒ 连「多 3 条锁」这件事自己都对得上（1035→1038） |
| `CHANGELOG.md` 同块 | 变异 **N1–N6** 全部 CAUGHT | **N1–N8 + N9a/N9b + N10 共 11 条**。取证：驱动 `.ccg/reviews/freq-v4-mutate.driver.js` 里的 id 逐条实测 = 11 个（行 48/52/56/60/64/68/74/78/82/86/92），PRD §9 表同样是这 11 行 ⇒ 两个现存真源互证 |
| `CHANGELOG.md` 同块「文档」句 | 反证表 **N1–N6** | 同上，改成 11 条的**清单写法**而不是又一个数字 |
| `openspec/changes/publish-frequency-policy-v4/tasks.md` 4.1 / 4.3 | **1035** / **N1–N6** | 同上；4.2 另补「合并前后各跑一次、同数 294」 |

同时纠 **三处任务勾账**（真实状态与勾选不符，方向是"已做完却没勾"）：

- 4.5 QM-1 打包：`[ ]` → `[x]`，证据取本篇「QM-1 打包 / QM-4 视觉」行的实跑数字（asar `entries=15001`、11/11 命中 / 0 缺失、exe 8 秒存活、stderr 0 字节），并如实写明**合并后那一档由 CI 的 `build` 作业在合并预览上真打包代跑**（PR #3664 `build`=pass），本机没有在新树重跑。
- 4.6 QM-6 双轴评审：`[ ]` → `[x]`，证据为 `.ccg/reviews/freq-v4-review-{backend,frontend}.md` 与本篇处置表（采纳 5 / 拒绝 3 / 登记不认领 2）。
- 5.1 / 5.2 收口：`[ ]` → `[x]`，分别锚到 #3664→`dfead4cc5`、#3702→`c9086f1cb` 与远端分支 0 行。**其中计划项「AGENTS 频率条目」实测未落地**（`grep -c 发布频率 AGENTS.md` = **0**），所以该行不整条假勾，而是把没做的那一格显式留在纸上（要不要进 AGENTS QM 清单，留 #70 归档片一并定夺）。

**不改动的一份**：`.ccg/reviews/freq-v4-review-backend.md` 里两处写「6 条变异 N1–N6」——那是评审模型读 `e5d1ee253` **当时的历史事实**（那时确实只有 6 条），评审原件不得回改。

方法论一句：**任何"绝对读数"（文件数 / 用例数 / 变异条数）写进第二个载体时，必须同时写「取于哪个 SHA + 怎么重取」**，否则它就是一次性快照；本仓已两次踩过（CHANGELOG 条目数、时钟巡检候选数）。本片把写法改成「清单 + 可重取判据」，而不是再留一个孤立的数字。

> 本片的 PR 走「修订本分支记录」出路（变更集含 `CHANGELOG.md` 与 `openspec/changes/**`，不属纯回填），
> 所以不再新开一篇记录、也不再登记一笔 PENDING 欠账。
