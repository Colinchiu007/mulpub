---
record: schedule-heartbeat-lock
task: 定时作业的「心跳」锁——抓"根本没有 run"那一类失败（上一刀明确记为遗留的第 1 条）
date: 2026-10-23
---

## 本次执行记录：给定时作业补心跳锁，抓「一次 run 都没有」的那种失败（schedule-heartbeat-lock，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（新增 `.github/workflows/schedule-heartbeat.yml` + 改 `ci-failure-handler.yml` / `quality-gate.yml` / `gate-timeout-registry.json` + `scripts/` 判据本体与其锁与驱动）。入口 `scripts/session-init.sh schedule-heartbeat-lock`，起点 `HEAD == origin/main`，`rev-parse --abbrev-ref HEAD` == 裸分支名。中高风险走 `/opsx` 前置门：`openspec/changes/schedule-heartbeat-lock/{proposal,design,tasks,specs/schedule-heartbeat-lock/spec}.md` 四件齐备后才动手（上一刀 #4234 记的"没建 change 目录"这一偏差，本刀不再重复） |
| 第一性原因（QM-5 ①） | ✅ | 不是"没人看定时作业"，而是**看失败的那条通道在结构上看不到"没跑"**。上一刀（PR #4234）接进的是 `ci-failure-handler.yml` 的 `on.workflow_run` —— 该事件只在**有 run 完成时**才派发。于是四类成因全部落在盲区：cron 写错（GitHub 根本不排，一次 run 都不产生）、作业被删/禁用而定义还在、runner 长期排队永不 completed、仓库迁移后 run 列表与声明错位。共同形状是"Actions 页面一片空白，而所有看失败的机制都在等一个不会来的事件" |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：仓里没有任何东西读 `on.schedule:` 与 run 历史的**时间关系**（`check-schedule-failure-watch.js` 读的是"名单覆盖没有"，不是"跑没跑"）；CI 层：定时作业不产生 PR、不参与 required check；报警层：`workflow_run` 事件源本身缺失（同上一条根因）；审查层：AGENTS 与 learnings 都写过"一个没跑的文件在摘要里与跑了且绿完全同形"（巡检 `collected != candidates` 那次），但那条教训只落进了**巡检类**判据，没有落到"定时作业健康"这一面 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=流程缺失 + 测试场景缺失：仓里已有三类"清单与真源对账、登记项只能缩小"的先例，本刀补的是它们共同缺的那一维——**存在性判据（有没有被覆盖）与活性判据（有没有真的执行）是两把不同的锁**，前者上一刀做了、后者没人做。同族第二条再次实测命中：判据若按"扫到了什么"迭代，就永远看不见"该有什么"（本刀由 m19 在**别人家的判据**上量到一次，见「变异反证」行末与遗留 6） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 周期由 cron 自己推：给共享 loader `loadWorkflows` **只增一个字段** `crons:[string]`（`scheduled/hasCron/runList/name/file` 语义逐字不变，既有 13 条锁照旧全绿），新判据 `scripts/check-schedule-heartbeat.js` 复用同一份 loader，**不写第二份手抄清单**——那正是上一刀要消灭的形状；`periodFromCron` 只认 daily/weekly/monthly 三种形状，其余返回 null 落 `SCANNER_FAULT`（禁止"未知就当 daily"：猜成 daily 会让周报天天假红，猜成 weekly 会让日报漏三天才响，两个方向都错且不可归因）；多行 cron 取最短周期。② 阈值 = 周期 + 宽限（默认 8h，`MP_SCHEDULE_HEARTBEAT_SLACK_HOURS` 可覆盖，非法值回落**并 warn 出声**），**不是周期 ×2**——实测最大相邻间隔只有周期 ×1.04，而 run 起跑时刻相对 cron 可漂 5.68h（GitHub 排队是常态不是抖动），×2 等于把"漏一天"的发现推到第三天。③ 四档 `OK/LATE/NEVER_RAN/SCANNER_FAULT` + 三档退出码 0/1/2 不合并（`2` 优先于 `1`）；采集由调用方注入 ⇒ 判据本体零出站；真采集器 `makeGhCollector` 的查询里**刻意不带 `event=schedule`**（带了判据侧的 event 过滤就是死码，且丢掉"只有 push run"这一现场信息），repo 与文件名都要过正则才拼进 API 路径。④ 行为锁 `scripts/check-schedule-heartbeat.test.js` **16 条**（H1-H16）：合规绿控、边界差 1 秒翻转、NEVER_RAN≠SCANNER_FAULT 的双档对拍、别的 event / 别的 status 两条反例夹具、cron 四种推不出的形状、env 四种非法取值 + 一条生效档、provenance 与安全倍数、真仓规模下界（≥4 条且每条都推得出周期）、接线锁（剥掉注释后要求判据与行为锁被点名 + 名单在册 + 预算格登记数==声明数）、采集器 argv/字段缺席/文件名不合一次都不发、`--limit` 两种写法与五类非法参数、判据域为空。⑤ 接线：新作业每日 04:30 UTC + `workflow_dispatch`（`ubuntu-latest`、`permissions: contents:read + actions:read`、`timeout-minutes: 10`、`shell: bash` fail-fast），名单进 `ci-failure-handler.yml`（由 Gate 2b13 机械逼出），行为锁另在 `quality-gate.yml` 新增 **Gate 2b14** 每次 PR 跑一遍——否则"锁不被拆"唯一的见证渠道就是日巡检本身，而"日巡检根本没跑"正是本判据要抓的那类失败；预算格进 `gate-timeout-registry.json`（`seeded`、`samples=0` 是事实：登记时该作业一次 run 都还没有） |
| 变异反证 | ✅ | 驱动入仓 `scripts/check-schedule-heartbeat.mutation.js`，四靶子（判据本体 / 行为锁自身 / 两份 workflow / 共享 loader + 预算注册表）+ 三套件对照，终跑 **`SUMMARY CAUGHT=20 MISSED=0 PROBLEM=0 TOTAL=20`**、`RESULT=OK`（活数，引用前重跑）。`ALLOWED_MISSED` **刻意留空** ⇒ 本刀不允许任何 MISSED。三条现场收获，每条都是一次被打脸：① **m12 首跑 MISSED**——我把接线锁写成"文件里有没有 `check-schedule-heartbeat.js` 这个串"，而该文件第 38 行的**解释性注释**里原样写着脚本名（说明 20 秒采集上限归属），摘掉真 run 那一行照样绿 ⇒ 这是 AGENTS「禁令与存在性判据必须按语义位置切 / 注释对门禁算正文」的第三次实测复发。正解是剥掉注释行再匹配**执行体完整形态**，改后 m12 CAUGHT，而"只在注释里出现"自动成了那条必需的绿控。② **m18 首跑 PROBLEM**——我声明"数字漂移只有 H12 看得见、Gate 2b7 照绿"，驱动的 `expectGreen` 当场把这句否证（budget 用例 22 一起红）；改成如实的"两边都红"，并把真正的盲区挪到 m19：**整格未登记**时 Gate 2b7 照绿（它的枚举域取自注册表自己的 workflow 列表，`check-coverage-budget.js:239`），m19 实测红集只有 H12。③ m3 的红集含**未预期但红**的 H2/H7（阈值去掉 slack 同时打断 LATE 判定与最短周期），如实打印不认领为"设计如此"。另 `msanity` 把行为锁自己的一个期望值改成明显错的数（`阈值_hours=99.0`）⇒ 必须红，它测的不是锁的牙，是驱动有没有真的在读 TAP |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 心跳作业**自己也是被同一判据守的定时作业**，且它的名字必须由 Gate 2b13 的名单不变量兜住 ⇒ 两把锁互咬（m14 实测：把名单里的名字改掉，本刀 H12 与上一刀 T7 **同时红**，各红各的、不互相顶罪）；② "存在性 ≠ 活性"这一维从散文教训变成机械判据（四档出口 + 三档退出码 + 域为空单列），下一个加定时作业的人不需要记得任何事，漏跑会被日巡检点名；③ 周期由被描述物自己给，判据与夹具里都没有第二份作业名枚举；④ 出处 `HEARTBEAT_PROVENANCE` 带 `remeasure` 命令字符串与逐作业样本量，monthly 明确进 `unmeasuredKinds`（31 天是保守上界、无实测样本），"量过一次之后没人再量"这一类由 H10 钉住；⑤ 行为锁每次 PR 跑（Gate 2b14）、线上读数每日跑——分档理由与预算依据写进 workflow 头部注释，不靠临场判断；⑥ 接线判据一律"剥注释 + 匹配执行体完整形态"，这条从散文变成 m12 这条实测红过的变异 |
| 行尾与 diff 对账 | ✅ | 四处 CRLF 面改动（`ci-failure-handler.yml`、`quality-gate.yml`、`.gitignore`、`scripts/gate-timeout-registry.json`）全部用"按当场 eol 逐行写回"的脚本插入，未统一回写；脚本先算 cr/lf 并要求"每个 CR 紧跟一个 LF"，不合预期直接拒绝动手（本仓第 4 次孤立 CR 的成因就是给末行补结尾 CR）。净差量：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐文件相等**（handler 1/0、quality-gate 13/0、.gitignore 3/0、loader 27/0、registry 1/0），删除数 0；五份档当场读作 `i/lf w/crlf attr/text=auto`。新建四个文件（workflow、判据、锁、驱动）写成 LF——同仓既有惯例（新建 JS/MD 多为 LF），且 H12 读 workflow 时先 `.replace(/\r\n/g,'\n')` 再匹配，否则同一份文件在"检出成 CRLF 的机器"上会假红。一处**自己制造又自己修掉**的假损坏：给 registry 插格时忘了行尾逗号，`JSON.parse` 当场抛（脚本是"先写盘再 parse"，顺序错了）——修法是补逗号并让驱动对 `.json` 靶子加一道"变异后必须仍可 parse"（m19 的 drop-line 走的就是这条） |
| QM-1 打包 / QM-4 视觉 | N/A | 差量文件集实测只有 `.github/workflows/{schedule-heartbeat,ci-failure-handler,quality-gate}.yml`、`scripts/check-schedule-{heartbeat,failure-watch}{,.test,.mutation}.js`、`scripts/gate-timeout-registry.json`、`.gitignore`、`openspec/` 四件与本记录 —— 不触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | **一轮真外部交付 + 逐条裁决，已闭合** | head `ef736ed7`、基线 origin/main（引擎打印差量 1723 行）、critic=`claude` 真跑并交付 **7 条**问题、proposer=`opencode`（跨家族校验通过）；进入裁决 4 条（i1-i4），**高危域需外部复核 0 条**（本轮 `requiresExternalReview=[]`）。逐条 prosecution/defense/verdict/rationale 公开副本：`PR #4305#issuecomment-6357346843`；裁决全部 **dismissed** 且每条给可重取反证（i1：按判定器自身配方重跑 `git diff --no-textconv --no-ext-diff --no-renames 451320a14 ef736ed7 -- . :(exclude).ccg`＝85872 字节，其 sha256 与产物文件名逐字相等 ⇒ "键未与当前 diff 对齐"被否证；i2：空域与 limit 档的读数在判定词/退出码/明细三处都不同，`--limit 0` 根本构造不出来；i3：registry 实测是 **CRLF**（cr=34/lf=34），"目标是 LF 故未触发"的前提不成立，而 m19 正是在该文件上 CAUGHT；i4：出处日期每次随读数打印，按日历强制时效会把锁自己变成 aging 引信）。终跑 `♻ 复用存档 critique（7 条）+ 已填完的裁决 —— 跳过模型调用` ⇒ `✅ 自扮演裁决未发现阻断项`，产物由**工具自己**写成 `status=self_play_resolved / blocking=[] / performedBy=self-play` |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

