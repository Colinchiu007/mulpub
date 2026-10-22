---
record: schedule-watch-doc-count
task: 把 Gate 2b13 那把锁自己的注释里被否证的事故数字改准（"连红 8 天" → "连红 9 次定时 run"），并给动因那段补上取证指针
date: 2026-10-23
---

## 本次执行记录：改准注释里的事故数字，并把出处集中到一处（schedule-watch-doc-count，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`.github/workflows/` ×2 + `scripts/` 判据本体与行为锁 ×2，全是**注释/文档行**）。入口 `scripts/session-init.sh schedule-watch-doc-count`，worktree `mp-schedule-watch-doc-count`、裸分支同名；起点 `HEAD == origin/main`（#4234 的 squash 落点 `6f9467cef`） |
| 第一性原因（QM-5 ①） | ✅ | 引入点就是上一刀我自己：#4234 把执行记录里的"连红 8 天"按 `gh run list` 改成了"连续 9 次定时 run"（QM-6 第一轮 i6 命中），但**同一个数字还抄在这把锁的四处注释里** —— 两份 workflow 的动因说明、`check-schedule-failure-watch.js` 头、`…test.js` 头。根因不是"忘了改"，是**改的时候只把注释当作非事实文本**：仓库里没有任何东西在校验注释中的事实断言，所以"记录改准了、注释没改准"在机械上不可见（当场 `git grep -na "8 天"` 才数出来 5 处，含 1 处另一种写法"连续 8 天全红"） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：本刀的判据测的是名单与触发器形状，不测注释文本；CI 层：`check-text-encoding-integrity` / `check-doc-abs-paths` 管编码与路径，不管事实；审查层：QM-6 四轮都在读 diff，而这 5 行注释在 #4234 里是**新增**文本、当时还没被否证（否证发生在同一次评审中，改的是记录不是那几行）；结论层：没有任何一条锁会去比对"记录里的事故读数"与"注释里的事故读数" |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 5 处一次改准：`ci-failure-handler.yml`、`quality-gate.yml`（动因两处）、`scripts/check-schedule-failure-watch.js`、`…test.js`；② **不把 run 号抄进四个文件**，而是给出处集中到动因那一行并加指针（「取证链见 `openspec/records/schedule-failure-watch.md` 与 PR #4234」）—— 抄四份就会有第四份漏改的那天，那正是本刀立项要防的那类漂移；③ 收口判据是**当场重扫**而不是记忆：`git grep -na "8 天"` 在本 PR 改动集内 0 命中（全仓其余命中属无关语境，逐条看过，见下方"残留清点"）；④ 回归保护：`node --test scripts/check-schedule-failure-watch.test.js` → `# tests 13 / pass 13 / fail 0`，`node scripts/check-schedule-failure-watch.js` → `list=9 未覆盖=0 判定=OK`（改的是注释，两条都必须照旧绿 —— 注释一改就红说明动到的是被机械读取的文本） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 这条被写进 `## learnings`：**事故数字一旦同时落在"记录"和"代码注释"两处，改的时候必须一次改完**，且当场 `git grep` 数一遍而不是凭记忆；② 指针化（注释指向记录，记录指向 run 号）而不是复制化，使"改一处忘三处"从 5 个落点降到 1 个真源；③ 不做的事：不为这几行注释新加一条"注释与记录对账"的门禁 —— 那是把一次性纪律做成常驻判据，成本与收益不匹配（登记在本刀遗留第 2 条，留给真出现第二次事故时再定） |
| 行尾与 diff 对账 | ✅ | 本仓 workflow blob 是**混行尾**（`ci-failure-handler.yml` 末行不带 CR），所以禁止 split/join 重建：一律在原串上做**行内**替换，写前断言锚点命中恰为 1、目标文本命中为 0，写后断言 `CR`/`LF` 计数与原文逐字相等、长度增量恰等于 `to.length - from.length`。两口径 numstat 相等：`ci-failure-handler.yml 1/1`、`quality-gate.yml 2/2`（**PR 净差量**，不是逐笔提交相加 —— 动因两处改在同一行区间，落进一笔 squash 就是 2/2）、`check-schedule-failure-watch.js 1/1`、`…test.js 1/1` |
| 接线棘轮 | ✅ | 本刀未新增测试文件；`scripts/check-schedule-failure-watch.test.js` 已在 `quality-gate.yml` 的 `Gate 2b13` 显式点名（上一刀接的） |
| QM-1 打包 / QM-4 视觉 | N/A | 差量只有 4 个文件的注释行，不触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | 已跑一轮真外部评审并逐条处置（mode=**single**：`变更 10 行（≤ 200）且无敏感命中 → 走 §12.6 常规专家分派`） | `sh scripts/deep-review.sh`（critic=claude，基线 origin/main 138 行）产出 6 条问题、待裁决 5 条、**高危域 0 条**；逐条 `prosecution/defense/verdict/rationale` 落在 `.adversarial/ccg-deep-b2891094/adjudication.json`（该目录被 `.gitignore` 忽略，故公开副本就是本 PR 的评论）。处置：**i4 upheld**（注释细节层级不一致 ⇒ 采纳"出处集中一处 + 留指针"，已落地）；**i1/i2/i3/i5 dismissed** —— i1/i5 说统计与 sha 对不上，实际 `changedLines=10 / fileCount=4` 与那笔提交的 numstat 逐项相符（判定产物自身那 57 行不在计数里），sha 是父提交属 pre-commit 的既定形状（本仓第 4 次收到同一条）；i2 说"未经验证的事实替换"，取证是 `gh run list`（最后一次绿 `38239617921`@2026-10-12T10:58:05Z，第一次红 `38385152658`@2026-10-13T10:42:02Z，连续 9 次失败），不成立，但其"出处在工作区读不到"那一半采纳为 i4 的指针。判定产物 `936e5f9d…json` 停在 `self_play_pending`：本刀 mode=single，不在 dual 欠账评估范围内（`evaluateDeepReviewDebt` 对 `mode!=='dual'` 直接 continue），所以这不是绕过，是同一条已登记缺陷（缺陷 G）的第 N 次显形 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

