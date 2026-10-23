# Tasks: schedule-heartbeat-lock

> 顺序即依赖：1 是 2 的前置（周期字段来自扩展后的 loader），3 的接线锁要读 2 的落点。
> 每片完成后必须"先红后绿"留痕：新用例要能指出"把修复拆掉它会红"，红集互不相同。

## 1. 共享 loader 增量（不做第二份枚举）

- [x] 1.1 `scripts/check-schedule-failure-watch.js::loadWorkflows` 增 `crons: [string]`（同一作业多行 cron 全部收集），
      语义只做增量：`scheduled/hasCron/runList/name/file` 不变
- [x] 1.2 既有用例 `# tests 13 / pass 13 / fail 0` 照旧全绿（这是"增量不破坏"的证据，不是"应该没问题"）
- [x] 1.3 新增一条锁：`crons` 对 `23 3 * * *` 与多行 schedule 各取到精确数组（禁止 `toContain` 式的松断言）
      → 落在本刀的 H14（消费方档），不是 loader 自己的档；偏差与理由见文末「偏差与理由」①
- [x] 1.4 变异 m-cron：把 `crons` 的采集改成只取第一条 ⇒ 多行那条用例必须红 → m15（红集恰为 H14）；
      另补 m16「取消 schedule 块的缩进边界」，证明"块内/块外"这条边界本身也在被守（同样只红 H14）

## 2. 判据本体 `scripts/check-schedule-heartbeat.js`

- [x] 2.1 `periodFromCron(cron)` → `{kind,ms}|null`，形状表照 design §2；**推不出返回 null，不猜**
- [x] 2.2 `judge({ root, now, runsOf, slackHours })` 返回 `{verdict, rows[], faults[], counts}`；
      四档 `OK / LATE / NEVER_RAN / SCANNER_FAULT` 各自可达，退出码 0/1/1/2（2.5 钉）
- [x] 2.3 `HEARTBEAT_PROVENANCE`：`{maxIntervalRatio, maxDriftHours, samplesPerWorkflow, measuredAt, slackHours, minSamples, unmeasuredKinds, remeasure}`，
      实测覆盖 `daily|weekly`，monthly 由 `unmeasuredKinds` 逐字承认"未实测"
- [x] 2.4 env 覆盖 `MP_SCHEDULE_HEARTBEAT_SLACK_HOURS`：非数字/≤0/空 ⇒ 回落默认 8 **并 warn 出声**；首行打印 `slack_hours=N(source)`
- [x] 2.5 CLI 首行 `SCHEDULE-HEARTBEAT now=… workflows=N late=k never=j faults=f thin=t slack_hours=… 判定=…`，
      逐条打印 `LATE <file> name=… period=daily last=… age_hours=… 阈值_hours=…`
- [x] 2.6 `--limit`/`--explain`/`--root`/`--repo`：未知旗标与非法取值一律走自身故障档（rc=2），
      `--limit N` 与 `--limit=N` 两种写法都生效；`--limit` 的判定只按被限定那一组算（H15 + m10/m11）
- [x] 2.7 只用 node 内置模块 + `require('./check-schedule-failure-watch.js')` 复用 loader；零出站（采集由调用方注入）
- [x] 2.8（补）`makeGhCollector` 的 repo 必须过 `REPO_RE`、作业文件名必须过 `WORKFLOW_FILE_RE`，
      不合就**一次调用都不发**（拼进 API 路径的东西不接受"看着没问题"）

## 3. 行为锁 `scripts/check-schedule-heartbeat.test.js`（真依赖、假时钟、注入采集）

- [x] 3.1 H1 新鲜绿控：daily 作业 3 小时前跑过 ⇒ OK，且退出码 0（合规形态不得红）
- [x] 3.2 H2 LATE：daily 作业 40 小时前跑过 ⇒ LATE 并点名文件 + `age_hours` + `阈值_hours`
- [x] 3.3 H3 边界：正好 `period + slack` 内/外各一条（差 1 秒即翻转），钉住"≥/>"的取向
- [x] 3.4 H4 NEVER_RAN ≠ SCANNER_FAULT：同一份假数据，一个"采集成功但零条 completed schedule run"、
      一个"采集抛错" ⇒ 两条不同档、两个不同退出码
- [x] 3.5 H5 别的 event 不算心跳：只有 `push/pull_request/workflow_dispatch` run 的作业必须判 NEVER_RAN，
      且 `last` 不得被 push run 的时间顶替（形状判据必配反例夹具）
