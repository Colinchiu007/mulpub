---
record: debt-recheck-zero-measurement-fail
task: 重算作业"零测量却报 success"的退出码与可归因修复（切片 D，承接 2026-10-20 授权的 A/B/C/D 序列）
date: 2026-10-22
---

## 本次执行记录：债务重算轮次的零测量必须失败、量不到必须说得出哪一步（debt-recheck-zero-measurement-fail，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 授权与裁决来源 | ✅ | 用户 2026-10-20「第 2、3 条授权你改判据。第 5 条，选②」＝允许改守门判据本身，档位选「只做重算 + 点名」（不打开 `strict`、不写 required 上下文、不启用 Merge Queue）。本刀是同一授权序列的第四片，仍在"重算 + 点名"这一档内：**不加任何新的阻断能力**，只把"没量到却报绿"改成"没量到就红，并且红得说得出原因"。作业仍非 required，`MP_RECHECK_COMMENT` 仍 `"0"`（写评论需人工过目，本轮没碰） |
| 变更类型与隔离 | ✅ | 改 `scripts/check-*` 判据本体 ⇒ 混合 PR（`classify-docs-only.js --base=origin/main --head=HEAD` 实测 `docs-only=false`，回显列出 4 个源码文件）；隔离走正规入口 `scripts/start-mp-task.ps1 -TaskName debt-recheck-zero-measurement-fail` → `<仓库父目录>/mp-worktrees/mp-debt-recheck-zero-measurement-fail`，裸分支同名，`pnpm install --frozen-lockfile` + `ensure-electron`（v43.7.7）+ `verify-worktree-deps`（11 个消费方解析通过）全 OK。入口第一次被挡：共享根有他人会话 20 个 tracked 修改（`-RequireClean` fail-closed）——按既有判据先分辨"他人正在写 vs 工作树落后"，随后该会话自行收干净，第二次建成功；未动他人任何文件 |
| 第一性原因（QM-5 ①） | ✅ | 不是"名单忘了加一项"，是**同一份事实被抄了两遍且无对账**：`UNJUDGEABLE_REASONS`(5 档) 与 `TOOL_FAULT_REASONS`(3 档) 各写一遍，退出码只读后者。首笔真实运行（run `39563222046` / job `119099176198`，触发点正是切片 C 的合并 `c074b91b6`）现场：step `重算 open PR 并点名陈旧结论` conclusion=**success**，而它自己打印 `rows=30 IN_BASELINE=0 VIOLATES=0 UNJUDGEABLE=30 CHECKER_FAILED=0`；逐条 **15 × `worktree-setup` + 15 × `conflict`**，`runChecker` 一次都没被调用。⇒ 这一轮一条都没量，报的是绿 |
| 逃逸分析（QM-5 ②） | ✅ | 切片 C 的 25 条锁当时**全绿**。逐层答为什么抓不到：① 断言层——退出码用例只喂 `unrelated-histories` 一种故障样本，`worktree-setup` 是否在名单里从未被问过（断言域 = 作者记得的那几格）；② 装配层——25 条**全部**注入 `classify/commitTree/worktreeAdd/runChecker` 替身，CI 唯一真正走的那条默认闭包在测试面一次都没被执行 ⇒ 默认链的任何失败对判据不可见；③ 观测层——输出里没有"量到了几笔"这个数，"一条都没量"与"量了且都合规"在计数行上同形；④ 归因层——三个不同修法（seam 未装配 / `commit-tree` 失败 / `worktree add` 失败）共用一个档名，且整链不携带任何 stderr ⇒ 到今天"CI 上哪一步坏了"仍未证实 |
| 系统性漏洞（QM-5 ③） | ✅ | 两类，都指名到行为：**「第二份真源」**——两份名单无并集校验（同类先例：`--root` 那刀的账本、`blockingGateInputs` 那格的 paths 清单）；**「替身掩盖生产接线」**——被消费的默认实现在测试面零覆盖（本仓已记过该族：靠注入实现的模块必须有一条走真实构造点）。另补一条同族落点：**判据扫描域会随拆分收缩**（见 ④ 末行） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① `REASON_CLASS` 一张表持有归类，词表与故障档都由它派生，`assertReasonClass` 在**模块加载处**校验（值不是 `tool-fault\|other-pr` 即抛 ⇒ 没归类的新档不可能静默退 0）；② 三个失败单位三个档名 `worktree-setup`(seam) / `merge-commit-failed`(commit-tree) / `merge-worktree-failed`(worktree-add)，两条路（判决与构造）档位同源由断言钉；③ 条目带 `stage` + `detail`（stderr 优先、stdout 兜底、截 200），逐条日志与评论表格都打出来，并补上默认闭包原先丢掉的 `stderr` 透传；④ 退出码两条子句：存在故障行 ⇒ 非零；`rows>0 ∧ measured=0 ∧ ¬allConflict` ⇒ 非零（第二句不看名单，专接"整轮全 CHECKER_FAILED"这种 verdict 面够不着的形态）。全 conflict 刻意仍退 0 + 打 `MEASURED=0(all-conflict)`，理由与"这不是遗漏"写在 design D3。回归锁 25 → **37**（`node --test scripts/check-debt-recheck.test.js`：**tests=37 pass=37 fail=0**），其中两条是**生产默认装配**用例（不注入任何 seam，真 merge-tree→commit-tree→worktree add→真 spawn 判据桩），两条是 **GIT_DIR 环境行为锁**（含对照格），一条是**混合轮**。**计划外连带**：实现后本体 503 行撞 `check-max-lines` 的 `limit=500`（该判据按 git 索引取域，`git add` 前本地照旧绿）⇒ 按既有裁决拆结构不调基线，切成 `scripts/lib/debt-recheck-core.js` / `scripts/lib/debt-recheck-live.js` / 入口门面；拆分零行为改动两条证据（拆前拆后同一条命令全绿 + 四个抽取区间逐字节出现在新文件、顶层声明名集合无缺失），而扫描域 1→3 份是必须同改的连带——拆完第一跑「不得出现指标名」那条锁绿得毫无道理（入口只剩 41 行），改成 `toolSources()` 并集扫 + 逐份字节下界 + 总行数下界 |
| 防止再次发生（QM-5 ⑤） | ✅ | 四件事都有执行体，不是"以后注意"：① **消灭第二份真源**——`REASON_CLASS` 一张表派生词表与故障清单，非法归类在**模块加载**时抛（`assertReasonClass`），下次新增档忘记归类不可能静默通过（M-D1 实测一次让 5 条用例红）；② **不依赖名单的兜底**——计数不变式让"名单不完备"本身不再等于放行（M-D2/M-D3 各测一条子句）；③ **生产装配面必须有对手**——`live()` 的默认闭包由两条不注入 seam 的用例真跑到，且跑在"摘光 git 身份 + 摘不掉 GIT_DIR"的现场，配套 M-D8/M-D9/M-D13 指名红；④ **判据扫描域必须跟着拆分扩面**——`toolSources()` 按三份并集扫并断言顶层声明集合齐全（M-D14 证明这条不是装饰）。规格侧落 `openspec/changes/debt-recheck-zero-measurement-fail/specs/ci-debt-baseline-recheck/spec.md`（3 条 Requirement / 10 个 Scenario，含"量不到必须按可修复单位分档并带现场"与"归类只准一处真源"）；AGENTS 侧无需改（本刀不新增热写面、不改守门清单）；learnings 两条已写进本记录（变异 MISSED 的处置、路径判据 vs 内容判据），发版时由聚合器搬进 `01-docs/learnings.md` |
| 取证读数（当场量，非推断） | ✅ | 首笔真实运行：整步 07:39:40.2→07:39:53.4 ⇒ **13.3 秒**、单条 `fetch+merge+judge_ms` 242–296 ms（**这批数不含 `runChecker`**，它一次都没跑到 ⇒ 上一轮"每笔 1.9 秒"的口径仍不能当成整链成本）；PR 侧 `rows=30`。本机五格 GIT_DIR 探针（两个临时仓库各带独有提交主题）：`cwd=A` 无 `-C` ⇒ B；`git -C A` ⇒ B；`-C A` + `GIT_WORK_TREE=A` ⇒ B；两格干净对照 ⇒ A。**同一现场 `--show-toplevel` 仍回 A** ⇒ 路径判据不能用于证明"测的是哪个仓库"。本机默认链实测**能跑通**：单笔（含建 remote+clone+worktree+spawn 判据）用例墙钟 11.5 秒。静态面本地读数：`check-max-lines` `超限文件=95 挂账=95 ⇒ PASS`、`check-debt-budget` 五指标全 ✅、`check-unwired-tests` `检查域内测试文件 117 个 ⇒ OK`、`check-no-brand-residue` `11512 文件 ⇒ PASS`、`check-changelog-duplicate-entries` `条目=593 冗余=0 ⇒ OK`、`check-no-hot-carrier-edit --base=origin/main` `差量文件=11 命中热写面=0 ⇒ PASS`、`check-doc-abs-paths` 首跑 **FAIL**（我自己在夹具的目录串里写了一个**带盘符的绝对路径**）⇒ 改成不带盘符的占位串后 `counts=1161 files=561 ⇒ PASS` |
| 变异反证（指名红 + 红集互不相同） | ✅ | **分两跑，数以最终基线为准**（这一格本身就是"证据数字必须在最终基线上重跑后再写"那条纪律的现场）：第 1 轮 12 个变异全 CAUGHT（`tests=37`，其中 M-D3 MISSED 逼出「混合轮」用例、M-D11/M-D12 同红逼出 §28 拆两条）；i4/i5 与 §27 清理断言落码后**整表重跑** ⇒ 控制跑 `tests=39 pass=39 fail=0`、**15 个变异全 CAUGHT**、`非CAUGHT=[]`、`红集互不相同=yes`、`drift=0`，还原 md5 `core=d9e9458839` / `live=6b333ff974` / `test=11e1bf4b54`（前 10 位，LF 工作树档）。逐条（最终跑）：M-D1 复现事故（名单退回手抄且 `reasonFault` 读它）红 5；M-D2 摘计数不变式 1；M-D3 退出码只看计数 1（混合轮）；M-D4 两阶段折回同名 3；M-D5 评论丢现场 1；M-D6 归类校验退化 1；M-D7 不写 all-conflict 1；M-D8 默认 `runChecker` 路径改错一个字母 2；M-D9 默认闭包不透传 stderr 1；M-D10 逐条日志丢 detail 2；M-D11 摘 env 剔除 1（行为侧）；M-D12 告警改 no-op 1（告警侧）；M-D13 两处 commit-tree 退回靠宿主身份 4；M-D14 把结构锁扫描域缩回单文件 4（证明 `toolSources()` 不是装饰）；M-D15 把每笔 PR 用完的 worktree/ref 清理改成恒假 1。**三处子集关系如实写出，不得读成 15 对 15 独占**：`M-D15 ⊂ M-D8 ⊂ M-D13`（驱动按"集合不相等"判互不相同）；可分辨处是只有 M-D13 打断身份链、只有 M-D15 只打断卫生不打断任何判决。另记 M-D13 第一版是**语法不合法的变异**（只换 `X.concat(` 前缀留下多余右括号）⇒ 整片 LOADFAIL、驱动记 `UNREADABLE tests=1`，换成整段表达式替换后单条重跑才拿到 4 条指名红 |
| 接线棘轮 | ✅ | 本刀**没有新增测试文件**，只往 `scripts/check-debt-recheck.test.js` 加用例，该文件已在 `quality-gate.yml` Gate 2b 点名（既有接线锁 §7 每次跑都验）。新增的两个实现文件在 `scripts/lib/`（不受 `.gitignore:106` 的 `scripts/*.js` 影响，实测 `git check-ignore --no-index` rc=1 且无回显），`check-unwired-tests` 域内 117 个测试文件读数不变、OK |
| TDD 顺序的一处如实偏差 | ✅ | 示踪弹先红是硬规矩，本刀有三格是**判据先落、锁后补**：「混合轮」（被 M-D3 第一轮 MISSED 逼出）、「GIT_DIR 告警侧/行为侧」（被设计评审 i5 逼出，且第一版实现把 env 取在"建 runner 时"快照，被这条用例当场打红才改成每次调用取）、「默认 commitTree 透传 stderr」（写实现时看见默认闭包丢 stderr）。三格的可证性都由对应变异提供（M-D3/M-D11/M-D12/M-D9 指名红），**不写成"先见证红"**。其余新锁均按红→绿顺序：首跑 `tests=33 fail=7`，失败原因逐条核对是"功能缺失"而非语法/夹具崩 |
| 行尾与 diff 对账 | ✅ | 三个 JS 与四份文档的工作副本动手前实测 `i/lf w/crlf attr/text=auto`；先用探针证明"归一化零内容改动"（`git hash-object` == 索引 blob oid，逐文件 `equal=true`）再改成 LF 编辑，避免多行锚点失配与幽灵 diff。**`CHANGELOG.md` 与 `01-docs/learnings.md` 本次零改动**（`check-no-hot-carrier-edit` 现场：`命中热写面=0`），条目写在本记录的两个小节里，台账由 `scripts/aggregate-changelog.js` 在发版时搬 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件；本刀是 CI 侧工具与判据 |
| QM-6 CCG 双模型外部评审 | ✅ 设计轴真交付（单后端）/ 实现轴见下 | **设计层**：`sh scripts/plan-review.sh <方案> --force` 真跑，判定 SINGLE，critic=claude 交付 **3 Critical / 2 Warning / 2 Info** 共 7 条，逐条处置见 design D8 与 tasks 2.2。i1/i3/i6 是把文档改成与代码同源（映射表、`rows/measured/allConflict` 定义、"新档必须进表"的机械判据），i2 已在夹具里实现并写明代价（夹具显式声明身份 ⇒ 该锁证不了 CI 缺身份那一格），i4 是文档缺写（实现里本就有 stdout 兜底与 200 截断），i5 **落码**（D7），i7 落 D9 与下面的跟进。**proposer=opencode 那一轴未交付**：引擎把方案回投 opencode 时被后端输入上限拒（7871 字符 > 7800，实测边界 (8125, 8145]），exit 1 且零错误信息 ⇒ 设计层实质单后端，按既有裁决「认单轴、缺轴登记为欠账」。**为跑起来绕的两处工具缺陷也如实记**：`deep-review.sh --force` 在验证层不生效（shell 入口的 force 只挡自己那一格早退，仓外引擎 `ccg-deep-review.js:985` 读到 `mode=skip` 再退一次且不认识 force，rc=0 ⇒ 「跑完但零交付」第 18 形态）；`plan-review.sh` 的产物 slug 只取方案文件名 ⇒ 与 OpenSpec 固定文件名 `design.md` 结构性撞车（撞车目录里是别的会话 18:23 的评审现场，覆盖即销毁他人证据 ⇒ 守卫是对的），本轮用 `%TEMP%` 唯一名副本跑通，代价是评审对象是一份快照。**实现层**：判定 DUAL（1268 行 > 200、`scripts/check-*` 属高危面），`sh scripts/deep-review.sh` 于提交 `070cae156` 之后真跑，逐条处置与产物闭合见本行下方补记与 PR 评论 |
| 外部评审第 2 轮（最终树） | ✅ | 引擎那一跑**无交付**：critic 回了内容却被 `dimension` 枚举校验整份拒收（`consistency`/`feasibility`/`clarity` 不合法，而同样的值在决策层那一轮是合法的），不落 `critique-v1.md`、入口仍返回可读退出码 ⇒ 「跑完但零交付」第 19 形态（同日第 18 形态是 `deep-review.sh --force` 在验证层不透传给引擎）。改派一次**直接只读复核**（载荷=三份实现+规格+「上一轮已处置勿重复」清单，输出硬约束；199 秒、1 条 Critical）：称清理块 `if (!deps.worktreeAdd)` 永不执行 ⇒ **前提不成立**（它判的是调用方有没有注入，默认闭包在传给 `evaluatePr` 的实参里现造、不改写 `deps`），**但戳到一格真空**：清理是否执行从未被断言 ⇒ §27 第一条用例新增两条断言（一轮跑完 `worktree list` 只剩克隆自己那一条注册项；`refs/recheck/*` 必须为空）+ 变异 M-D15 指名红。落码与读数见 PR #4204 第二条评论、design D10b。两条产物的闭合读数由 `check-pr-exec-record.js --mode=enforce` 当场取：`TIER-COVERAGE dual-closed total=2 external=2 external-unverified=0`，且闭合脚本自带"剥掉 deepReview 后与动手前逐字段相同"的核验（判定面未被顺手改宽） |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |

