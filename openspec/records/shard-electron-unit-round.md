---
record: shard-electron-unit-round
task: 把 Electron CI 在 main push 上的整轮桌面单测按 --shard 切成 4 片，消除"整轮撞 2100s 预算 ⇒ 主干偶发红"，同时保住 required context `electron-tests` 报得出来
date: 2026-10-21
---

## 本次执行记录：Electron CI 整轮单测分片落地（shard-electron-unit-round，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | CI 变更（`.github/workflows/electron-ci.yml` + 两处结构性锁 + 事实源文档）⇒ 隔离 worktree `<WORKTREE_ROOT>\mp-shard-electron-unit-round`、裸分支 `shard-electron-unit-round`；共享根全程停在 `main` 且未在其落盘 |
| 第一性原因（QM-5 ①） | ✅ | 整轮（`--maxWorkers=1` 确定性串行）的**步骤级**实测：2026-10-21 main push 两次成功 **1678s / 1759s**、两次撞 **2100s** 墙（`rc=124`、**零** vitest 摘要行、零断言失败）。墙 2100s 对今天的健康耗时只剩 **19%–25%** 余量 ⇒ 红灯是常态（main 近 12 次 `Electron CI` 6 红，且与代码无关）。**"抬预算"这条路已走到头**（2100s 已是健康耗时的 1.19–1.25 倍），仓库自己在 `docs/electron-ci-step-budget-baseline.md` 写明根因修法是按 `--shard` 切开 |
| 逃逸分析（QM-5 ②） | ✅ | ①**判据层**：`docs/electron-ci-step-budget-baseline.md` 里"整轮 794s"是 2026-09-28 的旧数，套件长了一倍多，锁却还拿它算余量 ⇒ 判据域（基线）过时；②**接线层**：required context `electron-tests` 挂在 **ruleset**（id 23749994）上，不在 legacy protection API 上 ⇒ 上一轮三次尝试都被它卡死（`openspec/records/electron-ci-shard.md` §九）；③**测试层**：matrix 作业的 check 名恒带后缀（`electron-tests (1)`），没有非 matrix 作业报 `electron-tests`，那个 context 永不出现 ⇒ PR 恒 BLOCKED |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①新增分片作业 `electron-tests-shards`（matrix 恰 4 片、`fail-fast: false`、`--shard=i/4`、确定性参数全留、单片墙 `BUDGET_SECONDS=1100`、自证块保留）；②`electron-tests` 改为**汇入作业**（id 与 name 都是 `electron-tests`、`needs` 分片作业、带 `always()`、按 `needs.*.result` 把"任一片红"翻译成自己红）；③两处结构性锁改指分片作业并新增 5 条（片数恰 4 / fail-fast / 汇入作业名与 needs / 汇入失败传播 / 单片预算与片数的关系）；④`workflow-contract` 的 docs-only 短路锁为两个新作业加**带理由**的豁免（放宽"必须逐字相等"，保留"docs-only 条件必须在、changes 必须在 needs"两条意图） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**事实源更新**：换掉过时的 794s，写入 1678/1759/2100×2 的实测与按片换算；②**更正上一轮的取证错误**：文档里"`electron-tests` 不在 required checks 里"那半句来自只查 legacy protection API，已改为 ruleset 真相并留证；③**行为锁补一条硬伤**：分片后 run 里出现 `${{ matrix.shard }}` 这类 **Actions 模板**（不是 bash），直接喂 bash 会 `bad substitution` ⇒ 行为锁会把"被 timeout 掐断的 124"读成"退出码 1"，判据域悄悄错了。锁里先把表达式物化再执行，并断言"物化后不含 `${{`" |
| 行尾与 diff 对账 | ✅ | 提交前两口径 numstat 现取（见提交信息）；新增/改动文件行尾逐个复核为 CRLF、无 BOM |
| 接线棘轮 | ✅ | 未新增 `*.test.js`（锁写进已在 CI 里被点名的既有文件：`apps/desktop/tests/gui-ci-exit-contract.test.js`、`.github/scripts/workflow-contract.test.js`） |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | QM-1：只改 CI 工作流与锁，**未触 `apps/desktop/electron/**` 运行时代码** ⇒ 不适用；QM-4：无界面变更 |
| QM-6 CCG 双模型外部评审 | 见下方 | 逐条结论落 `openspec/records/shard-electron-unit-round.md` 的「外部双家族评审」小节 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（不预写 `PASS`） |