- [x] 3.6 H6 `in_progress`/`queued` 不算：只有 `status=completed` 才算一次心跳兑现（`conclusion=failure` 算兑现）
- [x] 3.7 H7 多行 cron 取最短周期：同作业 `[daily, weekly]` 时按 daily 判迟到，两个声明顺序都测
- [x] 3.8 H8 cron 不可判定 ⇒ SCANNER_FAULT 且 rc=2（`mon` 非 `*`、字段数 4、`dom` 含逗号、分钟步进各一例）
- [x] 3.9 H9 env 纪律：`abc|0|-5|NaN` 各自回落 8 且**打印了 warn**（warn 走 warn 通道，不混 stdout）；`=24` 生效并被首行读到
- [x] 3.10 H10 provenance 与安全倍数：`period + slack ≥ maxIntervalRatio × period` 对 daily/weekly 各自成立，
       样本量为正整数、`remeasure` 含可重跑命令、monthly 的"未实测"被承认
- [x] 3.11 H11 真仓规模下界：带 schedule 的作业 ≥ 4、每条都推得出周期（推不出即红，不许"未知就跳过"）
- [x] 3.12 H12 接线锁：`schedule-heartbeat.yml` 存在、`scheduled` 为真、cron 推得出周期、**剥掉注释后**判据与行为锁被点名、
       `shell: bash` / `timeout-minutes` / `actions: read` 在位、名单含本作业名（与 Gate 2b13 互咬）、
       预算格在 `gate-timeout-registry.json` 在册且**登记数 == 声明数**
- [x] 3.13 H13 采集器真实性：argv 带 `--jq` 且投影含三个必需字段、查询里**不得**带 `event=schedule`、
       gh 抛错/非数组/字段名写错一律"取不到数"、文件名不合时一次调用都不发、repo 不合构造即抛
- [x] 3.14 H14（补）loader 的 `crons`：块内全收、块外不收、行尾注释剥掉（`deepEqual` 精确断言）
- [x] 3.15 H15（补）参数面：两种 `--limit` 写法都生效、判定只按被限定那一组、五类非法参数走 rc=2，
       并带一条"不带 limit 时同一条迟到必须红"的对照（防把探针失明读成通过）
- [x] 3.16 H16（补）判据域为空 ⇒ SCANNER_FAULT 且 rc=2（域级失明不在 rows 里，`main` 的退出码必须另加回来——
       这一格是写用例时才发现的实现缺陷，第一次跑就是红的）

## 4. 接线与常驻化

- [x] 4.1 新 workflow `.github/workflows/schedule-heartbeat.yml`：`schedule` 每日 04:30 UTC + `workflow_dispatch`，
      `ubuntu-latest`、`permissions: contents:read + actions:read`、`timeout-minutes: 10`、跑判据 + 跑锁（`shell: bash` fail-fast）
- [x] 4.2 接进 `ci-failure-handler.yml` 名单（`Gate 2b13` 会验，不靠自觉）
- [x] 4.3 `.gitignore` negation 三个新文件；`check-unwired-tests` 通过（`检查域内测试文件 128 个 … OK`，不新增欠账登记）
- [x] 4.4 全仓 workflow 结构判据 `check-workflow-structure` ⇒ `files=17 violations=0`
- [x] 4.5（补）`quality-gate.yml` 新增 **Gate 2b14**，每次 PR 跑行为锁（零出站、秒级）。
      编号在动笔前按 `git grep -ho "Gate 2b1[0-9]" origin/main` 现读（实得 2b10/2b11/2b12/2b13）⇒ 2b14 未被抢
- [x] 4.6（补）`gate-timeout-registry.json` 新增本格（`seeded`、`samples=0` 是事实：作业一次都没跑过）。
      **顺带量到别家的一处盲区**：`check-coverage-budget.js:239` 的枚举域取自注册表自身的 workflow 列表，
      所以"新增一整个文件而没登记预算"对它结构上不可见；本刀不修它（属改别人的判据），
      只把自己的那一格由 H12 守住，并用 m17/m18 把"两把锁各守哪一半"跑成读数

## 5. 变异反证驱动 `scripts/check-schedule-heartbeat.mutation.js`

- [x] 5.1 靶子四类：判据本体 / 行为锁自身（体检用 `msanity`）/ 两份 workflow / 共享 loader + 预算注册表；
      脏树拒绝、锚点命中恰为 1、`# tests >= 下界`（16 / 13 / 26）、写后回读、还原后重跑被测锁