### 遗留（不假装已闭合）

- **CI 上"哪一步坏了"仍未证实**：本刀把归因能力装上，根因要等落地后的第一次真实运行打印 `verdict=…/<档名> :: <失败命令首行>` 才知道。三种结果对应三种下一刀（design D9）。禁止用"本机跑通了"去否证它——本机实测默认链通（11.5 秒/笔），恰恰说明差异在环境而不在代码。
- **落地后这个非 required 作业会持续红**。这是设计意图（红着且说得出原因 > 绿着骗人），但必须让下一个会话知道：不要为了"让它不红"去放宽判据或改 `paths:`。
- **作业仍不阻断**：与切片 C 同一边界。三条真阻断的路（`strict` / CI 写 required 上下文 / Merge Queue）都属改守门，用户已明确不选。
- **评论面未开**：`MP_RECHECK_COMMENT` 仍 `"0"` ⇒ CI 侧评论写入速率**依旧未测**；本轮新增的 13.3 秒只覆盖 fetch+merge 段。
- **两条评审链工具缺陷未修**（`deep-review.sh --force` 在验证层不透传；`plan-review` 的 slug 与 OpenSpec 固定文件名冲突）。另起一刀，本轮只记。
- **`enforce` 在 CI 侧仍是 advisory**：`check-pr-exec-record` 的 Gate 2c2 打印理由后 `exit 0` ⇒「QG Changes 全绿」不等于「QM-6 已闭合」，本轮的 enforce 读数以本机为准，转 required 属改守门。

