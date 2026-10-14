---
record: gui-gate-required-record
task: 把 GUI Gate Result 写入 ruleset main-ci-gate 的 required 清单（改「谁来守门」，经用户授权），并更正本仓两处已被该变更推翻的旧陈述
date: 2026-10-14
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；远程同步这一行的证据只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
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
| 远程同步 | PENDING | 待本 PR 合并后由后续 docs PR 同一次提交内改写 PASS + merge SHA（`git log origin/main --grep='(#NNNN)$' --format=%H\|%cI`）并删除本文件顶部三个 `sync_*` 字段与 ledger 登记项 |

### 成本与收益的现场读数（不写推测）

- **阻塞成本实测为 0**：#3578 落地前后 9 天窗口内 449 条终结态 PR 侧 GUI 运行 = 413 success / 29 cancelled / 7 failure；逐条回溯到「已合并 PR 的最终 head」交集为 **failure 0/7、cancelled 0/29**（7 条失败全部落在中间提交，后续 push 自行修好，例：#3513 红在 `8f80d539`，最终 head `a3298072` 于 19:56 报 success 后 20:31 合并）。
- **对照更脏的既有 required**：同窗口 `quality-gate.yml` PR 侧为 208 success / 60 cancelled(18.7%) / 53 failure(16.5%)——本仓已经容忍一条比 GUI 干净度差一个量级的 required，所以新增摩擦严格小于既有面。
- **收益不是「拦下 7 次合并」**（那 7 次本来也没漏进主干），而是把「检查整体不存在」变成拦得住：`gui-test.yml` 曾因 `defaults:` 下空值 `run:` 节点被 GitHub 编译器整份拒绝，main 连续 530 次 push 零 job、同期 124 个 PR 合入而无人察觉。今天再坏一次，唯一会出声的就是 required 语义本身。
- **没被我说成实测过的东西**：「红/缺即拦」是 GitHub required 语义的定义，我没有为了证明它去制造一次红；本笔现场只观察到 `#3577` 交付 `GUI Gate Result=pass`、`#3585` 该作业 pending、`#3376` GUI 家族完全缺席（但其 `mergeable=CONFLICTING`，合并早被冲突挡住，与本变更无关）。

### 我自己在这轮里犯的、必须留痕的三个错

1. **把 #3578 的 merge SHA 写成 `f1c92cbe32813d58460769568a3d252dc444c40c9`**——前 9 位正确，后 31 位是从隔壁 #3580 的 SHA 拼来的。它形状合法（40 位十六进制），只有 `git cat-file`/`git diff` 会拒绝，而它已经驱动过一次判据。真值 `f1c92cbe3495fac4419372bd353ca390290fc3ad` 由 `git log origin/main --grep='(#3578)$'` 当场取回。
2. **第一次 PUT 打到空 owner**：`gh api -X PUT "repos/$owner/..."` 里的 `owner` 定义在上一条 Bash 调用里，而 shell 状态不跨调用 ⇒ URL 变成 `repos//rulesets/...` 返回 404。当场用「`updated_at` 仍是 2026-09-21 + 清单仍 6 条」证明**什么都没改**，不是半途写入。
3. **`OUT=<path> node -e ...` 把环境变量写在命令之后**（同一会话第三次踩同一条），以及**门禁报告的归属用 `grep -qF` 在正文里找**——后者造成一条伪命中（把别处一段含 "CHANGELOG.md" 的乱码路径读成「CHANGELOG.md 在失效清单里」），改为只提取报告的文件头行整行匹配，并加「清单非空」断言。

### 遗留（不假装已闭合）

- 本笔只把 `gui-test.yml` 一条送进 required。同类「触发层正向 paths ⇒ 检查可整体缺席」的形状在**其他** workflow 上仍未被机器拦（#3578 的锁只覆盖 gui-test），因为「哪些检查有资格进 required」本身是人工裁决。
- 「等授权」这类无限期决策欠账没有机械追踪面（远程同步 ledger 只管状态行）。要做的话，前提是仓内维护一份 required 清单镜像，与「required 只存在 GitHub 侧」的既有结论正面冲突，未在本笔顺手实现。
- `#3376` 这条 open PR 在其 head 上从未有过 GUI 家族检查；按本记录的自然实验，它 re-sync 后即可交付，但若长期不 re-sync，它也不会有「Expected」占位——这个差异我没有用实验穷尽，如实标注为未验证。