### 现场读数（全部当场重取，活数）

- 行为锁：`node --test scripts/check-schedule-heartbeat.test.js` ⇒ `# tests 16 / pass 16 / fail 0`
- 增量不破坏：`node --test scripts/check-schedule-failure-watch.test.js` ⇒ `# tests 13 / pass 13 / fail 0`
- 覆盖面判据（真仓，注入式、不打网络）：`SCHEDULE-WATCH … workflows=17 scheduled=5 list=10 未覆盖=0 陈旧名单项=0 形状可疑=0 判定=OK`，
  scheduled 集合 = `Cleanup Artifacts | 时钟位移引信巡检 | 依赖漏洞审计门禁 | 定时作业心跳巡检 | Sidecar Parity (cross-repo)`
- 心跳判据对真仓的周期推导（注入 runsOf，零出站）：`period=daily/daily/weekly/weekly/daily`，阈值 `32.0/32.0/176.0/176.0/32.0` 小时，全部可推导；
  fail-closed 档实测：无 `GITHUB_REPOSITORY` ⇒ `SCANNER_FAULT 采集器不可用 … rc=2`（不猜 repo）
- 变异驱动：`SUMMARY CAUGHT=20 MISSED=0 PROBLEM=0 TOTAL=20 / RESULT=OK`（四靶子 + 三套件对照；活数，引用前重跑），
  三套件收集数逐条打印 `16 / 13 / 26`
