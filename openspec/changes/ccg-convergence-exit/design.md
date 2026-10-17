## Context

#3724 的收尾把「深度审查没闭环」归因成了 `self_play_blocked` 这一个状态字符串。本轮要回答的是前一步问题：**为什么必然 blocked**。答案在引擎的收敛判据里，而那段代码在 `~/.claude/skills/adversarial-review-loop/scripts/`（上游技能制品，本仓不持有、不改）。

## Decisions

### D1 交付「探针」而不是「修复」

改 vendor 引擎能直接让闭环可达，但它是**跨项目共用的上游制品**：本仓的一次手改既不会被别的会话看见，也不会在升级时被保留。本 PR 只做两件事——把结论变成可复跑读数、把读数接进 CI。引擎侧的诉求作为上游 issue 记录在 D8。

### D2 所有 cfg 数值 MUST 现读自 vendor 源码

`readDefaults(src)` 用正则从源码里取 `maxRounds / scoreThreshold / stallRounds / stallScoreDelta / selfPlay.enabled / confidenceWeight`，任一项读不出 ⇒ 探针 rc=2 并点名缺哪一项。**禁止**在本仓写默认值常量。

理由（本轮真实踩到，不是理论）：这些数分处两份文件——`maxRounds/threshold/stallRounds/stallScoreDelta` 只在 `engine.js`，`confidenceWeight/selfPlay.enabled` 只在 `ccg-deep-review.js`。第一版探针的测试只喂了 engine 那一份 ⇒ 两个键恒 `null`，读起来像「探针的判据是硬的」，实际是**探针没读到东西**。修法不是放宽判据，而是把「读哪两份」收敛成一个 `readVendorSources(vendor)`，main 与测试走同一条路，并让 P2 反向断言「只喂 engine 时 `confidenceWeight` 必须是 null、只喂 driver 时 `maxRounds` 必须是 null」——把「两份都需要」本身钉成判据。

### D3 三档退出码互不混档

`0` 读数符合 / `1` 读数偏离（vendor 行为变了）/ `2` 探针自身取不到数。混档等于把「探针瞎了」读成「引擎没问题」，与本仓 `check-workflow-structure.js` 的 0/1/2 分工同一条纪律。

### D4 `--json` 档的 stdout 只能是 JSON

机器档的人读结论行改道 stderr，并把 `problems` / `verdict` 放进 JSON 本身。动因是实测：第一版在 JSON 之后继续写 `[ccg-probe] 结论…`，P1 的 `JSON.parse` 抛 `Unexpected non-whitespace character after JSON at position 1117`——那条红读起来像「探针坏了」，而不是「它多嘴了」。

### D5 夹具必须是真产物，且计数差异必须就地解释

`verification-layer-sample.json` 是 `.ccg/reviews/24cf2d8f…json` 的逐字段摘录（实测 6 条 finding 全部 `fieldDiff=none`；`status/performedBy/confidenceWeight` 同源）。引擎 stdout 的 logLine 写「8 条问题」而记录里是 6 条：前者是 critic 当轮**原始产出**、后者是**裁决后**留存，`note` 里写明这一点——否则下一个会话会把 8/6 读成摘录漏抄。P5 另断言记录名必须是内容寻址形态（40hex→64hex），历史 `<sha>.json` 那代产物不能当本篇夹具。

### D6 漂移报警必须有行为锁，不能只有注释

P3 除了「读得出形状」，还**真跑一次探针**：临时目录里放原样复制的 `engine.js` + 把 `currentRound: cfg.maxRounds` 改成 `currentRound: 1` 的驱动，`CCG_ARL_DIR` 指过去，要求 `rc=1` 且 `verdict=DRIFT` 且 `problems` 点名 `currentRound`；随后在同一目录把驱动换回真源码，要求 `rc=0`。A/B 都进同一条用例，使「红」能归因到那一格。

