---
record: ccg-decider-self-artifact
task: 审查模式判定的取证面不再消费判定器自己写下的 .ccg 产物（人工授权改判据本体，第 2 项）
date: 2026-10-20
---

## 本次执行记录：判定器不消费自身产物（分支 ccg-decider-self-artifact，change ccg-decider-exclude-self-artifacts，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 授权来源（为什么这一刀允许动判据本体） | ✅ | 2026-10-20 用户在收尾汇报上明示「第 2、3 条授权你改判据。第5条，选②」。本 change 是其中**第 2 条**（`scripts/ccg-review-decider.js` 的判定面）。改判据属"改谁来守门"，无此授权不动；授权落在仓内而不是只活在对话里 |
| 变更类型与隔离 | ✅ | 动 `scripts/` 工具脚本与 `scripts/*.test.js` ⇒ **混合 PR**（`classify-docs-only` 必为 false），走完整质量节拍；隔离走正规入口 `scripts/start-mp-task.ps1 -TaskName ccg-decider-self-artifact` → `mp-worktrees/mp-ccg-decider-self-artifact`，裸分支同名，依赖 `pnpm install --frozen-lockfile` + `ensure-electron` + `verify-worktree-deps` 全 OK |
| 第一性原因（QM-5 ①） | ✅ | 不是"敏感词表太宽"，而是**取证面把裁判自己的输出当成了被测代码**：`.ccg/reviews/*.json` 是 `.json`，而 `.json ∈ RULES.codeExtensions` ⇒ 产物正文里逐字复述的方案/执行记录/上一次判定理由，同时进**规模**与**敏感内容命中**两维。同一原则本仓已写过一次（`recordFileName()` 注释原话"判定器自己的输出文件不该影响对它的判定"），但只落到了哈希与暂存档，**没落到区间档的取证面** |
| 逃逸分析（QM-5 ②） | ✅ | 五层都没测：单元层用 `makeStaged()` 伪造对象测 `judge()`，伪造件里从来不含 `.ccg`；`collectStaged`/`collectRange` 的真实覆盖只断"能读到变更行"，不断"读到的是谁的行"；结构锁 `check-pr-exec-record.test.js` 反而把"暂存档必须带 pathspec"钉成契约（**锁与缺陷同源，把缺陷声明成受保护形态**）；CI 无这一维；审查层无人看两档分歧。实测两档分歧的存在时间 ≥ 2026-10-15（pathspec 只加在暂存档那一天起） |
| 系统性漏洞（QM-5 ③） | ✅ | 两类叠加：①「测试质量不足」——没有一条锁把"同一份改动两档同判"当作不变量；②「审查盲区」——按源码字面 grep 的锁测的是**机制**而非**意图**，机制一搬走它就变成假红/假绿的来源 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单点谓词 `isSelfArtifact()`（按路径判 `.ccg/`，不按扩展名、不按"文件名像不像产物"）被 `judge()` 的规模过滤、`collectFromDiff()` 的行分流、`isDocsOnly()` 的资格判定三处共调；产物行另归第三类 `ccgChangedLines` 并产出 **report-only** `ccgSensitiveContentHits`（CLI 点名）；`collectStaged()` 两个 stats 参数的 `:(exclude).ccg` 摘掉（留着的实测后果：该计数在暂存档恒 0 ⇒ 观测点只剩单档）。`stagedDiffHash` 那次**独立** git 调用的 pathspec 保留（已读源码确认两处不同调用）。阈值 `200` 与五条敏感词表一字未动 |
| 防止再次发生（QM-5 ⑤） | ✅ | 新能力规格 `openspec/changes/ccg-decider-exclude-self-artifacts/specs/ccg-review-mode-decider/spec.md`（1 条 Requirement + 7 个 Scenario）把三件事写成契约：排除必须同时对规模与内容两维生效、两条采集路径必须同判**且同观测**、同判锁不得单独成立（必须配绝对参考）。既有那条 grep 字面锁按行为改写并**实测有牙**（谓词摘成恒 false 当场红 #56） |
| 取证读数（判据自报，非推断） | ✅ | 两档对照（在飞 PR `#4079` 同一份差量）：区间档 `changedLines=191 fileCount=9 codeFileCount=4 contentHits=3 mode=dual`，暂存档口径 `132 / 8 / 3 / 0 / single`；3 处命中**逐条归属到文件**，3/3 全在 `.ccg/reviews/*.json`，命中词是 proposal 里的「授权」；归属计数与判据自报 `sensitiveContentHits` 相等（不等即不下结论）。面上成本：origin/main 最近 **120 笔**两档各判 ⇒ **44 笔（37%）mode 改变**，迁移分布 `dual→dual 51 / single→single 20 / dual→single 15 / dual→skip 15 / single→skip 14 / skip→skip 5`；"≤200 行因敏感命中 dual"那一类 20 笔的命中行扩展名分布 `{".json":47}`，真实源码 0 条 |
| TDD 与红因见证 | ✅ | 先写 5 条行为锁 ⇒ 红跑在"尚未拆分辨率用例"的版本上：`# tests 57 / # fail 4`，红因逐条核过为"产物仍被计入取证面"（例：`实际 reason=变更 6 行（≤ 200）但命中 auth/数据库/加密：敏感内容 2 处`），非别家失败 ⇒ 实现后 `# tests 58 / # pass 58 / # fail 0`（既有 52 ⇒ 58），并按名字回读通过清单 |
| 变异反证（指名红 + 红集互不相同） | ✅ | **M1** 谓词恒 false ⇒ 5 红；**M2** 谓词恒 true ⇒ 8 红（含绝对参考锁与既有缺陷B两条规模锁）；**M3** 产物行并回 `codeChangedLines` ⇒ 4 红；**M4** 只在采集层排除、`judge` 不排（两维各切一半）⇒ 2 红；**M5** 把 pathspec 加回 `collectStaged` ⇒ 2 红；**M6** 删 `isDocsOnly` 纯产物分支 ⇒ 1 红。**六条红集互不相同（6 把尺子测 6 个格）**，`loadFail=false`，控制跑自带健康断言（`fail=0 && loadFail=false` 才产出 verdict），跑完判据文件 md5 回原值 `f075dcafab` |
| 过程修正一：M5/M6 首跑红集**逐字相同** | ✅ | 根因不是"锁弱"而是**红的粒度是用例名** —— 两种退化撞在同一条用例的不同断言上。正解不是放宽变异，是把"采集面是否收到产物行"拆成**独立用例**；拆后 M5 得 2 红、M6 得 1 红，互不相同。口径：**塞进同一条用例等于没有这把锁** |
| 过程修正二：新用例首跑 `Cannot read properties of null` | ✅ | 夹具在第二次提交前取 `HEAD~1`（base 提交无父）⇒ git 失败 ⇒ `collectFromDiff` 返回 null。那是**探针拿错坐标**，不是判据红。修法：按生产者真实顺序取（先 `git add` 拿暂存档快照 → `commit` → 再取区间档），并加一条 `assert.ok(st && Array.isArray(st.files), …)` 把"探针自身失败"与"判定不通过"分开 |
| 消费者并集（不只跑我改过的文件） | ✅ | `git grep -l ccg-review-decider` 取消费者并集 6 个（4 测试 + 2 shell）并全跑：`ccg-review-decider 58/58`、`check-pr-exec-record 113/113`（**首跑 1 红，见下行**）、`deep-review-deps 35/35`、`plan-review-deps 10/10` |
| 门禁断言随实现迁移同步 | ✅ | `check-pr-exec-record.test.js` 那条「行数统计与 hash 必须同一口径（都排除 .ccg）」是**按源码字面 grep** 的既有锁，本刀摘掉 stats 层 pathspec 后它当场红（#56）。处置不是删锁而是**按意图改写**：判定面那一半换成真调 `judge()`/`isSelfArtifact()` 的行为断言（夹具必须与真实生产者同形——把产物行塞进 `codeChangedLines` 去断言"judge 不看它"是**假不变式**），命名配方那一半保留 grep（那条没迁移，仍必须在，且加"锚点找不到即红"的防静默失效断言）。改写后做变异验证：谓词恒 false ⇒ 该条指名红 |
| QM-6 CCG 双模型外部评审 | PARTIAL（**设计层**单轴已交付并处置） | 评审打在方案本身（不留到 PR 前）。critic=claude（真源 `scripts/ccg-review-backends.list` 第一行）95.6 秒交付 **2 Critical / 2 Warning**，逐条处置**改回方案文本**而非只写记录：C#1「只断两档相等是恒真的」⇒ 补绝对参考锁（写进 design 决策点 3 与 spec Scenario 3）；C#2「暂存档留 pathspec ⇒ 新计数恒 0」⇒ **否证我初稿写的"两处幂等重叠"**，决策点 1 由方案 B 改为方案 C；W#3「计数无消费者 ⇒ 死字段」⇒ 半接受（补 CLI 打印行为锁；拒绝升成阻断判据，证据是既有同构字段 `docSensitiveContentHits` 全仓除打印外零出现，本仓 i3 的既定设计就是面向人的观测点）；W#4 与 C#1 同因 ⇒ 变异清单加 M2/M5 指名要求。proposer=opencode 仍 IP 级封禁 ⇒ 本行**不得**读作双模型通过；实现层（PR 前）的 critic 轴另行派发 |
| 行尾与 diff 对账 | ✅ | 判据、测试、CHANGELOG 全部按**文件自身行尾**写回：`ccg-review-decider.js` `cr==lf==968`、`ccg-review-decider.test.js` `cr==lf==1407`、`check-pr-exec-record.test.js` `cr==lf==2162`；CHANGELOG 以 `HEAD` blob（纯 LF）为底置顶插入，审计五格全真（`titlesPlusOne/crKept/lfDelta/baseTailPreserved/baseFirstTitleAfterBlock`）；每次改动跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径，逐次相等 ⇒ 未改行尾 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |

