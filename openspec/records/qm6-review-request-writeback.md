---
record: qm6-review-request-writeback
task: 修 #3927 自带的假红——评审时换后端必须把请求值回写进判定记录，否则合法覆盖被对账判据读成未闭合
date: 2026-10-19
---

## 本次执行记录：评审时后端请求的回写落点（qm6-review-request-writeback，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动集：`scripts/lib/ccg-review-backends.js`（M）、`scripts/deep-review.sh`（M）、`scripts/lib/ccg-review-backends.test.js`（M）、`scripts/deep-review-deps.test.js`（M）、`openspec/changes/qm6-review-backend-config/**`（M）、`openspec/records/qm6-review-request-writeback.md`（A）、`CHANGELOG.md`（M）、`AGENTS.md`（M）。改 `scripts/` 工具脚本自身 ⇒ **混合 PR，不走 docs-only 通道**。隔离入口 `start-mp-task.ps1 -TaskName qm6-backend-override-writeback` 被 `mp-worktree-health.ps1 -RequireClean` 拒绝（`clean:false`，他人在飞的 `01-docs/learnings.md` / `CHANGELOG.md` / 三份 film-engineering 文档）⇒ 按 AGENTS 既不碰他人改动也不手搓 `git worktree add`，改在共享根就地编辑 `scripts/`（允许的层），提交用 plumbing 从 `origin/main@9cb431ed3` 构建，`CHANGELOG.md`/`AGENTS.md` 两个热点写面**取 origin/main 的 blob 再插行**（本地工作副本滞后 4 笔，直接编辑会反向撤销上游那几行） |
| 第一性原因（QM-5 ①） | ✅ | 不是"驱动没换后端"，而是**记录里没人写评审时的请求值**。`reviewBackends` 只有 pre-commit 的 decider 写（`saveRecord` 里 `RB.resolveBackends()`），写的永远是**提交那天清单里的值**；`deep-review.sh` 今天才新增的 `--critic` 转发把请求交给了驱动，却没有任何一跳把它落进记录。于是 `check-pr-exec-record.js` 的 `judgeBackendMismatch` 两侧读的是**两个时刻**：`reviewBackends`=提交时、`deepReview.performedBy`=评审时 ⇒ 一次合法覆盖必然不等 ⇒ 判未闭合。引入点是 PR #3927（merge `d65f0b76fc53379d4b2c0e9adec7801f8853a452`）自身——那一刀的文案已经写了"请求值随判定记录落盘"，实现里却没有落盘这一跳，属**把愿望当现状**的文档-实现失配 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单元层**：`ccg-review-backends.test.js` 只锁"解析出什么"，没有任何一条锁"解析结果去过哪里"；②**入口层**：`deep-review-deps.test.js` 里那 5 条新锁全是**结构锁**（源码里有没有那段 exec 文本），结构锁对"调用了但没人写回产物"完全免疫；③**判据层**：`check-pr-exec-record.test.js` 的 backendMismatch 用例是**手搓记录**——夹具直接给出 `reviewBackends:{critic:"codex"}`，等于替上游把这一跳做完了，于是判据在自己的单元测试里永远成立（本仓「契约夹具不得替对方剥壳」的同型）；④**行为层**：真实链上没人跑过"带 --critic 的真跑"，因为唯一能跑真评审的 claude 后端当时不可应答；⑤**审查层**：#3927 的 QM-6 逐轮处置把"记录里写请求值"当成了已有能力，没有反查它由谁写。四层同时漏过的组合是：**假红要等到下一次真覆盖才显形**，而下一次真覆盖正是本片要救的 #3904 |
| 系统性漏洞（QM-5 ③） | ✅ | 不是场景缺失，是**测试面缺"跨时刻一致性"这一类**：现有夹具让"记录从哪来"与"记录被谁读"永远在同一次调用里由同一方构造。落点在 `scripts/check-pr-exec-record.test.js`（夹具直造 `reviewBackends`）与 `scripts/deep-review-deps.test.js`（入口侧只有结构锁）——后者是本次补的：**入口那一段必须真跑一次并断言产物的字节**，否则任何"写了调用但没写效果"的实现都能全绿 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`applyReviewRequestToRecord(recordPath, resolved, fsImpl)`：新值进顶层、提交时那份挪进 `commitRequest` + `rewrittenAt` 留档、同值不叠层、读不到/非对象一律 `ok:false` 且**不新建**；②CLI 新增动作模式 `--record-request <path>`，与打印模式互斥（仍受"模式数必须为 1"约束），并**机械执行"没覆盖就不写"**（`overridden!==true` 直接 rc=2）；③`deep-review.sh` 在覆盖分支把控制权交给驱动**之前**调用它，失败 `exit 2` 且不启动驱动；dry-run 明确不回写并出声。回归保护：`ccg-review-backends.test.js` **17 → 26 例**（`node --test` → 26/26 pass）、`deep-review-deps.test.js` **35 → 40 例**（40/40 pass，其中 4 条是真跑 bash + 桩驱动的行为锁，不需要真引擎故 CI 上同样执行）；同族 4 个文件（decider 52、ccg-bash-entry 9、plan-review-deps 10、check-pr-exec-record 81）全部复跑 0 fail——它们消费同一对入口/lib，改动集之外不重新验证就是没验证 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①顺序被编进产物而不是源码位置：桩驱动启动时**自己再读一次记录**并把读数写进产物，断言 `sawCritic=codex`——回写若排在 `exec` 之后这条永远红；②"默认路径一个字节都不碰判定产物"被两条反向锁钉住（CLI 层 rc=2 且字节不变、入口层无覆盖时记录逐字不变），因为这条链要审计的正是"谁改过产物"；③"不新建判定产物"被 M7 变异钉住（把失败出口改成新建 ⇒ 指名红）；④结构锁保留但**只作补位**：`--record-request` 必须早于真跑 exec、必须早于其 `exit 2`、且不得出现在 dry-run 段；⑤变异反证 7 条全部实测 CAUGHT（见下），红集互不相同 |
| 行尾与 diff 对账 | ✅ | 三个被改文件在 `git ls-files --eol` 下均是 `i/lf w/crlf attr/text=auto`（工作副本 CRLF 由 checkout 转换），改动一律走数组 splice、逐行原样保留行尾，写盘前断言 `cr == lf == 行数`；`deep-review.sh` 是 `i/lf w/lf attr/text eol=lf`，改后 `bash -n` 通过 |
| 接线棘轮 | ✅ | **未新增任何 `*.test.js`**（两段新锁追加进已接线的两个文件，落点仍是 `quality-gate.yml` 的 Gate 2b/2c6），因此 `node scripts/check-unwired-tests.js` 的域与清单均不变；`.github/workflows/` 零改动 ⇒ 不动"谁来守门" |
| QM-1 打包 / QM-4 视觉 | N/A | 改动集零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`、零 UI/样式 ⇒ 打包与像素门禁**不适用**（不是"跑了通过"） |
| QM-6 CCG 深度评审 | **DUAL，未闭合（读数见下节）** | 判定器对本变更集判 `mode=dual`（529 行 > 200 行阈值），产物随提交入库、`deepReview.status=pending`；本分支上实跑 `check-pr-exec-record.js --mode=enforce` → **rc=1**，唯一理由就是这条欠账。2026-10-19 三个评审后端直连探测全部零输出 ⇒ 外部双模型评审今天跑不了。刻意不走的三条出口：删产物、写 `self_play_resolved` 顶替、换同族凑数 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口；main push 回读证据写在 PR 评论里，不写回仓库文件 |

### 本轮实测（改数依据，可重跑）

```
node --test scripts/lib/ccg-review-backends.test.js   → # tests 26  # pass 26  # fail 0
node --test scripts/deep-review-deps.test.js          → # tests 40  # pass 40  # fail 0
node --test scripts/ccg-review-decider.test.js        → # tests 52  # pass 52  # fail 0
node --test scripts/ccg-bash-entry.test.js            → # tests 9   # pass 9   # fail 0
node --test scripts/plan-review-deps.test.js          → # tests 10  # pass 10  # fail 0
node --test scripts/check-pr-exec-record.test.js      → # tests 81  # pass 81  # fail 0
bash -n scripts/deep-review.sh                        → rc=0
node <变异驱动脚本> <仓库根>                          → 合计 7 条，未被抓住 0 条（驱动要求 tests>0 且指名红，否则记 NOT-CAUGHT）
```

手工三档（同一 CLI，记录内容当场读回）：

```
--critic codex --record-request <rec>  → rc=0  ✓ 已把评审时请求的后端写回 …：critic=codex proposer=opencode
--record-request <rec>（没覆盖）        → rc=2  ✗ …与清单一致…⇒ 不回写。只有真覆盖过才改记录。   文件字节不变
--critic codex --record-request <不存在> → rc=2  ✗ 读不到判定记录（ENOENT）——不新建，避免伪造判定产物
```

| 变异 | 改动 | 结果 | 指名红集 |
|---|---|---|---|
| M1 | 摘掉入口里的回写调用 | CAUGHT | 回写接线锁 / 评审时换后端 / 回写这一跳失败 |
| M2 | 把回写挪进 dry-run 分支 | CAUGHT | 回写接线锁 / dry-run 换后端 |
| M3 | 回写失败改为 `\|\| true`（不早退） | CAUGHT | 回写这一跳失败必须 fail-closed |
| M4 | 回写变 no-op（返回 ok 不写盘） | CAUGHT | 回写：新值进顶层 / 重跑不叠层 / 无 reviewBackends 补上 / CLI 成功回写 |
| M5 | 去掉"与清单一致就不写"守卫 | CAUGHT | CLI --record-request：成功回写（反向那一格） |
| M6 | 覆盖时销毁提交时请求 | CAUGHT | 回写：新值进顶层 / 重跑不叠层 |
| M7 | 记录读不到时退化成新建 | CAUGHT | 记录读不到不新建 / CLI 记录缺失 |

### 本地判据读数（本分支实跑，未跑的点名交 CI）

```
node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce
  -> rc=1  PR 变更文件 12 个（A=2 M=10 D=0）/ 新增记录 1 篇 / head 分支=qm6-review-request-writeback
  -> 唯一理由：CCG 深度审查欠账 1 条（.ccg/reviews/<stagedDiffHash>.json，mode=dual，status=pending）
