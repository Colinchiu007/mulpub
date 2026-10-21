---
record: parity-spawn-blindness
task: 把对拍脚本的 python 子进程失败从"永远空消息"改成三档可归因上报（缺 python / 被超时杀 / 真崩），并给 status=0 的坏输出独立一档
date: 2026-10-20
---

## 本次执行记录：`python simulator failed:` 不再抛空消息（parity-spawn-blindness，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 混合 PR（改 CI 对拍脚本本体 `scripts/compare-scheduler-models.js` + 其锁 `scripts/compare-scheduler-models.test.js`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-parity-spawn-blindness`、裸分支 `parity-spawn-blindness`（`git rev-parse --abbrev-ref HEAD` 实证）；建片后 `git merge origin/main` 无冲突（当时未碰热写面），依赖经 `node scripts/verify-worktree-deps.js` ⇒ `消费方解析通过 11 项 / OK` |
| 第一性原因（QM-5 ①） | PASS | `pythonSimulate` 只判 `res.status !== 0` 就抛 `'python simulator failed: ' + (res.stderr \|\| res.stdout)`，而 **spawnSync 在两类最坏情形下 stderr 与 stdout 都是空的**：① `python` 不在 PATH ⇒ `res.error=ENOENT`、`status=null`；② 命中 `timeout: 30000` ⇒ `res.error=ETIMEDOUT`、`res.signal=SIGTERM`、`status=null`、stderr 空。于是"环境不具备""负载抖动""python 真崩"三种成因塌成同一句空消息。追溯：这不是新伤——`.quality-gates.md:10018-10026`（另一次同类红）已经**逐字写出**根因（「只判 `res.status`、不读 `res.error` ⇒ 超时或缺 python 都抛空消息」）并留下建议，当时以"避免扩大战线"未做 ⇒ 归类 流程缺失（已知判据缺口被记成建议而不是被闭合） |
| 逃逸分析（QM-5 ②） | PASS | ① 既有 36 条锁全部在测**判据算术**（容差公式、并发观测、完成集合、上限 clamp），**一条都不测失败路径**：`pythonSimulate` 的错误文案在测试里从未被断言过 ⇒ 归类 测试场景缺失；② 该函数**不可注入**（模块内直接 `spawnSync`），所以"抛什么"这件事在测试里根本不可达 ⇒ 归类 接缝不存在（与 AGENTS「rc=5 那一档必须可达」同族，那次是路径可注入，这次是 spawn 后端可注入）；③ CI 侧红一次只留下 `Error: python simulator failed:`，vitest 不打印子进程任何现场 ⇒ 人只能靠 rerun 观察是否复现，三次都这么做（`.quality-gates.md:3261`、`:10024`、本次）⇒ 归类 系统性漏洞：诊断成本被转嫁给人工重跑 |
| 系统性漏洞定位（QM-5 ③） | PASS | 「子进程失败上报」这一格在整个对拍链上**没有实现**：`spawnSync` 的三态（`error` / `signal` / `status`）被压成一个布尔。落点 = 必须有一处 `formatSpawnFailure(res, ctx)` 纯函数持有全部三档文案，抛错处只许调它；否则下一次加第四种成因（如 SIGKILL、stdout 污染）又是往 if 里塞字符串 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：① `formatSpawnFailure` 三档分开——ENOENT 点名"python 不可用/不在 PATH"并给核验命令 `python --version`；ETIMEDOUT/SIGTERM 报 `signal=` + 本次 `timeout=` 并写明"负载型可重跑，不是模拟器算错"；其余报 `status=` + stderr/stdout 尾 6 行截断；共同附带 `cmd/status/signal/timeout`，返回值**永不为空**；② `resolveSpawnTimeout`：`MP_PARITY_PYTHON_TIMEOUT_MS` 可覆盖，但 `0`/`NaN`/负值一律回落 `30000` 并**出声**（`timeout:0` 在 Node 里等于关掉超时，比 30s 更坏）；③ `status=0` 而末行非 JSON ⇒ 新档 `PYTHON_OUTPUT_UNPARSEABLE`（带末行内容与行数），不再抛裸 `JSON.parse` 栈；④ spawn 后端改为可注入 `opts.spawnImpl`（默认 `spawnSync`），使失败路径在测试里可达；⑤ 预算数值 30000 **一字未动**。回归锁 44 条（起点 36）：三档各一条 + "三档文案两两不同且非空" + 注入假后端**逐档真跑** `pythonSimulate`（不靠读源码字符串） + env 回落与出声 + 反向锁旧拼接不得回来 + 正向锚"抛错处必须真的调用 formatSpawnFailure" |
| 防止再次发生（QM-5 ⑤） | PASS | ① 把"改回空消息"变成会红的动作：反向锁（正则挡住 `+ (res.stderr \|\| res.stdout)`）+ 正向锚（锚到 `function pythonSimulate … throw new Error('python simulator failed: ' + formatSpawnFailure(` 这条可执行语句），变异 P1 实测两条一起红；② 把"三档塌回一档"变成会红的动作：P2 摘 ENOENT 档只红档1、P3 摘超时判据只红档2，两格各测各的；③ **量出一条锁的真实边界并写进注释**：「三档互不相同」只挡**文案塌缩**，不挡**判据塌缩**（把 `if (code==='ETIMEDOUT'…)` 改成 false 后三句话仍两两不同）——该局限直接注在用例里，别让下一个会话以为它兜得住；④ 对上一轮建议的**部分否证**：不引入 skip。理由是这条契约只在 main push 跑（`if: event != pull_request`），静默 skip 等于关掉守门还报通过（本仓「装饰性门禁」同型）；红保留，但红得可归因——这条判断连同理由写进代码注释与本记录；⑤ 同源复述：`.quality-gates.md` 两条旧记录按"快照不改写"保留，其建议的采纳/否证状态写在本文件与代码注释；⑥ 教训落内置记忆（[[feedback-cheap-forensics-leftovers-do-now]] 已记"低成本取证/建议不写成遗留"的代价）/ 外部记忆（本文件）/ EverOS |
| 行尾与 diff 对账 | PASS | 两个被改文件工作副本实测**纯 CRLF**（脚本 CR=454/LF=454、测试 CR=417/LF=417 ⇒ 无孤立 CR、无裸 LF 行），`git ls-files --eol` 为 `i/lf w/crlf attr=text=auto`；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等；CHANGELOG 置顶插入按"逐行保留原行尾 + 新增行补 `\r`"，落盘前断言旧行多重集零丢失、CR 增量 == LF 增量 == 新增行数 |
| 接线棘轮 | PASS | 本片**不新增测试文件**（锁加在 `scripts/compare-scheduler-models.test.js`，该文件已点名进 `quality-gate.yml` Gate 2b 的 `node --test scripts/compare-scheduler-models.test.js` ⇒ 每个 PR 都跑，无新点名需求）；判据自证 `node scripts/check-unwired-tests.js --root=.` ⇒ OK、rc=0；`node scripts/check-step-failfast.js` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 生产代码、`packages/rpa-engine/`、任何 `.vue`/样式/locale；改的是 CI 对拍脚本与其锁 ⇒ 产物与像素判定域无交集 |
| QM-6 CCG 双模型外部评审 | 自演，非外部模型 | 按用户指定「QM-6 你自己来模拟外部评审」执行，两轴逐条自审见下节。**如实标注：这不是外部模型产出，不得当作双模型证据登记**；本机 CCG 未安装（pre-commit 打印「未找到 CCG（run_skill.js），已跳过」），机械闸门对本 PR 无从判红 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅（无竞品名） | 文档同步 ✅（脚本头注释与预算模块口径随代码同 PR） | 远程同步 由门禁推导

