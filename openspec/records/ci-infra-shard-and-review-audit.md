# 执行记录：QM-6 记录欠账只读审计档 + Electron CI 分片方案（ci-infra-shard-and-review-audit，2026-10-20）

> 变更类型：**质量基础设施**（`scripts/` 判据辅助 + `.github/workflows/`）⇒ 混合 PR，走完整质量节拍。
> **两处目标均命中 `HIGH_RISK_SURFACES`**（`scripts/check-`、`.github/workflows/`）⇒ 按 `AGENTS.md`
> 属「改谁来守门」，**由人工过审，agent 不自动合并**。

## 1) 变更类型与隔离

| 项 | 读数 |
| --- | --- |
| 隔离 | 隔离 worktree `<仓库父目录>/mp-worktrees/mp-ci-infra-shard-and-review-audit`（与仓库同一块非系统盘，非 C 盘），裸分支名 `ci-infra-shard-and-review-audit` |
| 入口 | `./scripts/session-init.sh ci-infra-shard-and-review-audit`，产物：`verify-worktree-deps` 11 项 OK、`ensure-electron` v43.7.7 就绪 |
| 共享根 | 留在 `main` 且 clean，未在其中落盘 |
| 分层 | 含 `.github/workflows/` ⇒ 运行/门禁面 ⇒ 必须 worktree（已满足） |

## 2) 做了什么（只读审计档）

`node scripts/check-pr-exec-record.js --audit [--json] [--limit=N]`：新增只读审计档，
把主干上累积的未闭环记录**分档并给出归因**。enforce 路径**一行未改**（`--audit` 分支
早退于一切取证之前，结构上不进判定）。

四条硬约束与对应锁（`scripts/check-pr-exec-record.audit.test.js`，**7 例**）：

| 约束 | 锁住的失败形态 |
| --- | --- |
| 不判定「已修/未修」 | 记录无 branch/PR 字段、无 finding→修复提交链接 ⇒ 任何"已修好"判定都是编的 |
| 落地归因比「文件是否在 origin/main 树里」而非 sha | squash 后主干是新对象，按 sha 判会把每个已合并 PR 误判成未落地 |
| 只读 | 跑完工作区无改动、无新提交（审计自己变成写方是最大风险） |
| 永不阻断 | 未闭环 40 条也 exit 0；仅 `--limit=abc` 这类用法错误 exit 2 |

**真实读数**（`--repo=<共享根>`，耗时 **1657 ms**，全程 **2 次 git spawn**）：

```
记录总数 : 1509 ｜ dual : 433 ｜ 已闭环 : 156 ｜ 未闭环 : 277
  pending 254 ｜ error 15 ｜ self_play_blocked 4 ｜ self_play_adjudicated 2 ｜ self_play_pending 2
已落地 433 ｜ 未落地 0
待人工看的 findings 条数（未闭环 dual 累加）: 17
```

**最重要的一条结论**：277 条未闭环里**只有 17 条 findings** ⇒ 欠账主体不是「277 个没修的
问题」，而是「277 份**没有结论**的记录」。这与 `openspec/changes/ccg-convergence-exit`
的诊断一致（验证层单轮 critic + `currentRound` 谎报 ⇒ 出口①②不可达）。所以**减少这批欠账
只能改判定写入方**，清理文件或批量补 closureNote 都不是解法。

## 3) 做了什么（Electron CI 分片：**只出方案，不提交实现**）

方案与精确补丁写在 `openspec/changes/quality-infra-2026-10/proposal.md` §What Changes 2)。
不提交实现的三条理由（任一都足以停手）：

1. 需改写「自证块必须真能执行」这把锁（`apps/desktop/tests/gui-ci-exit-contract.test.js`），
   它用文本替换后**真跑**一遍来防装饰性门禁；并行 `&`/`wait` 聚合改动会让替换点与自证
   时点都要重设计，改错正是 #2525 的原始失效形态。
2. 单片预算必须由**一次真实 main push** 给出，不能拿 `794/2` 推算（本仓反复出现的
   「把推算当实测」）。
3. 分片改变「全仓单 worker 串行」语义 ⇒ 影响该步骤原本承担的 flake 检出意图，需产品级确认。

同时更正了此前一处**我自己的不准确表述**：近 16 次 main 运行 11 次 failure 里，实证为
`rc=124` 超时的至少 3 次，**另 1 次是真失败且与超时无关**（`4a610ded4`：
`elapsed=1844s budget=2100s rc=1`，红在 `windows-file-lock.test.js` 的 Windows 时序用例）。
两者必须分开归因。