- workflow 结构：`[workflow-structure] files=17 violations=0`；步骤 fail-fast：`含 ≥2 条受管命令的 run 步骤：43 个 … OK`
- 未接线测试：`检查域内测试文件 128 个 … OK: 全部测试均已接线或按欠账登记`（新锁经 Gate 2b14 接上；`.mutation.js` 不在扫描域，追踪证据由上一刀的 T9 那类锁与本记录承担）
- 预算注册表：`check-coverage-budget.js` ⇒ `OK 全部 25 格与注册表同源、都满足规则①，且清单棘轮通过`，本格读作 `schedule-heartbeat.yml#schedule-heartbeat [seeded] timeout=10 需≥0 余量=10 分 samples=0 collected=2026-10-23 age_days=0`；它的锁 `# tests 26 / pass 26 / fail 0`
- 其余本机门禁（各跑一次、逐个 rc=0）：`spec-purpose 扫描 154 份主规格，违规 0`｜`openspec-sync OK: 387 tasks, 98 active changes, 243 archives`｜`spec-mirror pass 8`｜`microtask-spin 扫描 1627 个测试文件，0 处自旋`｜`egress-guard 测试面=18 已接守卫=14 欠账=4/4 PASS`｜`text-encoding 无新增损坏（存量 2 个历史 .ccg 归档文件已登记）`｜`changelog-growth PASS base 598→head 598`｜`gate-record-debt OK`｜`qm5-rows OK（检查域内记录 352，未登记缺行 0）`｜`doc-abs-paths PASS（counts=1161 files=561，本 PR 净增 0）`｜`no-brand-residue PASS（12022 个 tracked 文件）`
- QM-6 第一轮（真外部 critic=claude）：`♻ 复用存档 critique（7 条）+ 已填完的裁决 —— 跳过模型调用` ⇒ `✅ 自扮演裁决未发现阻断项`；
  产物由工具写成 `status=self_play_resolved blocking=[] performedBy=self-play findings=4`；
  写回工具在场拒写并出声：`[ccg-review-writeback] 未写回 reason=backend-mismatch spoke=closed-status|findings-present|nonempty-findings detail=performedBy="self-play" 期望 "claude"`
