---
record: ccg-convergence-exit
task: 把「CCG 深度审查为什么必然落在 self-play」从形容词变成可复跑读数，并把这条读数接进 CI
date: 2026-10-17
branch: ccg-convergence-exit
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 回填 PASS + merge SHA，并在同一次提交删除本 frontmatter 的 sync_* 三字段
sync_backfill_owner: 本会话（合并后立即回填）
---

# 执行记录：CCG 收敛出口可达性探针（ccg-convergence-exit，2026-10-17）

## 0. 动因（用户指令）

#3724 收尾时我报告「含 crypto 发现的 diff 上深度审查闭环不可达」，用户问「补 vendor 引擎那个出口是什么」，随后指令：**「按你的建议做。应用质量节拍」**——建议的内容是：先归因、只出诊断，不悄悄改上游引擎。

本记录交付的就是那条建议的产物：**一个可复跑的探针 + 它的回归锁 + CI 接线**。

## 1. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 工具脚本（`scripts/`）+ CI 接线 + 规格/文档；**零运行时代码** |
| 隔离方式 | 独立 worktree `<仓库父目录>\mp-worktrees\ccg-convergence-exit`，裸分支 `ccg-convergence-exit`，基线 `origin/main` |
| 分层判定 | 按 docs-only 通道**不适用**（本 PR 动 `.github/workflows/`，属混合 PR）⇒ 走完整门禁；但**不动 `apps/` / `packages/`**，故 QM-1 打包、QM-4 视觉为 N/A |

## 2. 归因结论（先否证自己，再落文档）

引擎有三个停止出口，验证层只跑一轮且刻意把轮次字段报成 `maxRounds`，叠加后：

| 出口 | 验证层可达性 | 实测读数 |
|---|---|---|
| ① 分数收敛 | 不可达 | 人工构造第 2 轮打到阈值 8 ⇒ `converged`（缺的是**轮次**不是出口） |
| ② stall | 不可达 | `isStalled([单轮]) ⇒ stalled=false（轮次不足）` |
| ③ 轮次耗尽 → self-play | **唯一可达** | `status=self_play reason=selfPlay stop=true` |

**被否证的初判**：我先前写过「大概是 stall 判据误触」。实测直接否证——单轮下 stall 恒不成立。正解是 ③ 唯一可达，而 ③ 对 `highRiskDomains` 非空的条目**无条件计阻断**，且引擎没有任何字段能表达「这条已由外部模型复核过」。

现场产物：`.ccg/reviews/24cf2d8f…json`（PR #3724，被审 commit `5d660809a`）里 `deepReview.status=self_play_blocked`、`performedBy=self-play`、6 条 findings 中 2 条 `crypto`（i2 Critical / i4 Warning）、`blocking` 3 条。

## 3. 实现

- `scripts/ccg-convergence-probe.js`：`locateVendor`（候选顺序同 `deep-review.sh`）+ `readVendorSources`（**一处**定义读哪两份）+ `readDefaults`（6 个参数全现读）+ `readDriverTaskShape`（从驱动源码读形状，不照想象构造）+ ladder 四格 + 三档退出码（0 符合 / 1 偏离 / 2 取不到数）。
- `scripts/ccg-convergence-probe.test.js`：P1 契约（两档都必须有产物，缺引擎档断言 rc=2 且文案含「探针失明」）、P2 cfg 派生锁（含**反向**断言：只喂 engine 时 `confidenceWeight` 必须 null、只喂 driver 时 `maxRounds` 必须 null）、P3 漂移行为锁（真跑被改形的 vendor 夹具 ⇒ rc=1 + A/B 对照）、P4 fail-closed、P5 夹具出处、P6 零第三方依赖。
- `openspec/changes/ccg-convergence-exit/artifacts/verification-layer-sample.json`：真记录逐字段摘录（实测 6 条 finding 全部 `fieldDiff=none`）。
- `.github/workflows/quality-gate.yml`：changes 作业新增 `Gate 2b6`。
- `.gitignore`：`!scripts/ccg-convergence-probe.js`。

## 4. TDD 与变异（先看红，再看牙）

| 阶段 | 读数 |
|---|---|
| 首跑 | **2 failed**：P1 `Unexpected non-whitespace character after JSON at position 1117`；P2 「vendor 源码里读不出 confidenceWeight」 |
| 按 D2/D4 修判据本体后 | **GREEN：tests 6 / pass 6 / fail 0**，rc=0（复跑三次一致） |
| 变异 MP1–MP5 | **CAUGHT**（MP3/MP4 指名红；MP1/MP2/MP5 连带动 P1/P2/P3） |
| 变异 MP6 | **ESCAPED，如实记账**：P1 直接断言读数本身、不信探针自评 ⇒ 属**防御重叠**，不写成「锁已验证」 |
| 还原核对 | `restore md5 ok=true`，变异只改判据本体、不动测试文件 |

