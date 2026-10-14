---
record: gui-gate-required-record
task: 把 GUI Gate Result 写入 ruleset main-ci-gate 的 required 清单（改「谁来守门」，经用户授权），并更正本仓两处已被该变更推翻的旧陈述
date: 2026-10-14
---

## 本次执行记录：GUI Gate Result 进 required 清单（gui-gate-required-record，2026-10-14）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 变更本体是 **GitHub 侧机器配置**（ruleset），不触碰仓内运行面；仓内落笔只有 `openspec/records/`、`.quality-gates.md`、`CHANGELOG.md`、`AGENTS.md`、ledger ⇒ docs-only 形态。隔离方式：`scripts/start-mp-task.ps1 -TaskName gui-gate-required-record -NoDeps` 建 worktree `mp-worktrees/mp-gui-gate-required-record`、裸分支 `gui-gate-required-record`，`git rev-parse HEAD`=`9d7ad804c` 且 `git merge-base --is-ancestor origin/main HEAD` 成立（落后 0）。**没在共享根就地改**的原因是当场量到的：本地 main `7807d9b3` 滞后于 origin/main，而 `CHANGELOG.md`/`.quality-gates.md` 各有 29/63 次未吸收的上游改动，`ff-only` 需要 git 往 `apps/` 等受守护路径写文件 |
| 第一性原因（QM-5 ①） | PASS | 这条检查此前**不可能**进 required：`gui-test.yml` 的 PR 触发带正向 `paths` 白名单，不匹配时整条 workflow 不启动、GitHub 连 check run 都不产生（触发层过滤与 required 语义结构冲突），把它加进 required 会得到「永远不到来」的死锁。#3578（`f1c92cbe3`）把路径判定下沉到作业层并补 `GUI Gate Result`（`if: always()` 聚合）之后，「缺席=红」才取代「缺席=静默」成为可能。所以本笔的真正前提是那一次形状修复，而不是这次点一下开关 |
| 逃逸分析（QM-5 ②） | PASS | ①**决策层**：#3578 记录里「进 required 这一步没做，等用户授权」写成遗留项后，没有任何东西追踪这笔欠账——它不在 `gate-record-debt-ledger.json` 的语义域内（那里只管远程同步行），所以「等授权」可以无限期躺着。②**判据层**：required 清单只存在 GitHub 侧，仓内无对账面（`workflow-contract.test.js` 能锁 workflow 文本，锁不到 ruleset 内容），因此「清单里有没有这条」不会被任何测试问起。③**观测层**：既有 required 检查全绿时，没人能从 PR 上看出「GUI 这条只是恰好不在清单里」——它与「在清单里且通过」在 `gh pr checks` 里同形 |
| 修复 + 回归保护（QM-5 ④） | PASS | **动作**：`gh api -X PUT repos/Colinchiu007/mulpub/rulesets/23749994 --input payload.json`，载荷由备份 `D:/Data/projects/.tools/rulesets/main-ci-gate-before-20261014-194631.json` 程序化派生（node 读→只剥读只字段 `id/node_id/created_at/updated_at/source/source_type/_links/current_user_can_bypass`→向 `rules[0].parameters.required_status_checks` 追加 `{"context":"GUI Gate Result"}`），**不手写载荷**。**回归保护三条**：①净变化对账——`only_added=["GUI Gate Result"]`、`only_removed=[]`，`strict/do_not_enforce_on_create/conditions/enforcement/target/name/bypass_actors` 逐字段与备份相同，`NET_CHANGE_IS_EXACTLY_ONE_CONTEXT=true`（PUT 会静默清空未提交字段，这条就是防它）；②**取名字符串以现场 check-run 为准**，不按 YAML 键猜——`gh api commits/26d13b3c5/check-runs` 实测到 `GUI Gate Result => success`、`gui-test => skipped`、`GUI Changes => success` 三个真名，收的是聚合作业名而非 `gui-test`/`GUI Tests`（收 `gui-test` 会留「判据作业坏了⇒skipped⇒假通过」的洞）；③**冻结核销**：加 required 会让分支树内不含该作业定义的陈旧 PR 永远交不出检查吗——用 #3578 落地后 11 条 PR 侧运行做自然实验，得 **7 条 agree + 2 条反例**（`59379f439d`/`09039bc1c1`/`48f70dfeb0` 三个 head 的树内 `gui-test.yml` 里没有 `GUI Gate Result` 字样，却在同一 sha 上产出了该检查）⇒ 证明 PR 侧解析的是**合并提交**（含 base 的新文件），不是 head 的旧文件，因此 re-sync 即可交付，不存在永久冻结 |
| 防止再次发生（QM-5 ⑤） | PASS | ①同次更正两处已被本变更推翻的陈述：`AGENTS.md:696` 的「`GUI Tests` 不在 ruleset(6) ∪ classic protection(4) 的任一 required 清单里」与 `openspec/records/gui-test-required-shape.md` 远程同步行/遗留项 1 的「required 清单未动、不含任何 GUI 条目」——**保留原文并追加更正**，不把改过判断抹平成一开始就对。②把「等授权」这类无限期欠账的形状记进本记录，供下一个会话判它值不值得进机器面（正解候选：让 PR 判据打印「已 required 但本次未交付」的 context 差集，那需要仓内维护一份 required 镜像，与本仓「required 清单只存在 GitHub 侧」的既有结论冲突，故未在本笔顺手实现）。③回滚凭据留在仓外但可寻：`main-ci-gate-before-20261014-194631.json`，回滚 = 用该文件做载荷再 PUT 一次 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 在同次提交后取证（见 `.quality-gates.md` 本笔块的保留门禁行）；新建文件为 LF，`AGENTS.md`/`CHANGELOG.md`/`.quality-gates.md` 现况为 `i/lf`（2026-10-05 control-bytes-sweep 后已是纯 LF blob），不做任何统一回写 |
| 接线棘轮 | N/A | 本笔未新增任何 `*.test.*` 文件；required 清单内容本身不可被仓内测试接线（见逃逸分析 ②），如实写 N/A 而不是假装有新锁 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 面 |
| QM-6 CCG 双模型外部评审 | 未执行（如实记录） | 本笔仓内改动是纯记录/文档，判据层零代码；被评审的动作（PUT ruleset）发生在 GitHub 侧、无法以 diff 形式交给外部模型。**不以自审冒充双模型通过**；该动作的人工过目由用户在授权环节承担（AGENTS.md 把「改谁来守门」明确划给人工） |
| 远程同步 | PASS | PR #3590 已 squash 合入。**双源同 SHA**：`gh pr view 3590 --json state,mergedAt,mergeCommit` ⇒ `state=MERGED / mergedAt=2026-10-14T13:09:20Z / mergeCommit=`6748c0d90d51438c9a920e2b714ca22978f82c51`；`git log origin/main --grep='(#3590)$' --format=%H\|%cI` ⇒ `6748c0d90d51438c9a920e2b714ca22978f82c51|2026-10-14T21:09:20+08:00`（恰好 1 行）。**远端分支已删**：`git ls-remote --heads origin gui-gate-required-record` ⇒ rc=0 且 0 行。**落地判据**：`git diff --stat 5e916988e 6748c0d90d51438c9a920e2b714ca22978f82c51` 输出为空 ⇒ 分支 tip 的内容逐字进主干（本轮 main 未前进，所以树相等成立；上两轮合并时该判据被他人提交污染成 24 文件差量，故当场改用逐文件 blob 比对）。**required 现状（合并后复核）**：`gh api repos/Colinchiu007/mulpub/rulesets/23749994` 仍回 7 条并含 `GUI Gate Result`；classic protection 仍 4 条未动。**这笔 PR 自身就是新语义的第二个现场样本**（两次 head 各一次）：`GUI Changes=pass → gui-test=skipping → GUI Gate Result=pass`。 |