- 收口判据（本地 enforce）：`TIER-COVERAGE dual-closed total=1 external=1 external-unverified=0 self-play=0 none=0 unknown=0 unrecognized=0`、
  `TRANSITION-CHECK 转变=无转变 扫描域=1 已核对=0 无出处=0 未证实=0`、`OK: 本 PR 携带执行记录或带原因的豁免` ⇒ rc=0
- 阈值依据的取数命令（可重跑，也写进 `HEARTBEAT_PROVENANCE.remeasure`）：
  `gh api "repos/<repo>/actions/workflows/<file>/runs?per_page=100" --jq "[.workflow_runs[]|select(.status==\"completed\")|.created_at]"`；
  2026-10-23 实测：cleanup 20 样本 / 最大间隔 1.04× / 最大漂移 +5.68h；dep-audit 4 / 1.00× / +5.13h；sidecar 4 / 1.00× / +2.45h；clock-shift 2 / 1.00× / +3.15h

### 遗留（不假装已闭合）

1. **心跳判据的线上首读尚未发生**（tasks 6.5）：本记录里所有"真仓"读数都是**注入式**的，`gh api` 那条路只在 CI runner 上第一次真跑。
   合并后要回读 `schedule-heartbeat` 自己的第一条 run 号并把读数贴进 PR 评论——判据在假数据里绿不等于它读得动线上 API。