### 单片预算怎么来的（不许抬预算冒充分片）

| 项 | 值 | 出处 |
|---|---|---|
| 整轮步骤级实测 | 1678 s / 1759 s（两次成功） | 2026-10-21 main push `760826d19` / `2a63373d3` 的 `elapsed=` 自证行 |
| 整轮撞墙 | ≥ 2100 s（两次 `rc=124`） | 同日 `617e4bf69` / `e8799536c` |
| 片数 | 4 | `matrix.shard: [1,2,3,4]`（**恰 4**，不是 `>=2`：片数变少会抬高均值上界，反向判据会漏） |
| 单片健康 | ≈ 1759 / 4 ≈ **440 s** | 整轮 ÷ 片数 |
| 单片最坏（同样负载） | ≈ 2100 / 4 ≈ **525 s** | 整轮撞墙 ÷ 片数 |
| 单片预算 | **1100 s** | 对单片健康 2.5×、对单片最坏 2.1×；**且 < 旧整轮墙 1200 s**（不是抬预算的包装）、**且 < 整轮实测 1759 s** |
| 分片作业 job 级 | 40 min | install 10 + electron runtime 10 + 单片墙 18.3 = 38.3 min 显式上限之和 < 40（不倒挂） |
| 汇入作业 job 级 | 35 min | 单测轮已搬走：install 10 + electron runtime 10 + 冒烟/构建/检查余量 |

**未闭合（不假装已闭合）**：单片健康 440 s 是**均值假设**（`vitest --shard` 按文件切，各片时长未必均匀，
最慢的片可能明显高于均值）。首次分片运行会首次产出**逐片** `elapsed=` 读数，届时应据此复核片数与预算
（与仓库既有纪律一致：改预算要先补步骤级实测）。本片已把该复核写进事实源文档与执行记录。

### 变异反证（六条，各自指名红；还原后逐字节相同 + 两把锁全绿）

| 变异 | 期望被谁抓住 | 实测 |
|---|---|---|
| M1 摘掉分片作业里的 `set +e` | 行为锁（自证块在 `-e` 下被提前杀掉 ⇒ 读不到 124） | `1 failed | 46 passed` ✅ |
| M2 把分片作业改名成 `electron-tests`（与汇入作业同名） | WF 锁（两条同名检查 ⇒ 聚合语义失效） | `# pass 44 / # fail 1` ✅ |
| M3 删掉汇入作业的失败判定步骤（分片红了也照样报绿） | 汇入失败传播锁 | `1 failed | 46 passed` ✅ |
| M4 片数 4 → 2（片数变少会抬高均值上界） | 片数锁 + 预算关系锁 | `2 failed | 45 passed` ✅ |
| M5 单片预算 1100 → 2000（抬预算的包装） | 预算关系锁（≥旧整轮墙 1200 / >整轮实测 1759 / >1100 上界） | `3 failed | 44 passed` ✅ |
| M6 去掉 `--shard` 参数（又跑回整轮） | 分片参数锁 | `1 failed | 46 passed` ✅ |

还原校验：工作流 md5 `70D68964B9C12D46AD343023D7479AFE`（= 变异前），`gui-ci-exit-contract` **47/47 绿**、`workflow-contract` **45 pass / 0 fail**。

### 调试过程留痕（探针自己踩了三次坑，其中一次还抓出了真 bug）

本次写变异探针时，**探针本身**先失败了三次，且每次的失败形态都是"读数拿不到"而不是"变异没被抓住"：
① 第一版在 Git Bash 里用 `sed` 剥 ANSI，但本机 **PowerShell 才是默认 shell、`sed` 根本不存在** ⇒ 管道静默产出空文件，读数全空；
② 改用 PowerShell 后，`npx` 在本机是 **`.ps1`**（没有 `.cmd`/`.exe`），`spawnSync('npx')` 拿不到它；
③ 直接 `node node_modules/vitest/vitest.mjs` 反而**崩在 esbuild**（与 `npx vitest` 的解析路径不同）。
最后版在 **PowerShell 里直接调 `npx vitest`**（不经 `powershell -File` 子 shell）才拿到读数。
**而这三次"读数拿不到"里，最后一次真跑时立刻抓出一个真 bug**：我在同一条新用例里重复声明了
`const aggregate`（先声明一次、后又在失败传播断言前再声明一次）⇒ esbuild 直接报
`The symbol "aggregate" has already been declared`，**整个测试文件转不过来**（47 个用例一个都没跑）。
⇒ 与仓库既有教训同族：**"探针没跑出读数"必须显式判失败，不能读成"变异没被抓住"**；
而这条也说明为什么"锁全绿"不能只看 CI 的绿灯：文件转译失败时 vitest 报的是
`Test Files 1 failed / Tests no tests`，**用例数是 0**——若只看"有没有红"会以为红在断言上。

