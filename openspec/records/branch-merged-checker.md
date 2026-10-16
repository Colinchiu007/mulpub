---
record: branch-merged-checker
task: 把「删分支前证明内容已进主干」的三段判据从 AGENTS.md 散文变成可执行工具（scripts/check-branch-merged.js），并消灭「共用写面靠手抄五个文件名」这一第二落点
date: 2026-10-16
sync_status: PENDING
sync_reason: 合并后由本 PR 的后续 docs 回填或同批回填改写为 PASS + merge SHA
sync_backfill_owner: 本会话（branch-merged-checker）
---

## 本次执行记录：`scripts/check-branch-merged.js`——落地判据的机械执行体（branch-merged-checker，2026-10-16）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`（混合 PR）**——改 `.github/workflows/quality-gate.yml` 与 `scripts/` 工具脚本本体，两者都不在文档白名单内，不得借道精简门禁。
- 保留门禁：变更类型与隔离 ✅ | 行尾对账（两口径 numstat）✅ | 品牌残留 ✅ | 文档同步 ✅ | CHANGELOG 不适用（理由见下）| 远程同步 PENDING

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码类（`scripts/` 工具 + `.github/workflows/` 正文）⇒ 走隔离 worktree `<仓库父目录>/mp-worktrees/mp-branch-merged-checker`，裸分支 `branch-merged-checker`，由 `scripts/start-mp-task.ps1 -TaskName branch-merged-checker` 创建（判成败按 `git worktree list` + `rev-parse --abbrev-ref HEAD` 实证，不看 rc）；依赖链 `pnpm install --frozen-lockfile` + `ensure-electron.js` + `verify-worktree-deps.js` 全部通过；起于 `origin/main` 当日 tip，`rev-list --left-right --count HEAD...origin/main` = `0 0`，共享根未落盘任何一片文件 |
| 第一性原因（QM-5 ①） | PASS | #3741 把三段判据写进 `AGENTS.md` 时，**执行体仍是散文**：每轮清理由会话临时手写一次性探针（本片上一轮用的就是 `.tools/tmp/gate75/probe-merge-criterion.cjs`）。散文挡不住两类事故——判据本体写错、以及判据非空时人照样删。后者今天真实发生一次（旧判据在全树差量 52 行时我仍删了 `mp-gate12c-ledger-round9`）。引入点＝`AGENTS.md` 那条从未被证伪就入库的「比树」判据（#3741 已纠正文字，本片补工具） |
| 逃逸分析（QM-5 ②） | PASS | ① **无测试**：本仓此前没有任何"落地判据"可测，`scripts/` 域里没有该工具；② **流程缺失**：删除动作（`git branch -D`）与证明之间没有任何闸门，唯一约束是 agent 临场自觉；③ 单测/集成/视觉三层均无覆盖点（不触 UI、不触 IPC）；④ 分类＝**流程缺失 + 判据无执行体**，不是断言质量问题 |
| 系统性漏洞（QM-5 ③） | PASS | 具体落点：`AGENTS.md`「合并后收尾清单」第 5 条要求「按 R1-R7 清理」，而 R1-R7 校验的是**主工作区回归**，不校验**被删分支的内容是否已在主干**；`scripts/safe-worktree-remove.ps1` 亦无此判据面。⇒ 「删除前的落地证明」在本仓是**无人值守的空白格** |
| 修复 + 回归保护（QM-5 ④） | PASS | 本体 `scripts/check-branch-merged.js`（逐文件三段：`IDENTICAL` / `DRIFT-ATTRIBUTED` / `LOST` / `UNATTRIBUTED` / `JUDGE_ERROR`，退出码 0/1/2 三档分离）+ `scripts/check-branch-merged.test.js` 13 条（**真实 git 夹具，禁 mock git**；`os.tmpdir()` 下 `git init` 建独立仓，测试间不共享状态）。TDD 顺序如实：先落测试并实跑红灯（`fail 1 / pass 0`，MODULE_NOT_FOUND），再写本体，收口 `pass 13 / fail 0 / skipped 0` |
| 变异反证（红集互不相同） | PASS | 五条各施加"规则明文禁止的形态"并实测变红：M1 摘掉删除行那一半 ⇒ `{删除行单测, T4}`；M2 摘掉归因提交要求 ⇒ `{T5}`；M3 新增行从多重集退化为"存在即可" ⇒ `{新增行单测}`；M4 判据故障并入"没问题"档 ⇒ `{T7, T8}`；M5 改动集退回两点差 `main..ref`（不按 merge-base） ⇒ `{T1, T3, T6}`。收尾按字节还原（`byteIdentical=true`）且还原后基线重跑 `rc=0`。驱动侧补了一条**探针自证**：首版用 TAP 的 `^not ok` 解析，五条变异全部 `rc=1` 却报 `failedCount=0`——那是探针失明不是"没抓到"，改用默认 reporter 的 `✖` 行 + `ℹ fail` 两条独立来源后基线 `pass=13`、逐条红集如上 |
| 防止再次发生（QM-5 ⑤） | PASS | ① **执行体落位**：`AGENTS.md` 收尾清单第 5 条由「按 R1-R5 清理」改为「先跑 `node scripts/check-branch-merged.js …`，退出码 0 才允许继续清理」——散文判据从此有可执行入口，红即是闸；② **CI 落位**：本片 13 条自测点名进 `quality-gate.yml` 的 `changes` 作业（Gate 2b4），本体只 require 内置模块，`.gitignore` 的 `scripts/*.js` 吞并行为由 T9 双向钉住 ⇒ 判据本体不会烂成"只有本地手动跑过"的装饰存量；③ **同型根因点名**：本轮 CI 第一次红（`Gate 2c3` 报本记录缺 `⑤` 行）恰好复现了本仓"欠账必须由机械闸门问起"的同一条教训——我的本地门禁清单跑了 16 条却**漏了 `check-record-qm5-rows.js`**，靠 CI 才暴露；④ **经验落点**：`01-docs/learnings.md` 需追加一条「写进 AGENTS.md 的判据必须有执行体，否则下一轮仍是临时探针 + 临场自觉」，随本 PR 一并落；⑤ **不假装已闭合**：本工具不接 required check（属"改谁来守门"，须人工过目），且 `DRIFT-ATTRIBUTED` 的归因只到"某笔他人提交解释得开"这一层，未做 patch-id 级对账 |
| 真实仓 A/B（判据不是只在我自己夹具里成立） | PASS | 对当天**8 个真实 squash 合并**跑本工具（`--ref retire/<branch>-20261016`，`--merge <gh mergeCommit.oid>`）：`cases=8 lost_or_unattributed=0 judge_error=0`，33 个文件 `IDENTICAL` + `CHANGELOG.md` 1 个 `DRIFT-ATTRIBUTED`（即降级路径在真实热写面上确实触发并带归因提交）；同一批数据回放旧 A 档判据 ⇒ **4/8 会误报**（全树差量 31 / 5 / 8 / 52 行，其中"不属于我的文件"31 / 5 / 8 / 51 个）⇒ 本片不是把夹具里的结论复读一遍 |
| 共用写面归类（第二落点） | PASS | 不再维护五个文件名的手抄名单。改为**按"差异是否需要归因"分流**：blob 相等 ⇒ `IDENTICAL`；不等 ⇒ 必须同时成立「双向行级多重集」与「`base..merge` 上存在除本次合并外的具名他人提交」才判 `DRIFT-ATTRIBUTED`，否则 `LOST` / `UNATTRIBUTED` 一律 rc=1。分类错误的后果是**变红**（说不清差异来自谁就停手），不是静默放行——这是名单做不到的（名单漏一个热写面就退回整文件比较并复刻假阳性） |
| 接线与棘轮 | PASS | 测试点名进 `quality-gate.yml` 的 `changes` 作业（`Gate 2b4 - Branch-merged criterion`，`shell: bash`，单命令 ⇒ 不触发 `check-step-failfast`；该作业无 Install deps ⇒ 本体只 require `node:child_process` 等内置模块）。`.gitignore:106` 的 `scripts/*.js` 会静默吞掉本体，已补 negation 并由 T9 用 `git check-ignore --no-index` + `git ls-files --error-unmatch` 双向钉住。`check-unwired-tests` / `check-workflow-structure` 复验读数见 PR 正文 |
| 行尾与 diff 对账 | PASS | `quality-gate.yml` 实测 `i/lf w/crlf` ⇒ 首次插入用 latin1 直写把中文截成 NUL 控制字节（`YAML_PARSE_FAIL: null byte is not allowed in input`），改为「中文先转 UTF-8 字节再按 latin1 读回」并加 `nulBytes===0` 硬判据后通过；行尾对账 `deltaCR == deltaLF == 插入行数 == 10`，产物 `loneLF=0 / markers=0`；两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐字相同（读数见 PR 正文）。新文件为 LF 与仓内新脚本一致 |
| CHANGELOG | N/A | 贡献者侧工具，无用户可见行为变化；`CHANGELOG.md` 是本仓最热并发写面，为一条内部脚本插块只增加 re-sync 轮次。不适用在此写明，不静默省略 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/基线 PNG ⇒ 无打包产物与新渲染路径可验 |
| QM-6 双模型外部评审 | PENDING | 混合 PR（M 级）按规范须跑；三通道上一次实测全灭（见记忆 `project-mulpub-qm6-fallback-channel`），本片合并前重新探测一次并按结果如实回填：跑成 ⇒ 记 findings 与处置；仍不可达 ⇒ 登记「未跑成」并把合并决定交回人工，**不以自审替代** |
| 远程同步 | PENDING | 待本 PR 合并后回填 PASS + merge SHA，并在同一次提交内删除 frontmatter 的三个 `sync_*` 字段 |

### 遗留（不假装已闭合）

- **归因要求是必要条件不是充分条件**：`DRIFT-ATTRIBUTED` 只保证「差异能被某笔他人提交解释」，不保证那笔提交解释的**正是这段差异**。人工核对仍看打印出的 `%h %s`；把它升级成"差量逐笔对账"需要额外的 patch-id 比较，本片不做。
- **不接 required check**：本工具是**删除前的本地闸门**，不是 PR 闸门；把它加进 ruleset(7) ∪ classic protection(4) 属"改谁来守门"，须人工过目。
- **`--merge` 仍由人传**：一个分支被两个 PR 用过时必须传两个 SHA（T6 已把"漏传必须红"钉住），但工具不会自己去 GitHub 反查 PR↔SHA 映射——加反查要引入 `gh` 依赖与网络调用，本片刻意保持离线可跑。