- [x] 5.2 每条变异指名它要抓的用例；`ALLOWED_MISSED` **留空** ⇒ 本刀不允许任何 MISSED。
      重叠不靠声明：m14 的「H12 与 watch T7 同时红」、m17 的「H12 与 budget T22 同时红」都是当场读数
- [x] 5.3 含：摘 `status=completed` / 摘 `event=schedule` / 阈值去掉 slack / `>` 改 `>=` / cron 推不出时继续往下猜 /
      退出码把 2 并进 1 / 必需字段校验改跳过 / 查询加回 `event` 过滤 / 判据域为空改判 OK / `--limit` 整个忽略 /
      `--limit` 退回只认 `=` 的旧形态 / 摘掉跑判据那一行 / 改 permissions / 名单里改名 /
      `crons` 只取第一条 / 取消块边界 / 预算格 jobId 写错（m17）/ 声明数与登记数分叉（m18）/
      整格未登记（m19，**这条才是本刀补那一格的实测理由**）——共 19 条实现与接线变异 + 1 条驱动体检
- [x] 5.4 `expectGreen` 是**会被驱动否证的声明**：m18 要求 budget 套件照绿（它红了就说明我写的"盲区"结论是假的），
      驱动直接判 PROBLEM 而不是放过
- [x] 5.5 终跑打印 **`SUMMARY CAUGHT=20 MISSED=0 PROBLEM=0 TOTAL=20`** 与 `RESULT=OK`（2026-10-23 本机；活数，引用前重跑），
      三套件收集数逐条打印 `16 / 13 / 26`，读数已写进执行记录

## 6. 收尾

- [ ] 6.1 执行记录 `openspec/records/schedule-heartbeat-lock.md`：QM-5 ①②④⑤ + 行尾两口径 numstat + 现场读数 + `## CHANGELOG 条目`
- [ ] 6.2 QM-6：命中 `.github/workflows/` 与 `scripts/check-` 高危面前缀 ⇒ 按矩阵取 `tier=external` + 可核 `evidence`；
      拿不到工具署名时按先例人工闭环并在记录里明写"由会话手写"（不得冒充工具产物）
- [ ] 6.3 本机门禁批跑（含 `check-record-qm5-rows` / `check-gate-record-debt` / `check-doc-abs-paths` / `--mode=enforce`）
- [ ] 6.4 合并后回读该 merge SHA 的 `quality-gate.yml` push run，读数写进 PR 评论；再按 R1–R7 清 worktree
- [ ] 6.5 首次真跑成功后，把 `schedule-heartbeat` 自己的第一条心跳 run 号补进 PR 评论（证明判据在真环境读得动 GitHub API，
      而不只是在假数据里绿），并把 `gate-timeout-registry.json` 那格按 `gate-timeout-sample.js` 重采升级

## 偏差与理由（不写成"顺手统一"）

① **loader 的 `crons` 锁放在消费方测试文件里**（tasks 1.3 原本读起来像放 loader 自己的档）。
   理由：这条锁的职责是"周期推导的前提成立"，与 H11（真仓每条 cron 都推得出周期）是同一条判据的两半；
   拆到两个文件会让"改 loader 忘了周期"这一类漂移只能靠另一档的驱动去抓，而那档驱动不测周期。
   代价如实记下：`check-schedule-failure-watch.mutation.js`（上一刀的驱动）看不见 m15/m16 这两条针对 loader 的变异，
   所以本刀的驱动把 `WATCH` 也列为靶子文件——两把驱动各管各的靶子集，不假装"那边也会红"。

② **样本数低于下界不改退出码**（design §3 曾写"按未证实出声"）。
   现口径：打印 `thin=t` 出声但**不**判 SCANNER_FAULT。理由：每周作业实测只有 2 条样本，
   把"数据薄"判成"工具失明"会让日巡检每周红两次、并混淆两类不同的修法（前者要等样本攒够，后者要修采集）。
   "数据在、只是少"与"取不到数"必须可区分。design.md 未改写（它是当时的思考记录），以本节为准。

③ **`--limit` 语义定为 smoke 档**：判定只按被限定的那一组算。这与"参数被静默忽略"是两种完全不同的东西，
   所以 H15 同时钉"带 limit 时绿"与"不带 limit 时同一条必须红"两侧，缺后者这条判据就是可被伪装的。
