---
record: gate-abs-path-scope
task: Gate 12c 的占位符豁免由「整行」收紧到「路径词元」，并落一份只能缩小的按文件存量基线；反证当场证伪一条装饰性行为锁并修掉其成因
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR（gate-abs-path-scope）尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后由 docs 回填 PR 改为 PASS 并删除本段三个字段与 ledger 登记项）
---

## 本次执行记录：Gate 12c 占位符豁免收紧 + 按文件存量基线（gate-abs-path-scope，2026-10-14）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🐛 Bug 修复 + 🔧 工具脚本/CI 门禁 + 📝 文档 ⇒ 改到 `scripts/**`（门禁本体与其自测）故为**混合 PR**，不走 docs-only 通道。worktree `D:/Data/projects/mp-worktrees/mp-*`（本任务目录名 `<gate-abs-path-scope>`）、裸分支 `gate-abs-path-scope`（`git rev-parse --abbrev-ref HEAD` 实证）；共享根 `D:/Data/projects/Mulpub` 保持 main clean，未在其中落盘 |
| 第一性原因（QM-5 ①） | PASS | 原始引入点不是"某个加粗写错了"，而是**豁免判据的作用域与它要豁免的对象不是同一个东西**：`if (PLACEHOLDER_RE.test(line)) continue;` 把"这段路径是占位符"判成了"这一行里有占位符"，而词表里含一条**裸星号**，Markdown 加粗就是星号 ⇒ 一行只要加粗，该行所有绝对路径免于判定。同轮先例登记见上一条记录（clock-shift-oracle「其余本地门禁」段前那条遗留行：实测全域 179 行属"仅因加粗被豁免且路径不存在"）。第二条第一性原因在实现"出路"时暴露：账本键**无条件**并入扫描域，使"文件已被删除"这一类被 `count=0 < base` 抢走并误诊成"改少了"——**成因写反**，`stale` 那一类对删除永远走不到 |
| 逃逸分析（QM-5 ②） | PASS | ① **单元层**：该门禁原有的两条豁免用例（`mp-*`、`<buildTag>`）都把占位符写在**没有加粗**的行里 ⇒ "整行判据被别的语法劫持"这一形态在夹具里根本不可表示，收紧后它们反而**当场红**（证明旧实现把不该豁免的也豁免了、也证明新实现会动到既有语义）。② **门禁层**：`--all` 全量审计当时报 `FAIL`（539 处），但日常 CI 口径是改动集，179 处存量对每个 PR 隐形 ⇒ 分类为"判据作用域错 + 无存量出路"两缺。③ **审查层**：我自己被一次 `PASS（改动集 6 个受管文件）` 骗过，把 PASS 读成"路径没问题"——**症状是 PASS 文案不区分"没路径"与"路径全被豁免"**，这条已在 PASS 文案里补上豁免口径说明。④ **反证层（本轮最有价值的一处）**：变异 N3 把陈旧检测整条摘掉，那条行为锁照绿——逃逸原因是断言 `match(/陈旧/)` 命中的是**固定修法文案**里的词，红由 `shrink` 顶替；四层同时失明，被抓到靠的是"逐条变异必须红且红集互不相同"这条纪律本身，而不是任何一条锁 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复四处：① 豁免判据落到**路径词元**（从片段起点延伸到下一个空白；只看提取片段会把 `mp-*` 这类判成失效，因为 `*`/`<...>`/`${}` 不在提取器字符集 `SEG` 里、片段会在它们之前截断）；② 新增按文件存量基线 `scripts/doc-abs-paths-baseline.json`（实测 429 文件 / 861 处 / 磁盘缺失登记项 0）与 `judgeBaseline` 三类 FAIL（超出 / 待收紧 / 陈旧），基线读不到一律**退出码 2**；③ 扫描域并入账本文件时加 `existsSync`，使"已删除"落到 `stale` 而不是被 `shrink` 顶替；④ `v.why` 两支文案改为可整体匹配的句式（`已不存在` / `不再受管（…）`），并把 PASS/FAIL 文案里的"跳过说明"写出来（ubuntu runner 无盘符 ⇒ 逐文件比较不执行，显式出声而非静默 PASS）。回归保护：自测 25 → **26 条全绿**，其中 9 条为本轮新增（豁免两条成对、基线五类、纯函数无盘符档、账本内容形态、本仓活体等式锁）；陈旧类按**成因**钉（FAIL 头分类计数 + 明细行专属句式 + 两条 `doesNotMatch` 负断言），另加一条"磁盘上存在但已移入归档"的夹具把 `v.why` 两支都钉住 |
| 防止再次发生（QM-5 ⑤） | PASS | 四项落盘：① **机制**——门禁本体 + 26 条自测接在 `quality-gate.yml` `changes` job（Gate 12b 跑自测、Gate 12c 扫改动集），**接线不变**，本 PR 未动 workflow 与 `CI_IGNORED_PATHS`；② **规范**——`01-docs/learnings.md` 新增「断言匹配到了消息里的词，却没匹配到成因」，四条可复用判据（分类按 FAIL 头计数 / 明细按专属句式 / **必须配负断言** / 分流两支各要一个用例）；③ **出路可复现**——`--write-baseline` 只能搭配 `--all`（窄域跑一次会把整张账本按那一两个文件重写掉），且"账本只能缩小"由 `低于基线也必须红` + `陈旧登记必须红` 两条锁共同守住，棘轮不可放宽；④ **反证**——8 条变异全部实跑且红集互不相同（`emptyRed=[] / duplicateRedSets=[] / RESTORED_BYTE_EXACT=true`），其中 N8 直接对准本轮修掉的那条缺陷（摘 `existsSync` 必须红） |
| 真仓库现场（非夹具） | PASS | 临时新增一份受管文档、内含 1 条磁盘上不存在的绝对路径 ⇒ `--all` `status=1`，头行 `FAIL：全量审计（3080 个受管文件） —— 超出存量基线 1 个文件`，明细点名该文件 `1 处 > 基线 0`；删掉探针后 `status=0`（3079 个受管文件 / 基线 429 / 现场 861 处）。六项判据全 true（`before_zero / during_one / during_names_probe / during_class_over / during_class_only_over / after_zero`）。这条是"按文件存量基线不会把新增一起豁免掉"的唯一直接证据——夹具只能证明机制，证明不了它在真域上不空转 |
| 性能实测（原写"约 0.2 s"是没量过的估计，已更正） | PASS | 同一条命令三种域各跑：无账本下限 `418 ms`（其中 `node -e 0` 自身启动 `301 ms`）；CI 实际口径 `--base=origin/main --head=HEAD` `1812 ms`（改动 25 个 + 基线并入 ⇒ 扫描 452 个文件）；`--all` 三次 `3207 / 2975 / 2842 ms`（3079 个受管文件）。⇒ 并入基线在 PR 侧净增约 **1.4 s**。账本规模 429 文件对应文本量 10.4 MB（逐条 `statSync` 实测，非估算） |
| 接线棘轮 | PASS | `scripts/check-doc-abs-paths.test.js` 早已在 `quality-gate.yml` 的 `changes` job 显式点名（Gate 12b），本 PR 只加用例、不改接线；新增文件 `scripts/doc-abs-paths-baseline.json` 是**数据文件**，其校验（活体等式锁）就跑在同一个不被短路的 job 里（AGENTS.md「进白名单的数据文件，其校验必须先待在不会被 docs-only 短路的 job」那条锁的先例口径）。`check-unwired-tests` 复跑 rc=0（见"其余本地门禁"行）、`check-step-failfast` rc=0、`node .github/scripts/check-workflow-structure.js` 未受本 PR 影响（未改 workflow） |
| 行尾与 diff 对账 | PASS | 本 PR 编辑的四份既有文件（`CHANGELOG.md`、`01-docs/learnings.md`、`scripts/check-doc-abs-paths.js`、`scripts/check-doc-abs-paths.test.js`）在 `git ls-files --eol` 全部是 `i/lf w/crlf attr/text=auto`，索引侧统一 LF ⇒ 入库内容不含行尾改动。判据实测：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相等**（`CHANGELOG.md 9 0`、`01-docs/learnings.md 42 0`）。learnings 追加走 append-only 脚本，`prefixUntouched=true` 断言"start 之前的既有区逐字不变"，新增区 11 个空行补 `\r` 后 `regionAllCrlf=true`、全文 `crlf=21204 lfOnly=0 crOnly=0`（无孤立 CR）。新文件（PRD、record、账本 JSON）用 Write 落 LF，`git add` 归一不产生漂移 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/像素基线；改动全在 `scripts/` 门禁本体、其自测与三份文档 |
| QM-6 CCG 双模型外部评审 | PENDING | 按 AGENTS.md 走 `codeagent-wrapper` 双模型并行（模型名真源 `~/.claude/.ccg/config.toml` 的 `[routing.*].primary`，执行前须先探测本机代理端口是否监听）。**本行在评审实跑后改写为 PASS 或"未跑成（如实登记）"**，不得以自审冒充通过；上一轮 clock-shift-oracle 三条外部通道均为 rc=0 且零产出，故先按 PENDING 登记，实跑结果与原样 stdout 落 `.tools/tmp` 后回填 |
| 其余本地门禁 | PASS | 逐条实跑取各自退出码（不管道、不 `| tail`）：见下方"门禁电池"小结行。`classify-docs-only.js --base=origin/main --head=HEAD`（提交后跑）判 `docs-only=false` ⇒ 混合 PR，不走精简通道，与分层判定一致 |
| 远程同步 | PENDING | 待本 PR 合并后由后续 docs 回填 PR 完成：`git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 取 merge SHA 与时间、`git ls-remote --heads origin gate-abs-path-scope` 返回 0 行证远端分支已删，改写本行为 PASS + 删除 frontmatter 三个 `sync_*` 字段 + 删除 `scripts/gate-record-debt-ledger.json` 对应登记项（**回填与销账必须同一次提交**） |

### 遗留（不假装已闭合）

- **CI 上这把等式锁能不能测到"计数"，本轮未证明**：活体锁 `本仓基线必须与现场逐文件相等` 在 `changes` job（`ubuntu-latest`）上会因 `canJudge=false` 只做陈旧核对——`over/shrink` 两支在该 runner 上**从不执行**（我实测的是本机 Windows 有盘符档）。这不是缺陷（"无法判定 ≠ 失效"），但**不得读成"CI 每次都验了逐文件相等"**。要闭合需给该 job 提供本机盘符或把等式锁改跑在 windows runner，属"改谁来守门"，未混进本 PR。
- **基线是 merge-base 时点的快照**：若 main 在我这条 PR 打开期间给某个已登记文件新增了失效路径，合并后该文件的现场计数会**高于**账本 ⇒ 下一个碰它的 PR 被报"超出存量基线"。这不是误伤（新增本来就该被拦），但回填时若 `--all` 报出这类差异，处置是**改文档**而不是把数调大；本轮推送前已按 `--all` 与活体锁各复跑一次确认自己 head 上零差异。
- 179 处"仅因加粗被豁免"的存量中，276 处净新增里含大量**已删除临时 worktree 的历史留痕**，本 PR 逐条清理既不现实也会篡改当时观测，故按文件落进账本冻结。真正的清理应等"有人碰那个文件"时顺手收紧（`低于基线也必须红` 会当场提醒）。
- 上一条记录（clock-shift-oracle）的"遗留"第 4 条描述的正是本 PR 修掉的问题。历史记录不改写（它是当时的事实快照），此处指向而不回改。