node scripts/classify-docs-only.js --base=origin/main --head=HEAD  -> docs-only=false files=12（混合 PR，不借道）
node scripts/check-gate-record-debt.js   -> rc=0  MERGE-LEDGER prs=2072 / HAND-CLOSURE 人工改写=0 /
                                            「1 篇是本次新增记录，合并后自动转派生收口，无需任何写回」
node scripts/check-doc-abs-paths.js --all -> rc=0 PASS  counts=1163（无新增本机绝对路径）
node scripts/check-unwired-tests.js      -> rc=0  检查域 108 个测试文件全部接线
node scripts/check-no-brand-residue.js   -> rc=0  10546 个 tracked 文件
node scripts/check-step-failfast.js      -> rc=0
node .github/scripts/check-max-lines.js  -> rc=0  无新增超大文件，挂账清单与现实一致
bash -n scripts/deep-review.sh           -> rc=0
```

**没测到的一条如实点名**：`.github/scripts/check-workflow-structure.js` 在这块 scratch worktree 抛
`Cannot find module 'js-yaml'`——该 worktree 刻意不装 `node_modules`，所以这条**既不是「通过」也不是「红」**，
是本地未测量。本 PR 零 `.github/workflows/` 改动，该判据由 CI 的 Gate 2b 负责；ESLint（Gate 11）、
`check-locale-sync --cjk` 等需要依赖的判据同理交 CI，不冒充本地证据。

### 一个比本刀更要紧的现场发现：CI 里这条判据是 **advisory**，不是阻断

我原以为「dual 未闭环」会把 `QG Changes` 判红，实测**没有**——PR 侧 `QG Changes` 结论 success。
取 CI 日志（run 39191557743 / job 117865273854，剥 ANSI 后逐行读）看到的是：

```
node scripts/check-pr-exec-record.js --base=... --head-branch=... --head=... --mode=advisory
- CCG 深度审查欠账 1 条 —— ...（mode=dual，status=pending）
不通过：1 条理由
MODE=advisory（尚未接进判定；转阻断 = 删掉 CI 里的 --mode=advisory，该标记行由 check-pr-exec-record.test.js 钉住）
```

三条口径因此必须分开，混了就等于给自己发通行证：

- **CI 绿 ≠ AGENTS「PR 自动合并」判据第 4 条满足**。第 4 条要的是 `--mode=enforce` 为 OK，
  而 enforce 档在本分支实测 **rc=1** ⇒ 本 PR 的阻断力来自判据第 4 条 + 评审确实没跑，不来自某条 check 的颜色。
- AGENTS 的 QM-6 段写着该判据「报欠账**并阻断**」——这句在 CI 这一侧当前不成立（advisory 观察态）。
  把它转成阻断属改「谁来守门」，须人工过目，不在本 PR 顺手做；本 PR 只把读数与坐标记下来。
- 能 5 秒定位的原因是**判据自己打印了 MODE**。观察态/阻断态必须在输出里可分辨，
  否则「日志 success」与「判据未通过」完全同形（本仓「CI 步骤 success 不证明走的是设计那一档」的同族）。

### 评审后端读数（2026-10-19，直连 `--backend <名> --lite`，硬超时 150s 后 kill）

```
claude   | rc=KILLED | elapsed_s=150.1 | nonspace_chars=0
codex    | rc=KILLED | elapsed_s=150   | nonspace_chars=0
opencode | rc=KILLED | elapsed_s=150.1 | nonspace_chars=0
```

第一版探针用 `Start-Job` 包装，三个后端都返回一段 codeagent-wrapper 的 PowerShell 解析报错，
文案里躺着**我自己脚本的正文**——那不是后端坏了，是探针把 harness 的文本喂进了被调方。
读数一律以直连那一版为准（本仓口径：归因前先分辨「数据变了」还是「探针瞎了」）。

M1 的红集里**同时**出现「回写这一跳失败」不是冗余：那条锁断言"驱动一次都不能起来"，摘掉回写后驱动带着旧记录起来了——症状不同、根因同一，两条各自指名。

### 显示项与提示文字（本轮新增的终端文案，逐字抄自实现）

- 覆盖分支原有两行不变：`→ 已向后端请求覆盖：--proposer <p> --critic <c>` 与驱动验证层那条 ⚠ 告警。
- dry-run 新增一行：`  （dry-run 不回写判定记录 —— 预览不该改产物；真跑时才会把请求值写进 $REC）`
- 回写失败：`✗ 评审时请求的后端没能写回 $REC —— 停止，不启动审查`（前置是 lib 打在 stderr 的具体原因，两行成对出现，缺一即无法归因）
- lib CLI 成功：`✓ 已把评审时请求的后端写回 <path>：critic=<c> proposer=<p>`
- lib CLI 未覆盖：`✗ 评审时请求的后端与清单一致（critic=<c> proposer=<p>）⇒ 不回写。只有真覆盖过才改记录。`
- lib CLI 记录读不到：`✗ 读不到判定记录（<code>）——不新建，避免伪造判定产物`
- lib CLI 顶层非对象：`✗ 判定记录顶层不是对象，拒绝改写`；JSON 坏：`✗ 判定记录不是合法 JSON（<message>）`
- lib CLI 缺值：`✗ 旗标 --record-request 缺值（必须紧跟一个值，不能为空或下一个旗标）`
- lib CLI 模式互斥：`✗ 必须且只能指定一个模式（--print-names / --print-table / --print-json / --target / --record-request），实得 N 个：…`
  （既有锁的期望正则随文案同步：`只能指定一个打印模式` → `只能指定一个模式`，改动点只有 2 处，替换处数由补丁脚本断言）

### 数据校验与失败模式 → 判据

| 输入形态 | 判据 | 落点 |
|---|---|---|
| `recordPath` 为空 | `ok:false`，不落盘 | lib 用例「入参缺一格就得停」 |
| `resolved.critic` 缺失/非串 | `ok:false`（写进去会让对账读到半个真源） | 同上 |
| 记录不存在 | `ok:false` + **不新建**（新建=伪造判定产物） | lib 用例「记录读不到 / 不是对象」+ 变异 M7 |
| 记录不是合法 JSON / 顶层是数组或标量 | `ok:false` + 原字节不动 | 同上 |
| 记录没有 `reviewBackends`（早于 #3927 的存量产物） | 允许补上，但不留 `commitRequest` | lib 用例「允许补上」 |
| 请求值与记录同值（重跑） | 不叠层：`commitRequest`/`rewrittenAt` 原样保留 | lib 用例「重跑不叠层」+ 变异 M6 |
| 未覆盖却调 `--record-request` | rc=2 且字节不变 | lib CLI 用例（反向那一格） |
| 回写这一跳失败（lib 坏了 / 记录被中途删） | 入口 `exit 2`，**驱动一次都不起来** | deps 行为锁 + 变异 M3 |
| dry-run | 不回写，但必须**出声**说没回写 | deps 行为锁 + 接线锁（dry-run 段不得含 `--record-request`） |
| 默认路径（没覆盖） | 记录逐字不变，且不得打印覆盖行 | deps 行为锁「默认路径一个字节都不碰记录」 |

### 遗留（不假装已闭合）

- **驱动验证层仍不应用覆盖**：`ccg-deep-review.js` 的 `--critic/--proposer` 只挂在决策层分支，用户级技能目录不在本仓。本刀把「请求」这一侧做实了（记录里能看到真实请求值 + 对账判未闭合），但**换后端本身**要等 vendor 引擎那一刀（改"谁来守门"，须人工过目）。所以入口继续打印那条 ⚠，不改口。
- **`plan-review.sh` 不回写**：决策层路径没有 PR 级的 `reviewBackends × performedBy` 对账消费者，且该链不解析"某 commit 的判定记录"这一形状——为它造一个写点等于给无人读的面加写者。真实缺口只有一处时不在第二处铺同类机制。
- **旧记录的 `commitRequest` 不会追溯补齐**：#3927 到本刀之间若有人真用过 `--critic`，那批记录顶层仍是提交时的值。判据侧的出口是 `overridden!==true ⇒ 不适用`（不追溯判红），所以那几次覆盖会表现为"记录说用了清单后端"，而不是"多出一笔欠账"。
- **外部评审后端可用性**：#3904 的 DUAL 欠账仍挂着——本刀不改变"谁在评审"，只改变"记录是否说真话"。

## 6. QM-6 第三轮处置（rebase 后重跑，2026-10-20）

| 条目 | severity | 处置 | 现场证据 |
|---|---|---|---|
| i1 | Critical | upheld，当场修 + 2 条回归锁 + spec 补场景 | 退回 HEAD 版 lib ⇒ `tests 28 / fail 2` 且两条指名 |
| i2 | Warning | dismissed（两侧同判据），但按「无一致锁」半句补 1 条真跑行为锁 | M-i2b 把分支门禁改恒真 ⇒ 该锁指名红；M-i2 改 shell 判据 ⇒ **未红**，已如实登记 |
| i3 | Warning | dismissed | `deep-review.sh:55` 已 `cd "$ROOT"`（`ROOT` 由 `:50` 按脚本自身位置算出），回写点在 `:873` |
| i4 | Warning | upheld，当场修 + 1 条回归锁（含「拒写必须逐字节不动」） | 同上那次退回即红 |
| i5 | Warning | dismissed | 判据按变更集路径扫记录（`REVIEWS_DIR_RE`），不按 `rec.sha`；`stats.changedLines` 零消费者（main 上 `git grep` = 0） |

- 本轮 `高危域必须外部复核 0 条`（vendor 补丁新增的两格都在产物里：`requiresExternalReview: []`、`expectedExternalBackend: "claude"`）
- 判据复跑：`ccg-review-backends.test.js` **28/28**、`deep-review-deps.test.js` **41/41**（+1 条即 i2 一致性锁）
- 顺序：先 rebase（仅 `CHANGELOG.md` 一处冲突，按「main blob 为底 + 只插我这 13 行」重建，两口径 numstat 同为 `13/0`），
  再 `reset --soft` + `git rm -f` 摘掉 rebase 前那份陈旧判定记录（留着它，enforce 会拿一条永远补不了的记录判红），
  重新过钩子生成 `348a2650…json`，最后才跑评审