## CHANGELOG 条目

# fix(ci): 债务重算轮次"一条都没量"不再报成功，量不到时点名到具体那一步（debt-recheck-zero-measurement-fail）

- 落地后第一次真实运行会**变红**——如果 CI 上那 15 笔仍在合成提交/只读检出阶段失败。这不是新故障，是原来那条假的绿被取消：以前整轮 `UNJUDGEABLE=30`、判据一次没跑，作业照样 conclusion=success，谁都不知道守门基线从没被用来量过在飞 PR。
- 退出码新增一条**不依赖原因名单**的判据：一轮拉到了 PR 却一笔都没量到（且不是每个人都在跟主干冲突）⇒ 非零退出。全 `conflict` 的一轮仍退 0，但会打印 `MEASURED=0(all-conflict)`，让"没量到"和"量了都合规"在日志里两种形状。
- `UNJUDGEABLE` 现在带**失败阶段与现场**：`worktree-setup`(工具没装配) / `merge-commit-failed`(合成提交) / `merge-worktree-failed`(只读检出) 三个档名分开，并附该命令 stderr 首行。维护者不用再从"哪一步坏了"倒推。
- 原因归类改成一张表持有，词表与故障清单都由它派生，非法归类在模块加载即抛——本次事故（名单两抄、漏一档）不可能再静默发生。
- 宿主环境带 `GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE` 时，重算会剔除它们并**出声一次**：实测 `git -C <repo>` 挡不住 `GIT_DIR`，不剔除时整轮会去量别人的仓库而产物完全同形。
- 附带：重算工具按依赖形态拆成"纯判决核 / 真 git 装配 / CLI 门面"三份（撞上行数红线的正解是拆结构不调基线），读源码的结构锁扫描域同步扩到三份并加规模下界。

