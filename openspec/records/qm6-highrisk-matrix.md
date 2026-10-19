---
record: qm6-highrisk-matrix
task: 把「闭环值 ≠ 闭环成立」落成执行判据 —— 高危面收口矩阵 + 收口转变检测（change: ccg-review-degradation-ladder，tasks 2.x / 8.1 判据侧）
date: 2026-10-19
---

## 本次执行记录：QM-6 收口矩阵与转变检测（qm6-highrisk-matrix，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false files=3`（`scripts/check-pr-exec-record.js` + 其测试 + pre-commit 自动写入的判定产物）。运行时代码在隔离 worktree `<仓库父目录>/mp-worktrees/mp-ccg-review-degradation`、裸分支 `qm6-highrisk-matrix`（基线 `origin/main = c79527117`，实现提交 `d4b819932`） |
| 第一性原因（QM-5 ①） | ✅ | 见下 §一：闭环白名单只断言「有人写了一个词」，而"谁真的评审了"这件事在本仓只有散文（AGENTS #3747 那句「高危域不得自扮演豁免」无执行体） |
| 逃逸分析（QM-5 ②） | ✅ | 见下 §二，逐层给出逃逸原因（单元层 / 判据层 / 变异层 / 审查层） |
| 修复 + 回归保护（QM-5 ④） | ✅ | `scripts/check-pr-exec-record.js`：`HIGH_RISK_SURFACES`（9 条，逐条带实测出处）+ `highRiskPrefixOf`（唯一匹配实现）+ `closureCorroboration` + 转变检测；测试 81 → **92**（本片 +11 条，名单见 §三） |
| 防止再次发生（QM-5 ⑤） | ✅ | 7 道变异反证（P1–P7）全部 CAUGHT、`escaped=0 anchorfail=0`；并把「匹配只准有一处」与「读数恰好打印一次」升成机械锁（§四） |
| 行尾与 diff 对账 | ✅ | 两文件均为 `i/lf w/crlf attr/text=auto`；`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐字相等（155/17 与 152/0）⇒ 本次没有改写行尾 |
| 接线棘轮 | ✅ | 未新增测试**文件**（锁都写进已接线的 `scripts/check-pr-exec-record.test.js`，`quality-gate.yml:163` 已点名）；`node scripts/check-unwired-tests.js` → `检查域内测试文件 108 个 OK` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`，未触任何前端渲染面 |
| QM-6 CCG 双模型外部评审 | ⏳ 进行中 | 见 §五。**本片禁止以 `self-play` 收口**（tasks 7.1 自反条款：改动的是判据本体，命中自己刚建立的高危面） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 一、第一性原因：`status` 是断言，不是测量

`evaluateDeepReviewDebt` 原有的判据形态是「本次变更集里每条 `mode=dual` 的判定产物，`deepReview.status` 必须落在闭环白名单 `{cleared, needs_revision, self_play_resolved}`」。这个白名单在 2026-10-15 那次纠偏（缺陷 i2：从 `status === 'pending'` 的黑名单换成白名单）里解决的是「换一个失败形态就绕过」，但它没有解决另一件事：**写那个词的人是谁**。

于是三条链路是断的：

1. 会话可以把手写 `cleared` 的产物交上去，机械判据读到的只是"有个词"—— 上一轮 QM-6 后端轴实测交付里，四种伪造 `cleared`（含 `evidence: "x"`）**全部被接受**。
2. `self_play_resolved` 本来就在白名单里（它对应引擎的第三档出口），所以「外部模型一个都没跑」在机械上可以完全满足本门禁 —— 这正是 AGENTS.md 里那条 ⚠️ 注明的未镜像缺口。
3. 「高危域不得自扮演豁免」这句话只存在于散文，没有任何东西在看它。

本片的落点就是把这三条从散文变成判据：**闭环成立 = 状态在白名单 ∧ 出处可核**，而"可核"的宽度按路径是否落在高危面分两档。

### 二、逃逸链：每一层为什么没拦住

| 层 | 结果 | 原因 |
| --- | --- | --- |
| 单元测试（上一片） | 未拦 | 上一片把 `tier` / `evidence` 的**分级函数**锁住了（`classifyEvidenceTier`、`summarizeTierCoverage`），但分级结果从来没有接进拦截路径 —— 它只出现在 `TIER-COVERAGE` 那行"可见不拦"的读数里。锁断言的是纯函数返回值，矩阵本身当时还不存在 |
| 判据层（CCG 白名单） | 未拦 | 白名单只看 `status` 一个字段。`performedBy` 才是"谁真的跑了"，而它是自由散文（主干 877 份产物里 34 种取值，12 条以 `self-play` 开头却声明做过外部复核）⇒ 不能作为判据，只能另立结构化字段 |
| 变异反证（首版 P1） | **只红一半** | 首版驱动把 `isHighRiskSurface` 摘成恒 `false`，期望三条红，实跑只有 `2.2 自指` 红。根因是矩阵走的 `highRiskHits` 里**又抄了一遍**前缀匹配 —— 两处实现互不认账，摘掉其中一处另一处照跑。这是本仓「自写的结构锁与实现互不认账」的又一落点，收敛方式见 §三 |
| 代码审查 / 自检 | 未拦 | 「高危域不得自扮演」写在 AGENTS 而不是写在判据里；同一条纪律靠临场自觉，已经在旧载体冻结那条链上被证伪过一次 |
| 视觉 / E2E | 不适用 | 判据层变更，无 UI 面 |