2. **`queued`/`in_progress` 卡死没有独立判据**（proposal「不在范围」）：本刀只覆盖到"永远不完成 ⇒ 没有 completed run ⇒ NEVER_RAN"，
   "排队卡了 10 小时"需要另一把读 `status` 的锁和新的实测分布（现在只有 4 条作业、每周作业仅 2 个样本）。
3. **weekly 的余量只有 0.73%**：`604800 + 28800 = 633600`，而 `1.04 × 604800 = 628992`。这条写在 `HEARTBEAT_PROVENANCE` 与 design §3 里，
   意思不是"已经稳了"，而是**每周作业对调度漂移最敏感**：第一次真红要先按 `remeasure` 重取分布再决定抬 slack，不得直接放宽判据。
4. **monthly 的 31 天是未实测的保守上界**（provenance 的 `unmeasuredKinds`）：仓里目前没有月度作业，这一档既没被真数据验证过也没被否定过；
   等第一条月度作业出现时按同一条 `remeasure` 补样。
5. **`--limit` 是 smoke 档、不是抽样判据**：判定只按被限定的那一组算（H15 钉），所以拿 `--limit 2` 的绿去宣布"全部有心跳"是本刀要防的那类误读，文案里不要这样用。
6. **Gate 2b7 有一处不是我家的盲区，本刀不修**：`check-coverage-budget.js:239` 的枚举域取自**注册表自己的 workflow 列表**，
   所以"新增一整个 workflow 文件而没登记预算"对它不可见（m19 实测：删掉整格 ⇒ 它照绿，只有本刀 H12 红）。
   修法应是把域换成 `.github/workflows/*.yml` 目录枚举再与注册表对账，但那属改别人的判据（且会牵动它自己的 26 条锁），
   留给下一次；本刀的处置是"把自己那一格由 H12 守住"，并把这条按现坐标登记在此。
7. **预算那格还是 `seeded/samples=0`**：第一次真跑后 30 天内（`seededGraceDays`）必须用 `scripts/gate-timeout-sample.js` 重采并如实升级，
   否则 `SEEDED_EXPIRED` 会自己红——这是设计好的引信，不是待办的装饰品。
8. **评审链的互斥（本刀新量到的第二个门牌号）**：`tier=external` 由工具署名这件事，只要收口来自自扮演出口就拿不到 ——
   本刀的现场是 `reason=backend-mismatch`（`performedBy="self-play"` 期望 `"claude"`），#4234 的现场是 `reason=not-closed`（有 upheld ⇒ `self_play_blocked`）。
   两条合起来说明"署名者必须等于 critic"这一格与"第三档出口"结构性互斥，不是某一次的偶发。另立一刀处理（改的是"谁来守门"，须人工过目）。
9. **drop-line 锚点的声明期检查未加**（QM-6 第一轮 i3 指向的加固方向）：现在靠运行期计数闸兜住
   （"删掉的行数不是 1 就 PROBLEM + 立即还原"，`check-schedule-heartbeat.mutation.js` 的 drop-line 分支），
   出声是一条变异之后而不是零条。不随本刀改的理由写在 i3 的裁决里：评审已在本 head 上跑完，动代码会让结论与产物脱钩。