### 成本与收益的现场读数（不写推测）

- **阻塞成本实测为 0**：#3578 落地前后 9 天窗口内 449 条终结态 PR 侧 GUI 运行 = 413 success / 29 cancelled / 7 failure；逐条回溯到「已合并 PR 的最终 head」交集为 **failure 0/7、cancelled 0/29**（7 条失败全部落在中间提交，后续 push 自行修好，例：#3513 红在 `8f80d539`，最终 head `a3298072` 于 19:56 报 success 后 20:31 合并）。
- **对照更脏的既有 required**：同窗口 `quality-gate.yml` PR 侧为 208 success / 60 cancelled(18.7%) / 53 failure(16.5%)——本仓已经容忍一条比 GUI 干净度差一个量级的 required，所以新增摩擦严格小于既有面。
- **收益不是「拦下 7 次合并」**（那 7 次本来也没漏进主干），而是把「检查整体不存在」变成拦得住：`gui-test.yml` 曾因 `defaults:` 下空值 `run:` 节点被 GitHub 编译器整份拒绝，main 连续 530 次 push 零 job、同期 124 个 PR 合入而无人察觉。今天再坏一次，唯一会出声的就是 required 语义本身。
- **没被我说成实测过的东西**：「红/缺即拦」是 GitHub required 语义的定义，我没有为了证明它去制造一次红；本笔现场只观察到 `#3577` 交付 `GUI Gate Result=pass`、`#3585` 该作业 pending、`#3376` GUI 家族完全缺席（但其 `mergeable=CONFLICTING`，合并早被冲突挡住，与本变更无关）。