### 三、落了什么（逐条对应合同）

判据侧（`scripts/check-pr-exec-record.js`）：

- **`HIGH_RISK_SURFACES`（tasks 2.1）**：9 条路径前缀，每条带 `why` = 实测出处（`git ls-files` 命中数）：
  `credential-`(3) / `account-state-lock.js`(1) / `api-publish-engine/src/auth/`(18) / `login-state.js`(1) / `fingerprint`(9) / `.github/workflows/`(15) / `scripts/check-`(100) / `scripts/ccg-review-`(3) / `scripts/deep-review`(2)。
  刻意**不做**内容指纹推断：上一轮 QM-6 已否证指纹路线（改动源码可以躲在任何注释密集的非高危路径），而产物字段 `stats.sensitivePathHits` 主干 877 份里只有 2 份非空（构造性零）。清单只能缩小，新增前缀必须给实测出处。
- **`highRiskPrefixOf` 是唯一匹配实现**：`isHighRiskSurface` 与 `highRiskHits` 都走它（§二 变异层那半条红就是这么收敛掉的）。
- **收口矩阵（tasks 2.3）**：状态在白名单里 ⇒ 取 `closureCorroboration(dr)`：
  - `none` ⇒ 任何面都判「自称未评审却写闭环值」；
  - 高危面上 `self-play` / `external-unverified` ⇒ 判不成立，文案点名是哪条前缀、需要什么；
  - `external` ⇒ 放行（矩阵不得把真外部评审一起拦掉，有专门一条用例守这个方向）；
  - `unknown` ⇒ **刻意不拦**。理由与缺陷G 同型：新记录天生 `tier=unknown`，此刻加严等于「每次改判据都必须先跑完外部评审才能提交」，会造出无法闭合的循环。转拦前提是 unknown 占比降下来。
- **转变检测（tasks 8.1 判据侧）**：产物在本次变更集是 `M`、base 里非闭环、head 里闭环，而出处既不是 `external` 也不是 `closureNote` ⇒ 点名「收口无出处」并给出 `base=<状态> → head=<状态>`。
  `base` 取不到时**不报红**（避免把工具失明变成假红），但必须落进 `TRANSITION-CHECK … 未证实=<n>` 读数 —— 「未证实」与「已核对」在日志里必须不同形。

测试侧（`scripts/check-pr-exec-record.test.js`，+11 条）：
`2.1 高危面清单`（含逐条前缀在主干命中 ≥1 的反装饰断言 + 规模下界）、`2.1 单一匹配实现`、`2.2 自指`、`2.3 矩阵①②③`、`2.3 边界（不可闭合循环负控）`、`2.3 边界（不过拦负控）`、`8.1 转变①②③`。

打印面：`TIER-COVERAGE` 与 `TRANSITION-CHECK` 各**恰好一行**。动因是实跑现场 —— 收敛前 `--no-remote` 档会对 `r` 与 `r2` 各调一次 `applyDeepDebt`，`TRANSITION-CHECK` 逐字打了两遍而 `TIER` 只有一遍（当时只给 TIER 加了 `tierLinePrinted` 护栏）。"同一条读数打两遍"与"量了两次得出两个数"在 CI 日志里无法分辨，因此判据求值与读数打印一起上移到调用点之前，并补了计数锁。

### 四、变异反证（7 条，全部 CAUGHT）

驱动逐条把判据改回**被禁形态**，要求「指名的那条用例红」，还原后核对 md5 与原快照一致。

| 编号 | 被禁形态 | 期望指名红 | 结果 |
| --- | --- | --- | --- |
| P1 | 唯一匹配实现恒返回 `null`（摘掉高危面判据） | 2.2 自指 / 2.3 矩阵① / 8.1 转变② | CAUGHT 3/3 |
| P2 | 转变检测的 `corroborated` 恒 `true` | 8.1 转变① | CAUGHT |
| P3 | `tier=none` 不再被拦 | 2.3 矩阵③ | CAUGHT |
| P4 | base 读不到也算「已核对」 | 8.1 转变③ | CAUGHT |
| P5 | 清单塞一条命中 0 的装饰前缀 | 2.1 高危面清单 | CAUGHT |
| P6 | `highRiskHits` 退回自己抄一份匹配（行为逐字等价） | 2.1 单一匹配实现 | CAUGHT |
| P7 | `TRANSITION-CHECK` 打印两次（收敛前的真实形态） | 丙：真跑 CLI | CAUGHT |