10. **provenance 没有时效判据**（QM-6 第一轮 i4 指向的那一半）：`measuredAt` 每次随读数打印，但没有任何东西在"过期"时出声。
    要补必须**同一次**补上"谁来重采"的执行体（`gate-timeout-sample.js` 的同类），否则只是给锁装日历引信而不接雷管。

## QM-6 处置（跑完后逐条写在这里；本轮跑的是哪条链、后端是谁、存档在哪，都要写清）

### 第一轮（也是唯一一轮真外部交付）：head `ef736ed7`，critic=`claude`

- 链：`sh scripts/deep-review.sh`（决策层命中内容寻址键 `b80b75da`，未用 `--critic` 覆盖 ⇒ 后端取仓内清单 `scripts/ccg-review-backends.list`）。
- 存档：`.adversarial/ccg-deep-ef736ed7/`（`critique-v1.md` / `adjudication.json` / `family-snapshot.json`）。
  ⚠ 该目录被 `.gitignore` 忽略 ⇒ 克隆主干的人读不到这三份；逐条裁决的**公开副本**在
  `PR #4305#issuecomment-6357346843`（critic 原文 7 条未改写 + 4 条裁决全文），出处不靠本机路径成立。
- 裁决 4 条全部 `dismissed`，每条的 defense 都给的是**可重取的命令或现场读数**，不是形容词；逐条内容与本行上方表格一致。
- `requiresExternalReview=[]` ⇒ 本轮没有高危域标签（指控文本没触发 `auth`/`crypto` 那一族正则），
  所以"外部复核三格"那条形成本轮未遇到；遇到的时候按 #4234 的先例填 `performedBy/evidenceRef/reviewedAt`。

### 工具署名那一格：本轮**实测拿不到**，且拿不到的原因与既有记录不同

`scripts/ccg-review-writeback.js` 在场拒写并出声：

```
[ccg-review-writeback] 未写回 reason=backend-mismatch
  spoke=closed-status|findings-present|nonempty-findings
  detail=performedBy="self-play" 期望 "claude"
```

也就是说：**五条合取里前三条都成立了**（闭环 status / findings 非空 / 动手前后都变了），挡它的是"署名者必须等于清单里的 critic"这一条 ——
而收口来自引擎第三档出口（自扮演裁决），署名只能是 `self-play`。这与 #4234 记下的 `reason=not-closed`（有 upheld ⇒ `self_play_blocked` ⇒ 拒写）
是**同一堵墙的第二个门牌号**：那一刀卡在"状态不闭合"，这一刀四条全 dismissed、状态闭合，仍然卡在"署名不是外部后端"。
合起来就是：**只要收口走自扮演出口，`tier=external` 就永远由不了工具**，无论裁决结果如何。
这一条已单独立刀（见遗留 8），本 PR 的处置是：`tier`/`evidence`/`closureNote` 三格由会话**按事实手写**并在 closureNote 里逐字声明，
`status`/`blocking`/`findings`/`externallyReviewed` 保持工具写的那一档不动（改这三格就是把工具的结论换成我的话）。

手写的那三格描述的是什么，写清楚以免被读成自证清白：**critic=claude 确实真跑了这份载荷**（评论第一部分就是它交付的 7 条原文），
所以 `tier=external` 指的是"载荷被外部模型审过"这件事；裁决那一档是自扮演，产物里 `performedBy=self-play` 原样保留，没有冒充外部裁决。

## CHANGELOG 条目

# feat(ci): 定时作业补上「心跳」判据——抓"一次 run 都没有"的那种失败（schedule-heartbeat-lock）

- 新增每日巡检作业「定时作业心跳巡检」：每条声明了 `on.schedule:` 的工作流都会被告警——不是"跑失败了"，
  而是"根本没跑"（cron 写错、作业被删或禁用、runner 长期排队）以及"跑迟了"。迟到阈值取周期 + 8 小时宽限，
  可用 `MP_SCHEDULE_HEARTBEAT_SLACK_HOURS` 覆盖；写错值会回落并打印告警，不会静默。
- 「没跑过 / 跑迟了 / 判据自己取不到数」是三个可区分的出口（退出码 1 / 1 / 2）：取不到数一律按未证实出声，
  绝不被读成"那天真的没跑"，也不会被读成"全部正常"。