### 我自己在这轮里犯的、必须留痕的四个错

1. **把 #3578 的 merge SHA 写成 `f1c92cbe32813d58460769568a3d252dc444c40c9`**——前 9 位正确，后 31 位是从隔壁 #3580 的 SHA 拼来的。它形状合法（40 位十六进制），只有 `git cat-file`/`git diff` 会拒绝，而它已经驱动过一次判据。真值 `f1c92cbe3495fac4419372bd353ca390290fc3ad` 由 `git log origin/main --grep='(#3578)$'` 当场取回。
2. **第一次 PUT 打到空 owner**：`gh api -X PUT "repos/$owner/..."` 里的 `owner` 定义在上一条 Bash 调用里，而 shell 状态不跨调用 ⇒ URL 变成 `repos//rulesets/...` 返回 404。当场用「`updated_at` 仍是 2026-09-21 + 清单仍 6 条」证明**什么都没改**，不是半途写入。
3. **`OUT=<path> node -e ...` 把环境变量写在命令之后**（同一会话第三次踩同一条），以及**门禁报告的归属用 `grep -qF` 在正文里找**
4. **字节级「末行插一条」把文件的 EOF 换行吃掉了**：`ledger-insert.js` 里 `raw.slice(0, closeIdx).replace(/\s+$/, '')` 之后再 `raw.slice(closeIdx + 1).replace(/^\s+/, '')`，第二个 replace 正好删掉了 `}` 后面那唯一的 `\n`。提交后逐文件对账 `HEAD~1` vs `HEAD` 的 `ends_nl` 才发现（其余 5 个文件 same，只有它 `true → false`）。**教训**：行尾对账不能只跑 `git diff --numstat` 两口径——它抓的是 CR，抓不到「尾换行被吃掉」；改完文件必须逐文件断言 `ends_nl` 前后相同，或干脆用 `split/join` 而不是 `slice+trim` 拼装。——后者造成一条伪命中（把别处一段含 "CHANGELOG.md" 的乱码路径读成「CHANGELOG.md 在失效清单里」），改为只提取报告的文件头行整行匹配，并加「清单非空」断言。


### 合并前两度 re-sync（置顶型文档与 ledger 的并发竞争，2026-10-14 实测）