这里踩过一格：`CCG_ARL_DIR` 指的是**技能根**（`locateVendor` 自己再拼 `scripts/`），第一版传了已含 `scripts` 的路径 ⇒ 探针静默回落真 vendor，于是「改了驱动」的断言量的根本不是那份夹具，而 rc 恰好仍是 0、测试恰好仍绿（因为断言写在 `rc===1` 上——它会红，但红的原因是「夹具没被用」而不是「形状偏离」）。现加一条正控：JSON 里的 `vendor.engine` 路径必须命中临时目录名。

### D7 接线落点：changes 作业，编号 2b6

探针防的是「vendor 行为漂移」，与运行时代码无关，且它自身是 `scripts/` 工具脚本（docs-only 白名单内）。按 AGENTS.md「进白名单的前提锁」，校验必须接在**不被 `docs-only` 短路**的 job ⇒ 落 `changes`。编号取 2b6 而非 2b5，因 #3724 已占用 2b5 且未合并；两步同号会在 squash 后读成同名步骤。

**诚实边界**：GitHub runner 上没有 `~/.claude/skills/adversarial-review-loop`，所以 CI 实际执行的是「缺引擎 ⇒ rc=2 且点名探针失明」那一格；ladder 读数断言在本机那一格跑。两档都必须有产物，缺档即红——不 skip、不把「找不到」判成「通过」（同 AGENTS.md「找不到就 skip 会把洞伪装成按设计跳过」）。

### D8 闭环可达的三条出路（本 PR 都不选）

| 出路 | 代价 | 为什么不在此 PR 做 |
| --- | --- | --- |
| 真跑多轮，把 `minScore` 抬到 ≥ 8 | 每轮一次外部模型调用；#3724 单轮已 23–40 分钟，3 轮不可接受 | 属运行成本决策，须用户拍板 |
| 给引擎加「已外部复核」字段，让 ③ 不再对它无条件计阻断 | 改上游共享制品，且改动面在「谁来守门」之内 | 不在本仓私改 vendor |
| 人工批准把 `check-pr-exec-record` 的闭合词表扩到 `self_play_blocked`（附外部评审证据） | 直接削弱唯一那条机械闸门 | AGENTS.md：改「谁来守门」须人工过目，禁止 agent 自动合并 |

## 否证与残留（不假装已闭合）

- **被否证的初判**：「大概是 stall 判据误触」。实测 `isStalled([单轮]) ⇒ stalled=false（轮次不足）`，stall 出口在验证层**根本不可能触发**；真正的落点是 ③。原表述已作废。
- **MP6 ESCAPED（防御重叠，不是空锁）**：把探针自评项 `shipped.status !== 'self_play'` 摘成恒假，测试仍绿——因为 P1 直接断言 `ladder.shippedVerificationLayer.status === 'self_play'` 这个**读数本身**，不信探针的自评。这条记录成设计属性（测试锚在读数上），不写成「锁已验证」。要让它独立可测，需要能改 vendor 行为的夹具，成本与收益不匹配。
- **显示层会撒一个字符**：`assert.ok(..., k + ' …：' + real[k])` 那行在 Read/grep 的渲染里显示为 `real[k]);`，而磁盘字节是 `real[k));`（少一个 `]`）。Edit 因此匹配不上，最后按码点定位、用字节级 splice 修，并在写盘前用 `vm.Script` 整份 parse + 写盘后回读码点验证。教训：**判结构错位一律看码点序列，不看终端渲染**。
- **探针只在「vendor 存在」时有完整意义**：CI 那一格只守失明路径。若 vendor 在 runner 上以别的路径存在（未来 checkout 了该技能），P4 的「空目录 ⇒ rc=2」仍成立，但 P1 会自动切到 ladder 分支——这是设计意图，不是不确定性。
- **不改判定语义**：本 PR 不碰 `ccg-review-decider.js` / `check-pr-exec-record.js` 的任何判据；#3724 的证据锚与本篇的探针互不依赖，两个 PR 可任意顺序合并。