- CI 失败自动报警的名单新增这一条作业；定时作业"是否被报警覆盖"与"是否真的按时跑过"由两把锁互相咬住，
  任一把漂了都会在 PR 侧当场红。
- 行为锁每次 PR 都跑（`quality-gate.yml` 新增 Gate 2b14），线上读数每日跑；新作业的预算格进全仓超时注册表。

## learnings

### lesson: 接线判据按"串在不在文件里"切，会被自己写的注释顶罪

**现场**：`SUMMARY … MISSED=1` 里那条是 m12（摘掉心跳作业里 `run: node scripts/check-schedule-heartbeat.js --explain` 那一行），
而 H12 的断言是 `txt.includes('check-schedule-heartbeat.js')`。该文件第 38 行的说明注释里原样写着这个脚本名（解释 20 秒采集上限的归属），
于是摘掉执行体之后串还在、断言照绿。`grep -na "check-schedule-heartbeat" .github/workflows/schedule-heartbeat.yml` 三条命中，
一条注释两条执行体——这句话本身就是可重取的坐标。

**根因**：文件级存在性判据测的是"这个串有没有出现过"，而风险是"这条命令有没有被执行"。注释对扫描器算正文，
而它对语义什么都不算。同族第三次复发（前两次：CSS 注释里的 `<UiButton>` 命中"用了必须 import"的合同、结构锁被自己解释注释里的 `Math.random()` 命中）。

**可复用的 3 条**：

1. 写"接线在位"类判据时，先剥注释行（本仓既有 `strip` 惯例：`split('\n').filter(l => !/^\s*#/.test(l))`），
   再按**执行体的完整形态**匹配（`node scripts/x.js` 而不是 `scripts/x.js`）——串越完整，注释越难顶罪。
2. 每条禁令都要配两条用例：一条取被禁形态本身（写回错误形态必红），一条**只在注释里出现该串**（注释必须放行）。
   只有前者的话，判据会因为别的原因红而被当成"有牙"；只有后者的话，它根本没牙。
3. 变异驱动是这类判据的体检仪：m12 那条 MISSED 不是"测试写多了"，而是唯一一次把"我以为我在守什么"和"我实际在守什么"对账的机会。
   MISSED 出现时先去查判据的作用域，别先给它的靶子加豁免声明。

### lesson: 给驱动加一条"某套件必须保持绿"的声明，它就会来打我的脸

**现场**：我写 m18 时说"登记数与声明数分叉只有本刀的 H12 看得见，Gate 2b7 照绿"，并把这句写成驱动里的
`expectGreen: ['check-coverage-budget.test.js']`。驱动跑出来是 **PROBLEM：声明应保持绿的套件红了**（它的用例 22 一起红）。
也就是说我那句"盲区"结论在**数字漂移**这一档是错的；真正的盲区在另一档——**整格未登记**（m19 实测：删掉整行后
Gate 2b7 照绿，红集只有 H12），因为它的枚举域取自注册表自己的 workflow 列表（`check-coverage-budget.js:239`）。

**根因**：我把"这个门禁看不见 X"写成结论时，依据是读了它的枚举来源那一行，而没有实测 X 的三种形态各自会不会被看见。
"看不见未登记的新文件"与"看不见数字漂移"是两件事，共用同一条代码事实却有不同的可观测结果。

**可复用的 3 条**：

1. 任何"某某门禁看不见这件事"的断言，都要拆成**具体形态清单**逐个实测；只测一种就推广，等于拿一个观测当定律。
2. `expectGreen` 这类"必须照绿"的声明比 `expect 红` 更值钱：红是预期的，绿才是区分度。驱动把它做成
   否证即 PROBLEM（而不是"少红一条也算过"），才逼出了这次改正。
3. 被自己的工具否证时，把**原判断和被否证的事实一起留在记录里**（本条就是），别只写改后的结论——
   下一个读者需要知道哪一半是量出来的、哪一半曾经是想当然。