## learnings

### lesson: 变异 MISSED 时先怀疑夹具没表示出那一格，而不是判据多余（debt-recheck-zero-measurement-fail）

**现场**：`d-mutate.cjs` 第一轮 M-D3（把退出码从 `toolFault || zeroMeasurement` 改成只看 `zeroMeasurement`）在 **34 条全绿里 0 条红**，而这条判据写得毫无问题。驱动读数：`M-D3 MISSED (0/34)`。

**根因**：既有故障样本全是「整轮零测量」形状（`unrelated-histories` 单条、全 `worktree-setup` 两条……），于是 `measured>0 且另有一行失明` 这个**混合轮**在测试面从未被构造过。判据的另一半没有对手，不是它多余，是夹具对那一格结构性免疫。补一条混合轮用例后重跑整张表，M-D3 变指名红。

**可复用的 N 条**：

1. 变异 MISSED 的第一动作是问"被摘掉的那一半，夹具表示过吗"，第二动作才是考虑删判据。顺序反了就会把唯一的牙拔掉。
2. 一条判据写成两个子句时，必须各配一个**只**让对应子句红的用例；否则其中一个子句是装饰。
3. 故障类夹具要按"判据读的维度"造样本，而不是按"错误种类"造——这里判据读的是 `measured` 与"是否全 conflict"两个维度，样本就必须覆盖 2×2 的角。
4. 驱动必须自证"这一跑真跑了几条用例"（本项目实现为：每轮 `# tests` 必须等于控制跑读数，否则记 UNREADABLE，绝不写进 CAUGHT/MISSED）。