## 5. 三条本轮真实踩到的坑（都改成了判据，不是改成注意事项）

1. **`--json` 档多嘴**：JSON 之后继续写人读结论行 ⇒ 调用方 `JSON.parse` 抛错，报错文案读起来像「探针坏了」。正解：机器档 stdout 只放 JSON，人读行走 stderr（P1 钉住）。
2. **「读哪两份源码」不能两处各写一遍**：`maxRounds/threshold/stallRounds/stallScoreDelta` 只在 `engine.js`，`confidenceWeight/selfPlay.enabled` 只在 `ccg-deep-review.js`。测试第一版只喂 engine ⇒ 两键恒 null，而「探针读不出参数」被读成「判据是硬的」。正解：`readVendorSources` 单点定义 + P2 反向断言「单喂任一份必须读不出对应键」。
3. **`CCG_ARL_DIR` 指技能根、探针自己再拼 `scripts/`**：把已含 `scripts` 的路径传进去 ⇒ 探针静默回落真 vendor，夹具根本没被用上。正解：P3 加正控「JSON 里的 `vendor.engine` 必须命中临时目录名」。

另记一条**工具层**事实（不是代码问题但会骗人）：一行里 `real[k])` 的 `]` 在渲染中显示为存在、磁盘字节实际缺失（码点序列 `5b 6b 29 29`），导致 Edit 匹配不上而 `node --check` 报 `Unexpected token ')'`。判结构错位一律看**码点序列**，不看终端渲染；修复走字节级 splice，**写盘前** `vm.Script` 整份 parse、写盘后回读码点与行数对账（138→140）。