## 1. 三次复发的时间线（旧载体可查，不凭印象）

| 次序 | 现场 | 当时处置 | 是否修根因 |
|---|---|---|---|
| 1 | `.quality-gates.md:3261`：`QG Desktop Shards` 红，`Error: python simulator failed:`（空 stderr） | 判环境性失败 ⇒ `gh run rerun --failed` 转绿 | ❌ |
| 2 | `.quality-gates.md:10018-10026`：同签名，**已写出根因**（只判 status、不读 error）+ 改进建议 | 「未在本 PR 实施，避免扩大战线」⇒ 重跑通过并合并 | ❌（建议悬空） |
| 3 | 2026-10-20：本会话 PR #4072 合并后 main push run `39398401923` 的 `QG Coverage → Gate Result` 双红，同签名 | 本机同树该文件 3 passed（77s）+ 我的 6 个文件与 scheduler/parity 零交集 ⇒ 负载型；已 `rerun --failed`（attempt 2）取回读，**并本片修根因** | ✅ |

计数口径：`grep -na "python simulator failed" .quality-gates.md` 实测 **2** 条历史命中（第 3 次是今天的 CI 现场，不在旧载体里）。

## 2. 变异反证 P1–P5（控制跑 `rc=0 pass=44 fail=0`）

| 编号 | 变异（取被禁形态本身） | 红在哪条锁 | 还原 |
|---|---|---|---|
| P1 | `throw` 改回 `+ (res.stderr \|\| res.stdout)`（旧空消息形态） | 反向锁 + 注入式行为锁 | byte-equal |
| P2 | 摘掉 ENOENT 档条件 | 档1 | byte-equal |
| P3 | 摘掉超时档条件（超时落进真崩档） | 档2（**不红**"三档互不相同" ⇒ 该局限已写进注释） | byte-equal |
| P4 | 放行 `timeout=0`（`n < 0` 才回落） | env 回落那条 | byte-equal |
| P5 | `PYTHON_OUTPUT_UNPARSEABLE` 退回裸 `throw e` | 坏输出档 | byte-equal |

