---
record: lock-timing-audit-coverage-domain
task: 把 Windows 锁预算复测脚本的采样域从"只认 QG Desktop Shards"扩到真的跑该夹具的两个作业族，并给握手行加真伪标签（打印与解析同一处实现）
date: 2026-10-20
---

## 本次执行记录：锁预算复测脚本的采样域漏掉整个作业族（lock-timing-audit-coverage-domain，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（改测试基建 `test-helpers/windows-file-lock.js` + CI 复测脚本 `scripts/lock-timing-audit.js` + 其锁 `apps/desktop/electron/services/windows-file-lock.test.js` + `docs/`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-lock-timing-audit-coverage-domain`、裸分支 `lock-timing-audit-coverage-domain`（`git rev-parse --abbrev-ref HEAD` 实证），基线 = `origin/main` 的 `f6a61d24c` |
| 第一性原因（QM-5 ①） | PASS | `scripts/lock-timing-audit.js` 用 `JOB_RE = /QG Desktop Shards/` 枚举"哪些作业跑了这把锁"，而这个**作业名集合是凭当时那一次观测写的**，没有任何东西在问"还有谁跑它"。当场重取 origin/main 最近 4 次 main push（12 份作业日志）逐作业统计 `[windows-file-lock] ready=` 行：`QG Coverage count=44 max=17466ms` \| `QG Desktop Shards (2/2) count=16 max=14402ms` \| `QG Desktop Shards (1/2) count=28 max=3773ms` ⇒ **需要最大预算的那个作业根本不在采样域里**。追溯到 `lock-budget-provenance`（2026-10-02）那次：它按当时的 CI 形态写了作业名，`QG Coverage` 后来也开始跑这批用例，而脚本没有任何"域漂移"的出口。归类 流程缺失（采样域是口头约定，不是判据） |
| 逃逸分析（QM-5 ②） | PASS | ① **零样本出口挡不住"少采"**：脚本已有 `rc=3 NO_SAMPLES`，但本缺陷是"采到了、数也自洽、集合残缺"——`ready.length>0` 走的是完全正常的那条路径，还打印 `OK: 预算余量成立（headroom=3.53×）`。归类 测试场景缺失（既有出口只覆盖"采不到"这一半）；② **既有结构锁把残缺写法钉成了受保护形态**：`windows-file-lock.test.js`「复测入口必须落在仓库里，且其输出字段与 provenance 对齐」逐字段比对 keys，字段齐 ⇒ 绿，它不问这些字段是从哪个作业集合量来的。归类 断言不精确（锁住了对象形状，没锁住取样域）；③ **`samples` 里混进假握手**：夹具只在**真跑**时记进程内台账（`options.spawnImpl` 一律不记），但 `console.log` 那行是无条件的 ⇒ 单元用例的假握手（`ready=0ms`）同样落在 CI 日志里。当场实测（run `39374290098`，head 就是本片基线 `f6a61d24c`）：Coverage `lines=11 zero=4 real=7`、Shards(1/2) `lines=7 zero=4 real=3`、Shards(2/2) `lines=4 zero=0 real=4` ⇒ **22 行里 8 行（36%）是假的**，"样本量下限 ≥50"这条完全可以被假数据凑满。归类 夹具不同形 + 判据按行数不按语义；④ 四层（单元/集成/视觉/审查）都只看脚本自己打印的汇总行，没有任何一层去看**同一份日志的其他作业**。 |
| 系统性漏洞定位（QM-5 ③） | PASS | 不是"某条正则写错"，而是**"样本从哪些作业来"这件事没有判据**：作业名集合是硬编码枚举，且"一行握手日志是不是真测量"没有承载处。两个落点：① 采样域必须是一条**A/B 双向**判据（跑夹具的必须命中、不跑的必须不命中），单向"命中就行"只会把集合越写越宽；② 握手行的格式必须**只有一份实现**且把真伪写在行内（`mock=`），否则打印方与解析方各持一份事实 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：① `test-helpers/windows-file-lock.js` 新增 `formatTimingLine` / `parseTimingLine`（打印与解析同一处；解析返回 `{readyMs, lockedMs, mock}`，`mock` 三态 `false \| true \| null`=旧无标签行），打印处改调 formatter ⇒ 行内带 `mock=true\|false`；② `JOB_RE` 扩为 `/QG Desktop Shards\|QG Coverage/`，**刻意不退化成"扫所有作业"**（那会让样本来源无法归因）；③ 脚本删掉自己那份 `SAMPLE_RE`，改 `const mod = helper(); mod.parseTimingLine(line)`（先 `git grep` 未截断清点确认无第三方消费者）；④ `collectFromLog` 三档分列 `samples / mock / legacy / max / legacyMax`，**legacy 只报 max 不报 samples**（假握手 ready 恒 0，只会压低不会抬高 ⇒ 无标签行的最大值仍是可信下界），且无标签累加排在 `n === 0` 早退**之前**；⑤ 零样本出口分两档 `LEGACY_ONLY`（逐作业点名 `count=`/`max=`、按 max 降序）vs `NO_SAMPLES`，共用 `exitCode = 3`；判词唯一实现是新增导出的 `formatLegacyNotice`（纯函数，无网络即可测）；⑥ `LOCK_BUDGET_PROVENANCE.source` 如实写明"这组数是旧探针量的 ⇒ max 是下界、samples 是上界"。回归锁 24 条（起点 22）：round-trip（真/mock/legacy 三档 + 非握手行返回 null）/ 结构锁**锚到可执行语句**（`const mod = helper();…mod.parseTimingLine(` 而非"文件里出现过这个单词"）/ 反重复锁（`LEGACY_ONLY` 在脚本里出现 2 次即红）/ 位置锁（`legacyByJob.set` 必须在 `if (n === 0)` 之前）/ A+B 两臂作业名集合 / `formatLegacyNotice({}) === ''`。TDD：先红 `2 failed \| 22 passed`（红因分别是 `legacyMax` undefined、`formatLegacyNotice` 非函数）⇒ 实现后 `24 passed` |
| 防止再次发生（QM-5 ⑤） | PASS | ① **采样域漂移从"口头"变成 A/B 判据**：B 臂点名 5 个不跑该夹具的作业必须**不命中**，所以"扩面"不能靠把过滤写宽来交差（变异 N1 退回 Shards-only 实测指名红）；② **两份事实的形状被机械禁止**：反重复锁 + 反内联正则锁 + 反"只提名字不调用"的结构锁（N2/N3/N4/N5 各测一格，均实测红）；③ **预标签窗口可复现**：`legacyMax` 与逐作业点名让"标签上线前那次复测"也能产出可用尾部线索，不再只有"日志旧了"一句空话（N6/N7/N8 实测红）；④ 同源复述同步更新：`docs/windows-lock-budget-provenance.md` §2 加偏差表（max=下界 / samples=上界）、§3 rc 表补 rc=3 两档与 rc=5、§4 从五个坑扩到**七个坑**（新增"采样域硬枚举"与"行数≠样本数"），并按当场读数更正该文件 §5 里"`CHANGELOG.md` 含 NUL 字节、被 git 判为 binary"这句已过期前提（control-bytes-sweep 后实测 NUL=0，本轮置顶插入即为现场反证；旧决策那段正文不改写，更正另起一段）；⑤ **消费者并集按未截断 `git grep` 取**并全部实跑（上一轮把清点接了 `head -10` 恰好削掉一个真消费者，那笔已记在 `unwired-tests-git-domain` 的 S10）；⑥ 教训落内置记忆 / 外部记忆（本文件）/ EverOS |
| 行尾与 diff 对账 | PASS | 五个被触碰文件 `git ls-files --eol` 均 `i/lf w/crlf attr=text=auto`；工作副本实测**纯 CRLF**（`lock-timing-audit.js` CR=328/LF=328、`windows-file-lock.js` 380/380、`windows-file-lock.test.js` 590/590、`docs/windows-lock-budget-provenance.md` 123/123，全部 lone-CR≠0 且 NUL=0）⇒ CHANGELOG 置顶插入按"逐行保留原行尾 + 新增行补 `\r`"执行，实测 `CR_delta=10 LF_delta=10 block_lines=10`、旧行零丢失（多重集 `OLD_LINES_LOST=0`）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等（CHANGELOG 10/0、审计脚本、夹具、测试、文档各条见 commit）；删除行全部归因到被替换的函数体与 rc 表行，无幽灵行 |
| 接线棘轮 | PASS | 本片**不新增测试文件**（只在已被 CI 收集的 `apps/desktop/electron/services/windows-file-lock.test.js` 里加用例，vitest workspace `apps/desktop` ⇒ `QG Desktop Shards` 与 `QG Coverage` 两条作业都会跑它），无新点名需求；判据自证 `node scripts/check-unwired-tests.js --root=.` ⇒ OK、rc=0。消费者并集全跑：`windows-file-lock` + `account-state-restorer` + `credential-store` = **51 passed**；`packages/api-publish-engine/test/api-key-manager-atomic-write.test.js`（require 同一夹具）= **1 passed** |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 生产代码（改的是 `electron/services/*.test.js` 里的锁测试与 `test-helpers/` 夹具）、未触 `packages/rpa-engine/`、任何 `.vue`/样式/locale；预算取值 45000/12000/20000 一字未动 ⇒ 产物与像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | 自演，非外部模型 | 按用户指定「QM-6 你自己来模拟外部评审」执行：以 QM-6 两轴标准（后端=正确性/边界/安全/规格合规，前端=命名/模式/可维护性/集成）逐条自审实现 diff，结论与处置见下节。**如实标注：这不是外部模型产出，不得当作双模型证据登记**；机械闸门侧 pre-commit 仍生成 `.ccg/reviews/<sha>.json`，其 status 由该产物自己表达 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅（全文用「参考产品」式中性表述，未出现竞品名） | 文档同步 ✅（`docs/windows-lock-budget-provenance.md` 与代码同 PR） | 远程同步 由门禁推导