## 4) 测试

| 层 | 读数 |
| --- | --- |
| 新增锁 | `node --test scripts/check-pr-exec-record.audit.test.js` ⇒ **7/7 绿**（先写测试，6 红之后实现转绿） |
| 既有锁 | `node --test scripts/check-pr-exec-record.test.js` ⇒ 见 §6 |
| 接线 | `.github/workflows/quality-gate.yml` 增加 `node --test scripts/check-pr-exec-record.audit.test.js`，否则新锁不跑 |

## 5) 门禁

见 §6 逐条读数（提交时补齐）。

## 6) 门禁读数（本地实跑，2026-10-20）

| 判据 | 读数 |
| --- | --- |
| `node --test scripts/check-pr-exec-record.audit.test.js` | **7 / 7 绿**（先 6 红，后转绿） |
| `check-max-lines.js` | ✅ 无新增超大文件，挂账清单与现实一致（`超限=95 挂账=95`） |
| `check-unwired-tests.js` | ✅ OK（域内 112 个测试文件全部已接线或已登记） |
| `check-no-conflict-markers.js` | ✅ OK |
| `check-doc-abs-paths.js` | ✅ PASS（首次跑红：我把本机绝对路径写进记录；已改为 `<仓库父目录>` / `<共享根>` 占位符 —— 这是本仓反复出现的形态，记在此处备查） |
| `check-locale-sync.js --keys` | ✅ PASS（2180 个 key 均存在） |
| `eslint --quiet`（三个改动文件） | ✅ rc=0 |
| QM-1 打包 | **N/A** —— 本次未改 `apps/desktop/electron/**` / `packages/rpa-engine/**`，不触发 |
| QM-4 视觉 | **N/A** —— 无 UI 变更 |
| QM-6 深度审查 | **未闭合，且按规矩不由 agent 自证**：目标命中 `HIGH_RISK_SURFACES`，闭环只认 `tier=external` + 可核 evidence；`closureNote` 在这一档不够格 |

### ⚠️ 本 PR 的合并前提（写清楚，避免下个会话误判）

1. 命中两处高危面 ⇒ **必须人工过审**（`AGENTS.md`「禁止自动合并的情形」第二条）。
2. QM-6 需要**外部评审**（双后端 claude + opencode；`sh scripts/deep-review.sh --check-deps` 实测通过）。
   agent 不代签、不写 `resolution`、不把 `pending` 改成闭环词。
3. 分片方案只是文档，未改 `electron-ci.yml` ⇒ 本次不改变任何 CI 行为。


## 7) 外部评审第 1 轮处置（真跑了外部 critic，不是自扮演）

`sh scripts/deep-review.sh` 实跑：`判定: DUAL`（变更 380 行 > 200 行阈值）、
`跨家族校验 proposer=opencode critic=claude 通过`、`critic=claude` 真实返回
**6 条 issues**、维度分 `correctness=6 security=7 performance=5 maintainability=4`。
引擎随后进入自扮演（`status=self_play_pending`，4 条待裁决）。

逐条处置（**没有一条靠"看起来没问题"打发**）：

| # | 严重度 | critic 主张 | 处置 | 证据 |
| --- | --- | --- | --- | --- |
| i1 | Critical | 判定记录 `.ccg/reviews/8998…json` 的 `sha=337d8f9ff` 与 PR head `0ac3db3de` 不符，「审计证据与被审提交脱钩」 | **dismissed（误报）** | `337d8f9ff` 恰等于 `HEAD^`：pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上是引擎自述的预期行为（`deep-review.sh` 当场打印「pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上——这是预期行为」）。已用 `git rev-parse HEAD^` 双向核对 |
| i2 | Warning | 审计模块自定义 `CLOSED_STATUSES`，与判据本体的白名单两处独立定义，未来同步易漏 | **已修**（不重构 enforce 路径，改为加「同真源」锁） | 新增用例「i2：审计模块的闭环白名单必须与判据本体的白名单逐字一致」——三个词缺一则红、多出一词也红（多词=放宽闭环口径）。不直接重构是因为 enforce 路径属高危逻辑，改它会把「防漂移」变成「引入回归」 |
| i3 | Warning | `proposal.md` 把已落地实现与未落地分片方案混在一篇，文档边界模糊 | **已修** | 拆成 `proposal.md`（只写已落地的 `--audit`）+ `design-electron-ci-shard.md`（明确标注「未提交实现」并列出为何不提交） |
| i4 | Warning | 审计同步读全部记录、无流式，随记录数线性增长 | **部分采纳** | 「线性读文件」当前不是瓶颈：1509 份记录 **1657 ms**，且全程只有 **2 次 git spawn**（瓶颈在 spawn 不在 IO，见 `fix-precommit-reviews-spawn-storm` 登记的 1175 ms/次拥堵读数）。已把「耗时 + spawn 数」写成**性能基线**供后续回归对照；流式处理属过早优化，未做 |
| i5 | Info | `--repo` 接受任意目录，可能读非项目目录 | **已修** | 空结果时输出「未找到任何记录文件：`<repo>/.ccg/reviews`（若路径给错…）」，把"静默 0 条"改成可诊断；新增用例锁定该文案 |
| i6 | Info | `.github/workflows` 注释是中文，自动化门禁可能无法识别 | **dismissed（误报）** | 本仓代码/注释/提交信息一律中文（`AGENTS.md`「语言约定」）；门禁不解析注释语义，它匹配的是 `run` 正文与表达式。译为英文反而违反仓内约定 |