红集互不相同。另有一处**我自己的驱动期望写错**：P3 最初被要求同时红两条，实际只红档2 —— 那是期望清单认领了一条不经该判据的用例，处置是改正期望并把"这条锁抓不到什么"写进注释，**没有**改断言凑红、也没有删那条锁。

## 3. QM-6 自演双轴发现与处置

| 编号 | 轴 | 级别 | 发现 | 处置 |
|---|---|---|---|---|
| S1 | 后端 | MAJOR | 上一轮留下的建议含"python 不可用时明确 skip 而非红" ⇒ 若照做，只在 main push 跑的对拍契约会在缺 python 的 runner 上**静默通过** | **部分否证**：不引入 skip，红保留但分档归因；理由写进代码注释与本记录，避免下一个会话把 skip 当"补上未完成的那半" |
| S2 | 后端 | MAJOR | `resolveSpawnTimeout` 若写成 `!Number.isFinite(n) \|\| n < 0`，`0` 会合法通过 ⇒ `spawnSync({timeout:0})` 等于**永不超时**，最坏的静默失效 | 判据 `n <= 0` 回落 + 出声；变异 P4 实测红 |
| S3 | 前端 | MINOR | 三档文案容易长成 if 分支里各拼一段字符串 ⇒ 下次加第四种成因又是抄一份 | 收敛到单一 `formatSpawnFailure` 纯函数；抛错处只许调它（正向锚 + P1） |
| S4 | 前端 | MINOR | 注入 `spawnImpl` 后，"默认真跑"这条路径可能悄悄被绕开（测试全绿而 CI 用不了） | 用真 python 跑 `node scripts/compare-scheduler-models.js` ⇒ `PARITY OK` rc=0 作为活路径证据，不靠读代码 |
| S5 | 维护 | INFO | 空消息之所以危险，是因为它**看起来像**"已上报过" | 文案里三档各自给"下一步做什么"（核验命令 / 可重跑 / python 侧报错原文） |

## 4. 遗留（不假装已闭合）

1. **超时预算本身仍无分布支撑**：`30000ms` 沿用旧值。要动它得先有"python 单次调用墙钟"的分布（档2 的文案已经能产出这个数据 —— 每次超时都会打印 `timeout=30000ms` 与 signal），攒够样本后再按"下限 + 安全系数"重定，不得凭手感调宽。
2. **同形态的第二处未清点完**：本仓还有别的"同步子进程 + 只判 status"的脚本（例如 `scripts/check-compose-error-codes.js` 这类新落的 CI 工具）。判据是 `git grep -na "spawnSync" -- scripts .github/scripts` 逐条问"error/signal 有没有被读"，本片未做全仓收敛。
3. **`publish-history.test.js` 那条被 10s 框架超时切断**的红（本次 PR #4086 的 `QG Coverage` 现场，job `118586713916`）**不是本片范围**，已单独登记为任务 #89：全仓 git grep 型结构锁没有自己的预算。
4. QM-6 是自演（用户指定），**不构成**双模型外部评审证据；CCG 未安装 ⇒ 机械闸门对本 PR 无从判红（AGENTS「残留风险」一节已记录）。
5. 三条等人工的项未动：`~/.local/bin/env` 缺 `exec "$@"`、共享根那个游离空目录、把 `scripts/doc-abs-paths-baseline.json` 加进 `CI_IGNORED_PATHS`（属"改谁来守门"）。