### 残留清点（"扫到 0"必须先证明扫的是对的域）

- **被修的那四个文件**（判据本体 / 行为锁 / 两份 workflow）内 `git grep -na "8 天"` = 0 命中，当场重跑读数 `命中行数=0`。判据域只写这四个文件，不写"本刀改动集"：本记录与 CHANGELOG 条目要描述"把 8 天改成 9 次"这件事，必然逐字引用那个旧串，写成"改动集内 0 命中"就是一条自指必假的判据（AGENTS 记过同型：门禁扫的是文件，注释对它而言就是正文）。
- 全仓 `git grep -na "8 天"` 仍有多处命中，逐条看过均为**无关语境**，不改：`01-docs/retros/retro-2026-07-14.md`（连续提交天数）、`.quality-gates.md:11086/11470`（旧载体里其他记录里的夹具天数与一条 18 天缺陷）、`01-docs/learnings.md:21200`（漂移文件已存在 8 天）、`01-docs/PLAN-PUBLISH-FREQUENCY-POLICY-V2-2026-10-10.md`（`2^31-1` ≈ 24.8 天）、`.adversarial/*`（本机工作产物、被 git 忽略的那部分历史提案）、`01-docs/research/*`、`AGENTS.md`（外部键条目里无关）。
- 归档快照 `openspec/changes/archive/**` 未扫：历史事实不改写。

### 现场读数（引用前先重跑，都是活数）

- `node --test scripts/check-schedule-failure-watch.test.js` → `# tests 13 / pass 13 / fail 0`
- `node scripts/check-schedule-failure-watch.js` → `workflows=16 scheduled=4 list=9 未覆盖=0 陈旧名单项=0 形状可疑=0 判定=OK`
- `node scripts/deep-review.sh`（mode=single）→ `评审完成：6 条问题 … 最低分 3`、`待裁决 5 条；其中高危域必须外部复核 0 条`、`裁决未填写 … status 记为 self_play_pending`（填完裁决后由本记录留公开出处）

### 遗留（不假装已闭合）

1. **判定产物停在 `self_play_pending` 这一格没被消掉**：本刀是 single，不在 dual 欠账评估范围内，所以合并不欠账；但"mode=single 的产物可以永远 pending 且不报错"正是缺陷 G 的形状，修法在写入方（decider 把高危路径判成 dual），而那会把 DUAL 钩子的 23–40 分钟加到每次小改动上，属"谁来守门"，须人工过目。
2. **没有为"注释里的事故数字"加锁**。本刀的收口手段是人当场 `git grep`；把它做成常驻判据需要定义"哪条注释在引用哪条取证"，那是一套新的元数据约定，成本大于收益（同一份注释第二次被写错时再评估）。
3. `01-docs/learnings.md` / `CHANGELOG.md` 由聚合器在发版时搬运，本刀不直接编辑（`Gate 2b9` advisory 会按 PR 差量点名）。

## CHANGELOG 条目

# docs(ci): 定时作业报警那把锁的注释改准 —— 连红 9 次定时 run，并把取证指针集中到一处（schedule-watch-doc-count）

- 现场：#4234 把执行记录里的"连红 8 天"按 `gh run list` 重取改成"连续 9 次定时 run"（run `38385152658`…`39570873661`，最后一次成功 `38239617921`），但同一个被否证的数字还抄在这把锁自己的 5 处注释里（两份 workflow 的动因说明、判据本体头、行为锁头）。注释里的事实断言也是断言：下一个读这段动因的人无法分辨哪一份是被推翻的旧值，而这几行文字唯一的用途就是把根因说准。
- 修法：5 处一次改准；run 号只留在动因那一行并显式指向取证所在（`openspec/records/schedule-failure-watch.md` 与 PR #4234），**不把出处抄四份** —— 多份副本正是本刀立项要防的那种漂移。
- 附带一条工程口径：本仓 workflow blob 是混行尾，所以任何"改几行文字"都必须做**行内**替换并断言 CR/LF 计数不变，禁止按多数派探测行尾后统一回写（那会把每次 diff 变成整文件重写）。

## learnings

### lesson: 事故数字改了记录，就必须当场把同一句话在代码注释里的副本一起改（schedule-watch-doc-count）

一份被评审否证的事实（"连红 8 天"，实测是连续 9 次定时 run）通常只被改在**执行记录**里，因为改的时候注意力在"记录"这张表上。但同一句话常常还躺在代码注释里 —— 本刀现场有 5 处、两种写法。后果不是"难看"：注释是这段判据唯一的"为什么"，读到旧值的人会以为事故只有 8 天，从而把修复的紧迫性判低一级，或者在下次写同类动因时**照抄那个旧数**。

三条可复用口径：① 改事实的当下就 `git grep -na "<旧串>"` 数一遍全仓（含 `-a`，历史文档含 NUL 会被 grep 当二进制静默跳过），改动集内求 0 命中，全仓其余命中**逐条看过并注明为何不改** —— 只报"改完了"就是把没扫当扫过；② **出处集中一处 + 留指针**，不要把 run 号之类取证细节抄进每个落点（抄四份就会有第四份漏改的那天）；③ 注释改动后必须重跑该文件自己的判据与锁（本刀 13/13 与 `判定=OK`），"改注释不该影响行为"这句话只能作为**期望**，不能作为**证据**。