## 1. 现场读数（A/B，全部当场重取，不引历史）

**A 臂 · 12 份作业日志窗口（`--runs=4`，标签上线前的 legacy 行）**

| 作业 | 握手行数 | 无标签 max | 在旧域里？ |
|---|---|---|---|
| `QG Coverage` | 44 | **17466 ms** | ❌ 不在（旧 `JOB_RE` 只认 Shards） |
| `QG Desktop Shards (2/2)` | 16 | 14402 ms | ✅ |
| `QG Desktop Shards (1/2)` | 28 | 3773 ms | ✅ |

⇒ 同一次采集里，**被排除的那个作业尾部最大**；`LEGACY_ONLY` 那句判词逐作业点名后这条可一句话重取。

**B 臂 · 单次 run 的真伪分档（run `39374290098`，head = 本片基线 `f6a61d24c`）**

| 作业 | 行数 | `ready=0ms`（假握手） | `ready>0` | 真实 max |
|---|---|---|---|---|
| `QG Coverage` | 11 | 4 | 7 | 13709 ms |
| `QG Desktop Shards (1/2)` | 7 | 4 | 3 | 1593 ms |
| `QG Desktop Shards (2/2)` | 4 | 0 | 4 | 2147 ms |

⇒ **22 行里 8 行（36%）是假握手**，且这一趟真实尾部（13709 ms）仍落在 Coverage。两臂合起来就是本片要修的两件事：域残缺 + 行数≠样本数。

