---
record: changelog-growth-gate
task: 给 CHANGELOG.md 加「条目标题多重集只可增长」棘轮，接进 quality-gate.yml 的 changes job
date: 2026-10-05
---

## 本次执行记录：CHANGELOG 只可增长棘轮（changelog-growth-gate，2026-10-05）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码（门禁脚本 + CI） | worktree `D:/Data/projects/mp-worktrees/mp-changelog-growth-gate`，裸分支 `changelog-growth-gate`，base `fd28e782f`（= #2898 的 squash 落地提交）；三连实证 toplevel / branch / head 全对（`git worktree add` 后立即 `rev-parse --show-toplevel`） |
| 第一性原因（QM-5 ①） | 已定位 | 丢失提交 `b531bdfe7`（PR #2884，2026-10-04T16:42:41Z）。逐提交量 `git cat-file -s <sha>:CHANGELOG.md`：`7,474,293 → 9,155` 是 25 次触达里唯一一次数量级下跌；该提交 `--name-status` 的新增文件全是 `rewrite-ai-taste-*` 代码与 PRD，**没有任何归档文件** ⇒ 整份替换而非搬家 |
| 逃逸分析（QM-5 ②） | 五层全空，逐层给因 | ①单元测试层：全仓无任何测试读 CHANGELOG 的规模/条目（本 PR 前）；②门禁层：`check-docs-sync.sh` 只判「diff 里有没有白名单文档」，删空文档照样满足；③`check-max-lines` 的 `SCAN_DIRS=['apps/desktop/src','apps/desktop/electron','packages','ops-center/backend']` + `SOURCE_EXTS` 不含 `.md` ⇒ 根级 CHANGELOG **不在扫描域**（本 PR 前实跑该门禁：超限=98 挂账=98 ✅，与它无关，正好证明它看不见）；④`check-gate-record-debt` 只查执行记录两源，不查 CHANGELOG；⑤审查层：diff 里"删 6 万行"混在一个 40+ 文件的功能 PR 中未被当作异常 |
| 系统性漏洞（QM-5 ③） | 门禁缺失漏洞，具体到文件 | 缺「append-only 台账的单调性判据」。落点必须是被 docs-only **短路不到**的位置：`CHANGELOG.md` 命中 `scripts/classify-docs-only.js` 的 `CI_IGNORED_PATHS` 根级 `*.md`，若把校验放在被 `docs-only != 'true'` 门控的 `static-gates`，等于给自己关掉校验（AGENTS.md「进白名单前提锁」，`gate-record-debt-ledger.json` 先例） |
| 修复 + 回归保护（QM-5 ④） | 已落地并实跑 | 新增 `scripts/check-changelog-growth.js`（判据 `collect()` 与 IO 分离，可注入假 git）+ `scripts/check-changelog-growth.test.js`（**11 例**，`node --test` 全绿；原 8 例 + QM-6 后新增 3 例，见「QM-6 处置①/②」两行）。判据 = **base 的条目标题多重集必须被 head 包含**。用多重集不用集合：main 上标题只有 302 个不同值对 1,148 条（267 种重复、最多 4 份），集合口径会把「4 份删到 3 份」读成通过 —— 测试里那条「等条数换内容也必须报丢」与「副本删一份必须报丢」就是在排除这两种弱判据 |
| 防止再次发生（QM-5 ⑤） | 自动化门禁已接线 | 接进 `quality-gate.yml` 的 `changes` job（Gate 2c3），且 `gate-result` 的聚合表里含 `needs.changes.result`、`Gate Result` 是必需检查 ⇒ 本条红**拦得住**合并，不是只报告不判定。接线由 `check-unwired-tests.js` 当场验过（"检查域内测试文件 55 个 / OK"） |
| 反证（锁本身必须能红） | 已实跑 | ①**真事故复现**：`node scripts/check-changelog-growth.js --root=D:/Data/projects/mulpub --base=b531bdfe7^ --head=b531bdfe7` ⇒ `FAIL：少了 296 种条目（base 1133 条 -> head 3 条，字节 7474293 -> 9155）`；②**摘掉接线行**：把 workflow 里那行 `node --test scripts/check-changelog-growth.test.js` 删掉 ⇒ `check-unwired-tests` **rc=1** 并点名本文件（还原后 rc=0，文件按 blob 核对与 HEAD 相同）；③**判据改 no-op**（`lost` 恒空）⇒ 套件 **3 红 / 5 绿，rc=1**；④**摘掉 fail-closed**（零标题也放行）⇒ **恰好 1 红**，正是 `fail closed：base 读出 0 条标题必须抛`，另两条红用例（blob 读不到）不受影响 —— cause-match 成立。③④ 变异后均按字节还原核对（`还原逐字节相同 = true`，还原后 8/8 绿）。**注意**：首次测 ③ 时我把 `cmd \| grep -c` 的管道尾段退出码当成 rc，得到「7 条红」的错数 —— 正解是先把套件输出重定向到文件再读，`$?` 才是被测命令的 |
| fail closed | ✅ | base blob 读不到 ⇒ 抛「读不到 BASE:CHANGELOG.md」；base 读出 **0 条标题** ⇒ 抛「空遍历不得判为零丢失」（与 `check-gate-record-debt.js` 的 `rowCountAll===0` 出口同源）。两条都有独立用例 |
| 行尾与 diff 对账 | ✅ | 标题判据先 `.replace(/\r/g,'')` 归一再比（本仓工作树 CRLF、blob LF；未测先验：`origin/main:CHANGELOG.md` blob CR=0）。归一不判据"行尾是否被改"，只判"条目是否不见"；两口径对账在提交前跑 `git diff --numstat` vs `--ignore-cr-at-eol --numstat` |
| 接线棘轮 | ✅ | 新文件 `scripts/check-changelog-growth.test.js` 在同一 PR 里被 `node --test` 显式点名（`check-unwired-tests.js` rc=0）。`.gitignore:106 scripts/*.js` 默认忽略新脚本 ⇒ 补了 `!scripts/check-changelog-growth.js`（`check-ignore` 复核：test 文件走 `!scripts/*.test.js` 通配，无需逐条） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`，未触 UI；改动面为 `scripts/` 门禁 + `.github/workflows/` + `.gitignore` + 本记录 |
| QM-6 CCG 双模型外部评审 | 部分执行（三路两败一成，7 条已处置） | 通道实况：`codeagent-wrapper --backend codex` 返回 rc=0 但只有一句中间话、无 findings 产物；`--backend claude` 报 `completed without agent_message output` rc=1；**替代通道 `opencode run --model opencode/*-free` 产出真产物**（`.qm6-findings-fe2.json`，7 条：0 Critical / 4 Warning / 3 Info）。**回声核验**：评审用语（`只比第一段`/`else 兜底`/`HEADING_RE 只认`/`重复断言两次`）在我发出的 prompt 与其喂入的 diff 里 `grep -c` 均为 0（仅 `自相矛盾`、`两域齐全` 各 1 次命中，且命中的是被审代码自身的注释文本）⇒ 判定为评审方产出，非回声。**逐条实测**：7 条全部成立，无一条需要驳回。本 PR 相关那条（Warning）实测为**活盲区**：`origin/main:CHANGELOG.md` 有 1,164 行一级标题，其中 `# [` 形 1,140 行、**2 种真条目是无括号形**（`# fix(自检门禁): …（#2648，2026-09-30）`、`# fix(工程门禁): …`，各重复 4 次），唯一非条目的一级标题是 `# CHANGELOG`（重复 16 次）⇒ 旧判据 `/^# \[/` 对这 8 行完全失明，删掉任何一条棘轮照报 PASS。**处置见下两行** |
| QM-6 处置①（本 PR，活盲区） | 已修并实跑 | `HEADING_RE` 由「正向猜条目形状（`^# \[`）」改为「一级标题 − 节标题否定式排除」：`/^# (?!CHANGELOG(?:\s|$))\S/i`。TDD 先红后绿：新增 2 例（无括号条目被删必须报丢 / 夹具同时含两种形状）在旧实现下 **2 红 8 绿 rc=1**，改后 **11/11 绿**；真仓重算 `origin/main` 的条目数由 1,140 变为 **1,148**（正是补回那 8 行）。原用例「`# 普通一级` 不算条目」的期望**被推翻并改写** —— 它把盲区钉成了契约，不是我在放宽断言迁就实现 |
| QM-6 处置②（本 PR，评审未覆盖但同轮实测命中） | 已修并加锁 | **坐标系错**：原步骤 `--base="${CL_BASE}"`（= `pull_request.base.sha`，事件时刻的 main tip）与本地按 `origin/main` 试跑同错 —— 实测 `--base=origin/main` ⇒ **rc=1 假红**，报「少了 3 种条目」，而那 3 条是别人在我上次同步之后并入 main 的；`--base=$(git merge-base …)` ⇒ **rc=0**（base 1145 条 = head 1145 条）。正解：步骤内先 `git merge-base` 再回落 base sha 再回落 `HEAD^`（回落方向一律「更严」，不可回落成空/判过）。新增**接线锁**用例断言该步骤含 `git merge-base`、禁止 `--base=origin/main`、必须含 `${MB:-$BASE_REF}` 回落、且 `shell: bash`；区间终点用 `search(/\n {6}- name:/)` 并**找不到即红**（不用「下一个函数名 indexOf」那种会被搬家静默放大区间的写法） |
| QM-6 反证（接线锁不得是装饰） | 已实跑 4 档 | `M1` 把 base 改回 `origin/main` ⇒ rc=1 且红的正是「CI 接线锁」；`M1b` = M1 + 摘掉「禁 origin/main」「必须回落」两条断言 ⇒ **回绿**（证明红来自这两条而非别的断言顺带）；`M2` 摘掉 `git merge-base` 推导 ⇒ rc=1 同条红；`M2b` = M2 + 摘掉「必须含 git merge-base」断言 ⇒ **回绿**。每档都打印 `锚点命中数 / 字节前后 / 是否真的变了`（M1 `hits=1 72329->72322`，M2 `hits=1 72329->72275`），四档结束后断言 workflow 与测试文件**均与备份逐字节相同** |
| 远程同步 | PASS | 已合并：squash 落地 `1c98294a87d9fda18b5d455c6d453c5c198aa239`（PR #2901，2026-10-05T04:01:17Z）。取证（2026-10-05 现取，采集时 origin/main=8600dd214）：`git log origin/main --grep='(#2901)$' --format=%H|%cI` 得该 SHA 与时间；`git ls-remote --heads origin changelog-growth-gate` 返回 **0 行**证远端分支已删。其 CHANGELOG 条目由本回填 PR 带上（本 PR 之前三份记录都显式声明"条目挪到后续 docs-only 回填"）。 |

### 本 PR 不含 CHANGELOG 条目（刻意的）
本 PR 是混合 PR，CI 实测 25–30 分钟 ≥ main 前进间隔；顶插 `CHANGELOG.md` 会让每次 re-sync 都撞同一个位置（上一轮 axios 就是这个形态连撞三轮）。条目挪到后续 docs-only 回填 PR（实测 0.6–7.2 分钟）。

### 遗留（不假装已闭合）
- **只判「条目不见了」，不判「条目变小了」**：条目正文被改短、字节数倒退都不红。这是有意取舍 —— 后续 PR 修订自己那条 CHANGELOG 是既有习惯，把它判红会造出一个人人想关掉的红门禁。要收紧必须先给「合法修订」留出机制，别直接抬判据。
- **1,137 条里只有 302 种标题**（267 种重复、最多 4 份）：本次只把多重集判据建起来，**没有**去重。去重会让"副本删一份"这一类回归锁失去基线，所以顺序必须是「先建棘轮（本 PR）→ 再谈去重（独立 PR，且必须另给判据说清保留哪一份）」。
- `scripts/check-changelog-growth.js` 的默认 base 是 `HEAD^`：本地手动跑时若只想比最后一个提交，用默认值即可；**想比"本 PR 的起点"必须显式取 merge-base**（`--base="$(git merge-base HEAD origin/main)"`）。⛔ 不要用 `--base=origin/main` —— 那不是本 PR 的坐标系，实测会把别人后并入的 3 条读成本 PR 丢失（rc=1 假红）。CI 侧已在步骤内自行取 merge-base，无需人工记忆。
- **（QM-6 后新增的遗留）判据仍只看一级标题的"存在与重数"**：条目被**改名**（同一内容换一个标题）会同时报「旧标题丢失」+「新标题新增」，前者红、后者不管 —— 这是对的；但反过来，**保留标题、把正文换成别的内容**不红。已写在「刻意不判」段，此处只补一句：真要收紧，判据应加"标题→正文哈希"配对，而不是抬现在的形状判据。