**审查轮次记录**：第 1 轮 = 上述 6 条；i2/i3/i5 已修并各带回归锁或文档边界，
i1/i6 逐条给出可核证据。**本轮不自行把 `status` 改成闭环词**：
本 PR 命中高危面，闭环只认 `tier=external` + 可核 evidence，须由人工/外部复核确认。

## 8) 外部评审第 2 轮处置（审**已修**版本，非旧版）

第 2 轮实跑：`判定: SINGLE`（本次 diff 33 行）、`critic=claude` 返回 **6 条**、
维度分 `correctness=6 security=7 performance=6 maintainability=5`（第 1 轮最低分 4 → 本轮 5）。
critic 明确反驳了我第 1 轮的两条处置，并且**它是对的**：

| # | 第 2 轮主张 | 处置 |
| --- | --- | --- |
| i1 | Critical：我驳回 i1 靠的是「HEAD^ 是父 sha」这条**没有落进代码/测试**的口头契约 ⇒ 审计证据仍然模糊 | **已修，且立刻抓到真问题**：审计新增「记录 sha 可解析性」读数（`git cat-file --batch-check` 批量，**仍是 1 次 spawn**），把契约自证出来。实跑发现 **3 条 sha 不可解析**的记录，且文件名是人工命名（`2429ce1a3-logic.json` / `-maintainability.json` / `-maintainability-pass2.json`），不是引擎按内容哈希生成的 ⇒ 存在手写记录挂了不存在的 sha |
| i2 | Critical：相等测试只**发现**漂移、不**消除**漂移；应从源头 import 删掉副本 | **已修（按它说的做）**：新增 `scripts/lib/exec-record-statuses.js` 作为唯一真源，判据本体与审计模块都 `require` 它，两侧字面量副本全部删除。回归锁改为「同一对象引用 + 判据本体不得再有字面量 Set」。既有 113 例判据测试全绿，说明这次真共享没伤 enforce 路径 |
| i3 | Warning：未落地的 `design-*.md` 无机器可读标记，读者可能误认它已生效 | **已修**：加 `implemented: false` / `kind: plan` / `affects_ci_behavior: false` frontmatter |
| i4 | Warning：只凭单次快照就断言「不是瓶颈」，增长未测；应给阈值 | **已修（按它给的形态）**：写死阈值 —— 审计 **> 5 s** 或记录 **> 5000 条** 必须重新评估读取方式并给实测依据；那之前加复杂度属过早优化 |
| i5 | Info：空结果文案够用，字符串匹配测试略脆 | 维持（可选改进：从模块导出文案常量） |
| i6 | Info：中文注释符合 `AGENTS.md` 约定 | 维持 |

**这一轮的收获不是"又修了几条"，而是 critic 把我两条「我已处置」打回成 Critical 后，
其中一条（i2）促成了真正的单一真源、另一条（i1）促成了一个立即发现 3 条坏数据的新读数。**
如果第 1 轮我就此宣布闭环，这两件事都不会被发现。

## 9) 保留门禁

变更类型与隔离 ✅ | 行尾对账（以 CI 为准）| 品牌残留（以 CI 为准）| 文档同步 ✅（PRD 无需改；
本文 + change proposal 即文档）| 执行记录 ✅ | 远程同步 ⏳

| 远程同步 | 由门禁推导 |
| --- | --- |
