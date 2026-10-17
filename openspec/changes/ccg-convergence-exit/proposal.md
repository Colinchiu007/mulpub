## Why

**「QM-6 深度审查闭环」在含 crypto 发现的 diff 上不是一个待达成的目标，而是一个结构上到不了的终点。** #3724 收尾时这句话只有形容词：真实跑完双模型评审后，`check-pr-exec-record.js --mode=enforce` 仍报「CCG 深度审查欠账」，因为判定记录里躺着 `status=self_play_blocked`。当时我的第一版解释是「大概 stall 判据误触了」——**这个猜测是错的，本轮把它证伪并换成了可复跑的读数**。

引擎的收敛判据有三个停止出口，而 CCG 的**验证层只跑一轮** critic，并刻意把 `currentRound` 报成 `cfg.maxRounds`（驱动自己的注释写明：不这么报就会返回 `continue`，而 `continue` 被上层当成「无阻断」放行）。三者叠加的后果不是「少了个出口」，是**只剩一个出口**：

| 出口 | 在验证层是否可达 | 现场读数（复跑 `node scripts/ccg-convergence-probe.js`） |
| --- | --- | --- |
| ① 分数收敛（`minScore >= scoreThreshold`） | **不可达** —— 从不进入第 2 轮，分数无从抬升 | 人工构造第 2 轮打到阈值 8 ⇒ `status=converged`（说明缺的是**轮次**，不是出口本身） |
| ② stall（连续 `stallRounds` 轮无提升） | **不可达** —— `isStalled` 要求 `rounds.length >= stallRounds + 1`，单轮恒假 | `isStalled([1 轮]) ⇒ stalled=false（轮次不足）` |
| ③ 轮次耗尽 → self-play / escalated | **唯一可达** | `status=self_play reason=selfPlay stop=true` |

而 ③ 这一档对**高危域条目无条件计阻断**（`blockingFromAdjudication` 只看 `highRiskDomains` 非空，没有任何字段能表达「这条已经由外部模型复核过了」）。于是含 crypto 项的 diff 每次深度审查必然落在 ③ 且必然 blocked —— 这不是边缘情况，是主路径。

> **本 PR 自己把这条结论跑宽了一遍（2026-10-17 现场，不是推演）**：给本 change 跑真实双模型评审时，critic 给出 8 条、`高危域必须外部复核 0 条`，引擎仍照原样落在 ③（日志原文 `收敛判定: status=self_play reason=selfPlay minScore=4`），裁决后判定为 **2 条阻断（`self_play_upheld`）**。⇒ ③ 的阻断有**两种**子形态，本篇原先只写了第一种：
> 1. **高危域条目**：在 ③ 里**永远**解不开（自扮演无权裁决 crypto 类指控）；
> 2. **自扮演维持的 Critical**：与域无关，只要 agent 判 `upheld` 就计阻断 —— 且**没有任何字段能表达「这条已在其后的提交里修好」**，所以记录 A 会带着 `self_play_blocked` 永久留在变更集里。本 PR 的 i1/i2 就是这一格：两条都已修且各带锁（MP7、P8 负控），状态仍不可闭合。
>
> 这条否证只收窄了我原来的表述（"含 crypto 的 diff"是子集，不是全集），没有推翻结论：**③ 不可达闭合，且不可达的范围比 crypto 更宽**。

### 实测证据（2026-10-17 本机，全部可由探针一句话复跑）

| 判据 | 实测值 | 出处 |
| --- | --- | --- |
| vendor 参数（探针**现读**，不抄写） | `maxRounds=3`、`scoreThreshold=8.0`、`stallRounds=2`、`stallScoreDelta=0.5`、`selfPlay.enabled=true`、`confidenceWeight=0.6` | `engine.js:41/42/165/166`、`ccg-deep-review.js:108` |
| 驱动写入的 task 形状 | `currentRound: cfg.maxRounds`（单轮 `rounds:[{round:1,…}]`） | `ccg-deep-review.js:1029` 与 `:1140` |
| 真产物判定记录 | `layer=diff mode=dual`，`deepReview.status=self_play_blocked`、`performedBy=self-play`、6 条 findings、`requiresExternalReview` 2 条（i2/i4，均 `crypto`）、`blocking` 3 条 | `.ccg/reviews/24cf2d8f…json`（PR #3724，被审 commit `5d660809a`） |
| 三档退出码分工 | 0=读数符合、1=读数偏离（vendor 行为变了）、2=探针自身取不到数 | `scripts/ccg-convergence-probe.js` 头注 |
| 变异反证 | MP1–MP5 指名变红（`restore md5 ok=true`）；MP6 ESCAPED，属防御重叠而非空锁（见 design「否证与残留」） | `node --test scripts/ccg-convergence-probe.test.js` |

## What Changes

- **新增 `scripts/ccg-convergence-probe.js`**：把上面那张表变成**每次都能重取**的读数。所有 cfg 一律从 vendor 源码现读，读不出即 rc=2 —— 不在本仓抄一份默认值，因为抄一份就是下一个「vendor 改了而这里恒绿」的漂移源。
- **新增 `scripts/ccg-convergence-probe.test.js`**（P1–P6）：契约锁、cfg 派生锁、**漂移报警的行为锁**（真跑一次被改形的 vendor 夹具，要求 rc=1 且点名 `currentRound`，并用同目录换回真驱动做 A/B 对照）、fail-closed 档锁、夹具出处锁、零第三方依赖锁。
- **新增真产物夹具** `openspec/changes/ccg-convergence-exit/artifacts/verification-layer-sample.json`：逐字段等于 #3724 那条记录（实测 6 条 finding 全部 `fieldDiff=none`），并就地解释「logLine 8 条 vs 记录 6 条」的计数来源。
- **CI 接线**：`quality-gate.yml` 的 changes 作业新增 `Gate 2b6 - CCG convergence-exit probe`（`shell: bash`，单命令 fail-fast 形态天然满足）。编号取 2b6 而非 2b5：#3724 已占用 `Gate 2b5 - CCG evidence anchor` 且尚未合并，同号会在两条任一先合时撞成两步同名。
- **`.gitignore` negation**：第 106 行 `scripts/*.js` 会把探针**本体**静默忽略（`git status` 里根本不存在、本地跑得通、CI 上 MODULE_NOT_FOUND），补 `!scripts/ccg-convergence-probe.js`，判据用 `git check-ignore --no-index -v` 量（实测改前命中 `106:scripts/*.js`、改后命中 `224:!scripts/ccg-convergence-probe.js`）。

## Impact

- **受影响 specs**：新增能力 `ccg-deep-review-convergence`（本 change 的 delta 是唯一出处；主干尚无同名能力）。
- **不受影响**：vendor 引擎与驱动**一个字节都不改**（它们是 `~/.claude/skills/` 下的上游技能制品，跨项目共用）；`check-pr-exec-record.js` 的闭合词表 `{cleared, needs_revision, self_play_resolved}` **不放宽**——收紧/放宽它属于改「谁来守门」，须人工过目，不在本 PR 内自动做。
- **不声称已解决的**：本 PR 交付的是**测量与报警**，不是「让闭环可达」。闭环要可达，只有三条出路，且都不在本 PR 范围：真跑多轮把分数抬到 ≥8、给引擎加「已外部复核」的表达字段（上游改动）、或人工批准放宽闭合词表。三条的取舍写进 `design.md` D8。