## 6. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree + 裸分支（第 1 节） |
| TDD | PASS | 首跑见证红 2 条 ⇒ 修判据后 6/6 绿 |
| 变异反证 | PASS（含 1 条 ESCAPED 如实记账） | MP1–MP5 CAUGHT、MP6 防御重叠 |
| 接线三守卫 | PASS | `check-unwired-tests.js`（94 个测试文件 OK）、`check-step-failfast.js`（37 步 OK）、`check-workflow-structure.js`（files=14 violations=0） |
| gitignore negation | PASS | `git check-ignore --no-index -v`：改前命中 `106:scripts/*.js`，改后命中放行规则；`git status` 由「文件不存在」变 `??` |
| 行尾两口径对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 均为 `13/0`、`4/0`；新建文件为 LF |
| 品牌残留 | PASS | 文档内不含竞品品牌名（引擎与驱动按 `vendor` / 上游技能称谓写） |
| 受管文档绝对路径 | PASS | 记录与规格一律用占位符 `<仓库父目录>\mp-worktrees\<任务名>`；提交后跑 `check-doc-abs-paths.js --base=origin/main --head=HEAD` 复核 |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-4 视觉回归 | N/A | 无 UI 文件改动 |
| QM-6 双模型评审 | 见第 7 节 | 变更规模判定 |
| 远程同步 | PENDING | 合并后回填 PASS + merge SHA，并同次删除本 frontmatter 的 `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | 变异反证 ✅ | 接线三守卫 ✅ | gitignore ✅ | 行尾对账 ✅ | 文档同步 ✅ | 远程同步 PENDING

## 7. QM-6：真实双模型评审的逐条处置

`scripts/ccg-review-decider.js` 判 **DUAL**（变更 416 行 > 200 行阈值、5 个源文件、无敏感命中）。按用户指令**真跑**双模型（proposer=opencode / critic=claude，跨家族校验通过），不是内部模拟。

| 项 | 严重度 | 裁决 | 处置与证据 |
| --- | --- | --- | --- |
| i1 夹具只复制 engine.js+驱动 | Critical | **upheld** | 会让 `require` 失败把「偏离(1)」伪装成「失明(2)」，与本篇「三档不混档」自相矛盾 ⇒ P3 改整目录复制 + 文件数下界断言 |
| i2 `locateVendor` 回落仓库自身目录后 `require()` | Critical | **upheld** | **真代码执行面**：任何 PR 提交 `scripts/engine.js` + `scripts/ccg-deep-review.js` 即可让 Gate 2b6 执行该 PR 的代码；其余两个候选都需写权限 ⇒ 威胁面为本 PR 新造。删回落 + 新增 P7 结构锁；变异 **MP7 实测指名让 P7 变红** |
| i3 CHANGELOG 含工程细节 / 写着 PENDING | Warning | dismissed | 既有 489 个标题块同体例，Gate 2c3 只判集合单调性（实测 489→490 PASS）；PENDING 是协议规定的中间态，当缺陷处理会诱导未合并先写 PASS |
| i4 放行依赖注释里的行号 | Warning | dismissed（换判据接住） | 机制不成立：生效的是路径规则（`git check-ignore --no-index -v` 打印规则命中行）。但换成**规则顺序**就有牙 ⇒ 新增 P8，负控「末尾追加同名忽略规则」**实测 CAUGHT**，还原 `md5 ok=true` |
| i5 正则无缓存 | Warning | dismissed | 实测 8 条用例约 1.5 秒；加缓存会把「读不到」与「读到旧值」合并，削弱 D2 的现读前提 |
| i6 未引用 tasks §7 三条出路 | Warning | dismissed | 同块「诚实边界」原文逐字已引用，指控的事实前提不成立 |

裁决按引擎模板逐条填 `prosecution / defense / verdict / rationale`，**写前校验**每格非空、verdict 只取 `upheld|dismissed`、`critiqueFingerprint` 不碰；**status 一律由引擎算，仓侧不手写**。复用存档 critique 的 resume 路径零模型调用完成判定：`status=self_play_blocked`，`blocking=[i1 i2 self_play_upheld]`。

### 7.1 本 PR 自己就是所描述结构的一个实例（不是修辞）

评审日志两行 —— `收敛判定: status=self_play reason=selfPlay minScore=4`、`待裁决 6 条；其中高危域必须外部复核 0 条` —— 与探针 ladder 读数逐字同形，同时**收窄了本篇原来的表述**：③ 的阻断不只在 crypto 域，`self_play_upheld` 与域无关。两种子形态修法不同（高危域在 ③ 内永解不开；upheld 项能判 `dismissed` 但判对了就不能撤）。

更硬的一条现场：i1/i2 **都已修并各带锁**，而记录 `db3c1d29…json` 仍带 `self_play_blocked` 留在变更集里 —— 引擎没有任何字段表达「已在其后提交修复」，且该记录按父提交入库、`deep-review` 只服务当前 HEAD ⇒ 永久无法回补。这就是 D8 里「不在本 PR 放宽闭合词表」的原因：仓侧硬凑等于再造一份口径。**因此本 PR 由 `check-pr-exec-record --mode=enforce` 判不可自动合并，需人工合并。**

### 7.2 修复后的复跑读数

| 判据 | 读数 |
| --- | --- |
| `node --test scripts/ccg-convergence-probe.test.js` | **tests 8 / pass 8 / fail 0**（P1–P8），rc=0 |
| 变异 MP7（把 `__dirname` 回落加回来） | CAUGHT，failing=P7 指名；还原 `md5 ok=true` |
| P8 负控（`.gitignore` 末尾追加同名忽略规则） | CAUGHT，failing=P8；还原 `md5 ok=true` |
| `scripts/openspec-sync-check.js` | OK |

## 8. 与 #3724 的关系

两条 PR 判据互不依赖，可任意顺序合并。步骤编号上：#3724 占用 `Gate 2b5 - CCG evidence anchor`，本篇取 `Gate 2b6`，避免 squash 后两步同名被读成一条。
### 7.3 QM-6 第二轮（修复提交 653f24bfe 的真实双模型评审）

| 项 | 严重度 | 域 | 裁决 | 处置 |
| --- | --- | --- | --- | --- |
| i1 记录缺「已解决」格 ⇒ 门禁读到假阻断 | Critical | — | dismissed | 现象是本 PR 的**被测对象**而非缺陷；仓侧自造标记等于再造一份与引擎漂移的口径（D8 出路②留给上游） |
| i2 CHANGELOG 前页写了可照抄的攻击配方 | Critical | **crypto** | **upheld** | 前页只留缺陷类别，落点与步骤号收回 `design.md` 与记录 §7 |
| i3 宣称已评审但 HEAD 记录仍 pending | Warning | — | **upheld** | 中间态≠完成态；填完裁决走 resume（零模型调用）收敛终值，证据是记录状态读数 |
| i4 P8 会被后续 PR 改顺序静默失效 | Warning | — | dismissed | 与实测相反：改顺序正是 P8 的检测目标，负控（末尾追加同名忽略规则）实测 CAUGHT |
| i6 注释写行号会腐烂 | Warning | — | **upheld** | `.gitignore` 注释改按内容指向（去掉「第 106 行」） |
| i8 P3 两条断言可能不一致 | Warning | — | **upheld** | 加「`vendor.engine` 必须以 `scripts/engine.js` 结尾」形状断言 |

**本轮新增的现场结论（比 #3724 更宽）**：改动集里没有任何加解密代码，`i2` 却被打了 `crypto` 域标签 —— 标签来源是文案里出现了那个字样。于是「高危域必须外部复核」这道闸**可被散文触发**：它问的不是「这次改动碰没碰加密」，而是「critic 这次有没有把某个词读成加密」。这一格比 proposal 里原来那条更硬，也更难闭合（本轮 `ext=1` 使记录必然停在 blocked）。