**零样本两档各跑一次实证**

| 档 | 命令 | rc | 现场输出首行 |
|---|---|---|---|
| `NO_SAMPLES` | `MP_AUDIT_REPO=colinchiu007/definitely-not-a-repo-xyz node scripts/lock-timing-audit.js --runs=2` | **3** | `PARTIAL: 只覆盖 0/2 …` + `NO_SAMPLES：一条握手样本都没采到 ⇒ 探针坐标可能过期…` |
| `LEGACY_ONLY` | `node scripts/lock-timing-audit.js --runs=4` | **3**（同一 `process.exitCode = 3` 语句） | `LEGACY_ONLY：取到 88 条**无标签**握手行… 逐作业（按 max 降序）：QG Coverage count=44 max=17466ms \| QG Desktop Shards (2/2) count=16 max=14402ms \| QG Desktop Shards (1/2) count=28 max=3773ms` |

## 2. 变异反证 N1–N8（逐条指名，控制跑自证健康）

控制跑：`rc=0 passed=24 failed=0`；不健康即 `PROBE_BLIND` 且不产出任何 verdict。**这里有一处我自己的工具性错误必须记**：驱动的健康断言最初仍写着上一版的 `passedN === 23`（我只改了 `matched:` 那一处，漏了守卫那一处），于是第一次跑报了 `PROBE_BLIND`——那是**守卫正确地拦下了一次不真实的对照**，不是探针坏了；改正后八条全部产出 verdict。