### 外部双家族评审

真跑 `sh scripts/deep-review.sh`（critic=claude / proposer=opencode，判定 `DUAL`，判定记录按内容寻址命中
`1c446eab…`）。critic 出 **3 条**（4 维度，最低分 5），无高危域项 ⇒ 自扮演裁决即可闭合；
逐条 `prosecution` / `defense` / `verdict` / `rationale` 落 `.adversarial/ccg-deep-2f8211bb/adjudication.json`。

| ID | 维度 | 问题 | 裁决 | 处置 |
|----|------|------|------|------|
| i1 | correctness | 分片作业没有 `env:` 块（NODE_ENV / SKIP_NATIVE_MEDIA_TOOL_TESTS） | **dismissed（假阳性）** | 事实前提不成立：`electron-ci.yml:104-106` 分片作业**确有** env 块（与汇入作业 217-219 同形）；`gui-ci-exit-contract` 的两条用例对分片作业的 env 都有断言。⇒ 不改实现，留档提醒"新增作业的 env 要逐行核，别只看 diff hunk" |
| i2 | maintainability | `design.md` 代码块写 6 片，与 YAML/proposal/spec 的 4 片矛盾 | **upheld** | 已改：design.md §1 代码块改 `shard: [1, 2, 3, 4]` 并补"恰 4 片"的理由 |
| i3 | correctness | "被替换旧墙 1200s" 与被替换的现行预算 2100s 混用，削弱论证可验证性 | **upheld** | 已改（四处同步）：锁里把三个数改名并分清（`originalMagicWallSeconds` 1200 / `currentWholeRoundBudgetSeconds` 2100 / `measuredWholeRoundSeconds` 1759），并**新增**断言「单片预算 < 2100s（它取代的那个数）」与「单片预算 > 2100÷4=525s（同样负载下的单片最坏）」；design/proposal/spec/事实源文档/工作流注释同步 |
| i4 | maintainability | WF 锁的豁免只放宽形状，未加"汇入作业存在且同名冲突"的反向判据 | **dismissed（假阳性）** | 反向判据已存在：WF 锁「electron-ci 的分片作业与汇入作业必须各司其职」用例断言汇入作业存在 + name 逐字 `electron-tests` + matrix 作业不得同名 + needs/always() + 汇入作业不得再跑整轮；GUI 锁另有汇入失败传播断言。变异 M2 已实测让 WF 锁 `44 pass / 1 fail` ⇒ 有牙 |

**这一轮的方法论收获**：3 条里 **2 条是假阳性**，且两条都栽在同一件事上——**critic 读的是 diff hunk，
不是完整文件**（分片作业是新增作业，env 块落在新 hunk 里；反向判据是**新增用例**，不在 diff 的改动行上）。
⇒ 与仓库既有教训同族（"只查一套就下结论"）：**评审结论必须回文件里逐行复核**，
否则会把"没读到"当成"不存在"，而这恰恰是本仓最贵的一类假红/假绿。

### 未闭合（不假装已闭合）

- 本地**没有**真跑分片作业（分片只在 GitHub runner 上执行）；本地只能验 YAML 形状、锁与自证块行为。
  首次真跑（main push）产出逐片 `elapsed=` 后，需按上面的"单片预算怎么来的"复核片数与预算。
- 片间耗时均匀性未实测（均值假设，见上）。
- 汇入作业与分片作业**各自**跑一遍 setup（install / electron runtime / preload 构建）⇒ runner 分钟数约 ×1.3，
  这是用成本换"不再撞墙 + 失败可归因"，未做成本优化。
- 上一轮遗留的**档 4**（让 `CI Failure Handler` 把"exit 124 且无摘要行"归类为 `ci-timeout-budget`）仍未做，
  本片不夹带（那是判据自指面，属另一刀）。