### 遗留（不假装已闭合）

- **决策层 `plannedPathHits` 仍从散文抽"路径样 token"跑敏感路径规则**：实测 1499 份产物里 1 条命中，命中的是方案正文里的一个正则字面量（`sso/i.test`）。发生率与代价都不支持为它动判定面 ⇒ 留数不修。若哪天它变成常态（比如有人开始在 plan 里点 `crypto/` 路径做讨论），这把尺的读数会先变。
- **`.ccg/` 之外不会出现"自身产物"**：若将来评审链把产物写到别处（如 `openspec/reviews/`），该目录会重新进取证面，而**没有任何东西会因此变红**。谓词是单一出处，改一处即可；但不为"未来的目录布局"预建判据（那是猜需求）。
- **本刀让 `fileCount` 与 `changedLines` 的口径不再同源于 git pathspec**：`fileCount` 现在包含 `.ccg` 文件（它只被打印、不被判定消费），`changedLines` 不含。这不是缺陷，但下一个读 stats 的人可能把两栏当成同一把尺 —— 已在 CLI 打印面把"被排除但仍观测到"的命中单独一行点名。
- **`docSensitiveContentHits` / `ccgSensitiveContentHits` 都没有自动处置消费者**（实测：前者在全仓只出现于判定器自身的 `stats` 赋值与一行 console）。本刀按既有设计保留"面向人"的定位并给它加了打印行为锁；把它升级成阻断判据需要另立 change，且必须先回答"同一份散文一处不消费、另一处拦下来"这个矛盾怎么解。
- **实现层 critic 轴尚未派发**（本表 QM-6 行是**设计层**交付）：PR 前必须对本片自身差量再跑一次 critic 轴并逐条处置；proposer 轴本日仍不可得 ⇒ 按 #3949 既有裁决走"单轴 + 登记活欠账"。