- **第一轮**：上游两个回填 PR（#3587/#3588）在 `scripts/gate-record-debt-ledger.json` 里**删掉 2 条销账项**，与我新增的那一条落在同一区域 ⇒ `mergeable_state=dirty`，GitHub 因冲突**根本没排队任何 workflow**（`check-runs` 总数 0、`gh run list --branch` 空）。当时我把「检查一条都没来」先当成 CI 故障，量出 `mergeable_state=dirty` 才定性——**判据：PR 无检查先读 mergeable，别先怀疑 runner**。解冲判据是内容断言而非「取后推」：`ours=20 → merged=21`、我的键在位、且被上游撤销的 2 条**保持缺席**（`revoked_present=[]`）。
- **第二轮**：main 又进 2 个提交（#3589 及其回填），两个**置顶型文档**同时冲突。第一版解法我写的块边界正则是 `process.env.HEAD_RE === "hash" ? /^# / : /^## /`——CHANGELOG 是 `# ` 形态而我**没传该环境变量**，于是静默落到 `/^## /`，边界一路扫到 **125 行**才停，把上游 **15 个条目**当「我的块」复制了一份。
- **为什么当场三条自证全绿却仍是坏的**：`upstream_lines_kept=true`（多重集包含对**复制**天生免疫）、`my_lines_kept=true`、`conflict_markers=0`、`ends_nl=true` 全部为真。抓住它的是两条**不复用该算式**的读数：① `merged_lines - upstream_lines = 125` 与预期 9 行差得离谱；② 统计一级条目头（`# ` 开头的行）合并后 **467**，而 stage2 与 stage3 各自 **452**。正解是加一条硬断言 `merged_heads === upstream_heads + my_block_heads`，并把块边界正则改成**无默认值、缺失即 throw**（同一脚本对 `.quality-gates.md` 是对的——它确实是 `^## ` 形态，13 行；一份默认值在两文件上一对一错，正是「看起来在工作」的危险形态）。
- 重复计数校验还要与 `:2:`/`:3:` 各自的计数对照才算数：`# CHANGELOG` 在合并后出现 4 次，但两侧本来就各 4 次，属既有事实而非我造的重复。

### 第五条自留错误（写这条纪律的当场又犯了一次它描述的那个错）

- 我给记忆文件追加「置顶冲突解法器不得用带默认值的块边界正则」这条时，用 Edit 把**旧条目的首行**当 `old_string`、`new_string` 末尾虽重放了它，但重放的文本与文件里的引号形态不同 ⇒ 旧条目首行仍被吞、其续行变成无头孤儿。**发现方式**：写完 `grep -c 关键短语` = 0（而不是我以为的 1），再 `sed -n 208,213p` 直接读那一片。修复走「行数组 splice + 幂等守卫前置 + 行数守恒断言（299→300）+ 命中数恰为 1」，全程不用字节下标。**再次印证本仓那条老结论：记忆与自觉对这类错误无效，能挡住的只有免错写法与写完的计数断言。**

### 遗留（不假装已闭合）

- 本笔只把 `gui-test.yml` 一条送进 required。同类「触发层正向 paths ⇒ 检查可整体缺席」的形状在**其他** workflow 上仍未被机器拦（#3578 的锁只覆盖 gui-test），因为「哪些检查有资格进 required」本身是人工裁决。
- 「等授权」这类无限期决策欠账没有机械追踪面（远程同步 ledger 只管状态行）。要做的话，前提是仓内维护一份 required 清单镜像，与「required 只存在 GitHub 侧」的既有结论正面冲突，未在本笔顺手实现。
- `#3376` 这条 open PR 在其 head 上从未有过 GUI 家族检查；按本记录的自然实验，它 re-sync 后即可交付，但若长期不 re-sync，它也不会有「Expected」占位——这个差异我没有用实验穷尽，如实标注为未验证。