| 编号 | 变异（取被禁形态本身） | 红在哪条锁 | 指名 | 还原 |
|---|---|---|---|---|
| N1 | `JOB_RE` 退回 `/QG Desktop Shards/`（本次缺陷的原始形态） | A/B 负控 + 解析单一实现 | ✅ 2 条 | byte-equal |
| N2 | 解析不再区分真伪（`mock` 恒 `false`） | A/B 负控 + 解析单一实现 | ✅ | byte-equal |
| N3 | 打印摘掉 `mock=` 标签（退回历史形态） | 解析单一实现 | ✅ 独占 1 条 | byte-equal |
| N4 | 脚本自己抄一份 `SAMPLE_RE`（两份事实） | A/B 负控 + 解析单一实现 | ✅ | byte-equal |
| N5 | 可选段写回 `(true\|false)?`（本次实测踩到的正则形态：历史行整段不匹配 ⇒ legacy 恒 0） | A/B 负控 + 解析单一实现 | ✅ | byte-equal |
| N6 | 无标签行的 `max` 不再累加（置 0） | A/B 负控（`legacyMax` 断言） | ✅ 独占 1 条 | byte-equal |
| N7 | 判词抄回 `main()` 里第二份 | `LEGACY_ONLY` 出现次数 == 1 + 正向调用锚 | ✅ 独占 1 条 | byte-equal |
| N8 | 无标签累加搬到 `n === 0` 早退**之后**（真正要防的写法，非删除） | 位置锁 | ✅ 独占 1 条 | byte-equal |

红集互不相同（N3/N6/N7/N8 各独占一格 ⇒ 各自守一个独立变量），最终 `MUTATIONS: ALL CAUGHT + RESTORED`。

## 3. QM-6 自演双轴发现与处置

| 编号 | 轴 | 级别 | 发现 | 处置 |
|---|---|---|---|---|
| S1 | 后端 | MAJOR | `LEGACY_ONLY` 的 `legacyMax` 是"含假行的 max"，若被误读成"真实分布的 max"就会拿它去回填 provenance | 已修：文档 §2 偏差表 + `LOCK_BUDGET_PROVENANCE.source` 都写明"max 是下界 / samples 是上界"，且 `LEGACY_ONLY` 文案自带"不能当真实分布"；legacy 永不进 `samples` 数组（行为锁 + N6） |
| S2 | 后端 | MAJOR | `formatLegacyNotice` 若只在 `main()` 里内联，本条判据在无网络环境不可测 ⇒ 会变成"只有跑真采集时才被验证"的装饰分支 | 已修：抽成导出的纯函数，`{}` ⇒ `''` 有断言；另配 N7 反重复锁 |
| S3 | 前端 | MINOR | 把无标签累加放到 `continue` 之后是"看起来更顺"的写法，且单测全绿 | 已修：位置锁 + N8；注释写明"预标签窗口每个作业都在早退处 return" |
| S4 | 前端 | MINOR | 采样域扩面容易"顺手"改成扫所有作业（更省事且不会红） | 已在测试里把 B 臂 5 个作业名钉成必须不命中；文档 §4 第 6 条写明理由（样本来源无法归因） |
| S5 | 维护 | INFO | `JOB_RE` 的注释要能自证"这是实测来的集合"，否则下一个人只会当常量改 | 已写：注释点名两族与实测来源，并指向本记录 |

## 4. 遗留（不假装已闭合）

1. **本片合入后必须做一次带标签的重测并回填**：`node scripts/lock-timing-audit.js --runs=26 --json` 在带 `mock=false` 标签的日志攒够窗口后跑，把结果粘回 `LOCK_BUDGET_PROVENANCE`（当前 `max=12762 / samples=410` 是旧探针读数，方向为上表所述）。按既有不对称纪律，重测出更低值不构成收紧预算的理由。
2. **同族第二处未判定**：`scripts/case-timeout-audit.js:53` 有同形写法 `JOB_RE = /QG Desktop Shards/`。它量的是 GUI CLI e2e 单用例耗时，**是否也在 `QG Coverage` 里产出同样那行**本片未取证（判据：取一次 Coverage 日志 grep 该用例的 verbose 行）。取证为是 ⇒ 同一修法；取证为非 ⇒ 保持现状并在该文件注释里写下"已判定，Coverage 不产出行"。**不在本片顺手改**：把一个未取证的作业名加进另一个判据的域，会让它的样本来源同样无法归因。
3. 零样本两档共用 `exitCode = 3` 是刻意选择（两档都是"探针未证实"），但脚本没有 `rc=7` 之类独立码；若日后要把"CI 里 legacy 窗口攒够没有"做成可机读信号，需另开判据而非在此改宽。
4. 三条等人工的项未动（承接上一轮）：`~/.local/bin/env` 缺 `exec "$@"`、共享根那个游离空目录、把 `scripts/doc-abs-paths-baseline.json` 加进 `CI_IGNORED_PATHS`（属"改谁来守门"）。
5. QM-6 是自演（用户指定），**不构成**双模型外部评审证据；`check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 只看 `.ccg/reviews/<sha>.json` 的 status，"是否真的跑过外部模型"这一维度本仓仍无判据（AGENTS「残留风险」已记录）。