### lesson: 证明"读的是哪个仓库"必须用内容判据，路径判据会写出一条恒真的锁（debt-recheck-zero-measurement-fail）

**现场**：设计评审 i5 提出"宿主 env 的 `GIT_DIR` 可能泄漏"。本机五格探针（两个临时仓库、各有独有提交主题）实测：`GIT_DIR=B/.git` 时 `git -C A log -1 --format=%s` 读到 **BBB**、`cwd=A` 无 `-C` 也读到 **B**、干净 env 两格都读到 **A**；但同一现场下 `git -C A rev-parse --show-toplevel` 仍回 **A**。

**根因**：`-C` 只改 cwd，不重置 `GIT_DIR`；而 `--show-toplevel` 在没有 `GIT_WORK_TREE` 时按 cwd 兜底回显，**它量的不是"对象库/refs 归属"**。拿它当判据，锁会在 hazard 真实存在的情况下恒绿——比没有锁更坏，因为它读起来像查过。

**可复用的 N 条**：

1. 写"归属类"判据前先问：这个字段在故障现场会不会**仍然正确**？会，就换判据（这里换成"两个仓库各自独有的提交主题"）。
2. 任何 hazard 类锁必须自带**对照格**（不加固时确实坏），否则"加固后通过"证不出加固有对象。对照格失败时文案要写"这条锁失去测量对象"，而不是让它静默通过。
3. env 卫生要在**每次调用**取，不要在建 runner/handle 时快照：宿主可能在工具跑起来之后才带上变量——本项目第一版就是被"告警侧"用例当场打红才改的。
4. 剔除必须出声一次（与 `ELECTRON_RUN_AS_NODE` 同口径）：静默剔除会让"这台机器的环境一直有问题"永远不被知道，而告警要写明后果（"会量到别人的仓库"），否则读起来像例行提示。