`SUMMARY escaped=0 anchorfail=0`，基线 92 tests / 0 failed。
P6 与 P7 是「行为不变、只测锁有没有牙」的两格：P6 证明单一实现这句话不是装饰，P7 证明重复打印会被抓到。

### 五、QM-6 双模型外部评审（自反条款生效的一片）

本片改动的是 `scripts/check-*.js` = 判据本体，命中自己刚登记的 `scripts/check-` 高危面。按 tasks 7.1，**不得**以 `self-play` 收口；按 tasks 7.2，**不自动合并**。

派发与现场（2026-10-19 实跑）：

- 后端轴 `claude`（`scripts/ccg-review-backends.list` 的 critic）：直呼 CLI 派发（`codeagent-wrapper` 丢载荷已在上一片实测确认），评审范围钉在 `git diff origin/main...HEAD -- <两个文件>`。
- 前端轴 `opencode`（同清单的 proposer）：**零交付**。rc=0、stdout 0 字节，stderr 原文是「OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address」⇒ 属"跑完但没交付"，按产物判就是不成立，不得记成通过。
- 改用 `codex` 作为跨家族第二轴（Anthropic 系 × OpenAI 系），同范围同提示词。
- 由此暴露一条与 tasks 3.5 直接相关的事实：判定产物里的 `backendAvailability` 记的是 `onPath=[claude, opencode] count=2/2`，也就是**只测「CLI 装没装」，不测「后端能不能应答」**。上一片刚把这张表修成读真实形状（#3927），而它现在把"IP 被服务方拒绝"记成就绪 ⇒ 3.5 的三档（不可达 / 可达但交付无效 / 证据不足）仍需落判据，本片登记而不假装闭合。

逐条处置结果：<待两轴交付后补>

### 六、遗留（不假装已闭合）

1. **A 状态凭空伪造在判据层不可判**：一条本次新增（`A`）的产物，没有 base 版本可比，除自述外无对象可核 ⇒ 转变检测对它结构性失明。正解是 tasks 8.1 的另一半「闭环值只能由工具写」（`deep-review` 交付时才写 `tier=external` + 可核 `evidence` + `findings`）+ 事后抽查。**8.1 这条不勾**，因为本片只落了判据侧那一半；写入方那一半需要生产方改动，另立条目。
2. **非高危面上的 `self-play` 收口此刻仍算闭环**：这是刻意保留的（避免一刀把主干所有在飞 PR 判红），收紧它需要 tasks 4.x 的「机械对抗产物作为降级货币」。
3. **`closureNote >= 20 字符` 是形态阈值不是语义判据**：非高危面上随便一句长话就能满足。它承接的是主干既有约定（轮次 + 逐条处置），高危面上已确认不足以放行。
4. **`HIGH_RISK_SURFACES` 无「前缀指向的文件消失」检测**：清单只能缩小这条目前只由 `2.1` 那条「逐条命中 ≥1 个受管文件」的用例守住 —— 它会红，但红在测试里，不在 PR 判据里。改名/删除时是否要另立执行体属改「谁来守门」，留人工裁决。
5. **变异驱动未入库**：P1–P7 的驱动落在本机临时目录，复现方式是按 §四 表格逐条手工改回被禁形态再跑 `node --test scripts/check-pr-exec-record.test.js`。把它变成可被判据消费的产物正是 tasks 4.1–4.4；在那之前不假装它有货币地位。
6. **`--repo <目录>`（空格形式）会被解析成布尔 `true`**：本片实跑时踩到，症状是 `spawnSync git ENOENT` 形同门禁红。属既有取参缺陷，登记而不与本 PR 混改。
7. **本地预跑与 CI 的边界**：`.github/scripts/workflow-contract.test.js` 与 `.github/scripts/check-workflow-structure.js` 在本 worktree 因 `js-yaml` 未安装而**无法直接跑**（`Cannot find module`，不是回归）。本轮用共享根已安装的同一份库（`NODE_PATH` 指过去）跑通：`workflow-contract 43 passed / 0 failed`、`workflow-structure files=14 violations=0`。这两个数不代替 CI。
8. **跨面行为变更前缀抓不到（tasks 2.5 点名的 design §3 残余）**：判据只看「本次变更集里有没有文件路径落在高危面前缀上」。一次行为变更若发生在非高危路径、却改变了高危面的语义（改了共享工具函数而调用方是 `credential-*`），前缀匹配**结构性看不见**。design §3 那句「如实登记残余」指的就是这个形态。可收窄方向是按「被高危面文件 require 的模块」反查一跳，但那需要一张依赖图且会引入假阳 —— 属改「谁来守门」，留人工裁决，本片不假装闭合。
9. **`unknown` 档没有转拦**：产物只要没写结构化 `tier`，收口矩阵就不插手（负控用例 `2.3 边界（不可闭合循环负控）` 钉住）。这是**刻意的**，理由与代价都写在 §三；转拦前提是 `TIER-COVERAGE` 里 unknown 占比降下来，而占比要降先得有写入方（tasks 8.1b，落点在仓外引擎）。在那之前，「新产物不写 tier」仍是一条不需要出处的收口路径。
