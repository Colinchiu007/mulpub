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
| 修复 + 回归保护（QM-5 ④） | ✅ | `scripts/check-pr-exec-record.js`：`HIGH_RISK_SURFACES`（9 条，逐条带实测出处；`fingerprint` 一条带 `exts` 限定，raw 9 → 归因 7）+ `highRiskPrefixOf`（唯一匹配实现）+ `closureCorroboration` + 转变检测；测试 81 → **113**（首轮 +11、两轴处置再 +21，名单见 §三/§五） |
| 防止再次发生（QM-5 ⑤） | ✅ | 21 道变异反证（P1–P21）全部 CAUGHT、`escaped=0 anchorfail=0`；并把「匹配只准有一处」与「读数恰好打印一次」升成机械锁（§四） |
| 行尾与 diff 对账 | ✅ | 两文件均为 `i/lf w/crlf attr/text=auto`；`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐字相等（155/17 与 152/0）⇒ 本次没有改写行尾 |
| 接线棘轮 | ✅ | 未新增测试**文件**（锁都写进已接线的 `scripts/check-pr-exec-record.test.js`，`quality-gate.yml:163` 已点名）；`node scripts/check-unwired-tests.js` → `检查域内测试文件 108 个 OK` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`，未触任何前端渲染面 |
| QM-6 CCG 双模型外部评审 | ✅ 已收口（单轴复审如实标注） | 见 §五。**本片禁止以 `self-play` 收口**（tasks 7.1 自反条款：改动的是判据本体，命中自己刚建立的高危面） |
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
  `credential-`(3) / `account-state-lock.js`(1) / `api-publish-engine/src/auth/`(18) / `login-state.js`(1) / `fingerprint`(raw 9，其中 2 份是 `01-docs/evidence/**.txt` 取证快照 ⇒ 本条带 `exts` 限定源码扩展名，归因 **7**) / `.github/workflows/`(15) / `scripts/check-`(100) / `scripts/ccg-review-`(3) / `scripts/deep-review`(2)。
  刻意**不做**内容指纹推断：上一轮 QM-6 已否证指纹路线（改动源码可以躲在任何注释密集的非高危路径），而产物字段 `stats.sensitivePathHits` 主干 877 份里只有 2 份非空（构造性零）。清单只能缩小，新增前缀必须给实测出处。
- **`highRiskPrefixOf` 是唯一匹配实现**：`isHighRiskSurface` 与 `highRiskHits` 都走它（§二 变异层那半条红就是这么收敛掉的）。
- **收口矩阵（tasks 2.3）**：状态在白名单里 ⇒ 取 `closureCorroboration(dr)`：
  - `none` ⇒ 任何面都判「自称未评审却写闭环值」；
  - 高危面上 `self-play` / `external-unverified` ⇒ 判不成立，文案点名是哪条前缀、需要什么；
  - `external` ⇒ 放行（矩阵不得把真外部评审一起拦掉，有专门一条用例守这个方向）；
  - `unknown`（**字段缺席**，含生产方给新产物写的初始值 `unknown`）⇒ **刻意不拦**。理由与缺陷G 同型：新记录天生 `tier=unknown`，此刻加严等于「每次改判据都必须先跑完外部评审才能提交」，会造出无法闭合的循环；实测主干 142 篇已闭环产物里 139 篇整字段缺席，一刀收紧就是 139 篇的形状（见 §七）。
- `unrecognized`（**字段在而值不认识**：`External` / `extrenal` / 数字 / 对象）⇒ **不分面一律拦**。后端轴 Critical#2 命中的绕行路径原本是这两档合成一档 —— 删掉 `tier` 或写成 `external `（尾随空格）就掉进 unknown 被放过。现在空白先归一（`external ` 按 external 走 evidence 校验），野值单独成档必红；实测存量里野值 **0 篇**，所以这一档只拦伪造、不打历史。转拦 `unknown` 的前提仍是其占比降下来 —— 而占比要降先得有写入方（tasks 8.1b）。
- **转变检测（tasks 8.1 判据侧）**：产物在本次变更集是 `M`、base 里非闭环、head 里闭环，而出处既不是 `external` 也不是 `closureNote` ⇒ 点名「收口无出处」并给出 `base=<状态> → head=<状态>`。
  `base` 取不到时**不报红**（避免把工具失明变成假红），但必须落进 `TRANSITION-CHECK … 未证实=<n>` 读数 —— 「未证实」与「已核对」在日志里必须不同形。

测试侧（`scripts/check-pr-exec-record.test.js`，+11 条）：
`2.1 高危面清单`（含逐条前缀在主干命中 ≥1 的反装饰断言 + 规模下界）、`2.1 单一匹配实现`、`2.2 自指`、`2.3 矩阵①②③`、`2.3 边界（不可闭合循环负控）`、`2.3 边界（不过拦负控）`、`8.1 转变①②③`。

打印面：`TIER-COVERAGE` 与 `TRANSITION-CHECK` 各**恰好一行**。动因是实跑现场 —— 收敛前 `--no-remote` 档会对 `r` 与 `r2` 各调一次 `applyDeepDebt`，`TRANSITION-CHECK` 逐字打了两遍而 `TIER` 只有一遍（当时只给 TIER 加了 `tierLinePrinted` 护栏）。"同一条读数打两遍"与"量了两次得出两个数"在 CI 日志里无法分辨，因此判据求值与读数打印一起上移到调用点之前，并补了计数锁。

### 四、变异反证（21 条，三轮跑数全部 CAUGHT）

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

第 1 轮评审处置之后又加 8 条（同一名驱动、同一判据：被禁形态必须让**指名那条**用例红）：

| 编号 | 被禁形态 | 期望指名红 | 结果 |
| --- | --- | --- | --- |
| P8 | `readAtBase` 退回读 `--base` 的最新内容（取源与变更集不同源） | 评审#3 | CAUGHT |
| P9 | `unrecognized` 档不再拦（野值与"没声明过"重新同档） | 评审C2 | CAUGHT |
| P10 | evidence 形状判据退回"串里出现 `.md` 即算指针" | 评审C1 | CAUGHT |
| P11 | `closureNote` 退回纯长度阈值（20 个字符即可冒充出处） | 评审W4 | CAUGHT |
| P12 | 同一条产物的两条理由不再合并（计数虚高、报告红两遍） | 评审#2 | CAUGHT |
| P13 | R/C 改名不再展开（未闭环产物借改名静默逃逸） | 评审#10 | CAUGHT |
| P14 | 转变状态词退回常量占位「待判」 | 评审#8 | CAUGHT |
| P15 | `tier` 不再先去空白（尾随空格重新掉进 unknown 绕行面） | 评审C2/I6 + 丙 classifyEvidenceTier | CAUGHT 2/2 |

两轮合计 **15/15 CAUGHT**、`escaped=0 anchorfail=0`， adverse 档（PARTIAL / NOT_CAUGHT / ANCHOR_FAIL / RUNFAIL / RESTORE_BAD）计数 0；基线 92 → **106 tests / 0 failed**（评审处置带进 14 条用例）。
第 2 轮处置再加 6 条（P16–P21：A 面凭空闭环、`exts` 限定、`ses_` 词边界、merge-base 兜底、`slice()` 一致性、归属文案），驱动扩到 **21 条**、用例 106 → **113**。这一轮暴露的是**驱动自己的锚点漂移**：P1 与 P5 第一次跑报 `ANCHOR_FAIL 命中=0` —— 实现里加了 `inScope(s, f)`、`fingerprint` 条目加了 `exts`，锚点串不再是原文。处置口径是**改驱动的锚点**（加 `--only=` 重跑那两条，改后各 CAUGHT：P1 指名 3/3、P5 指名 1/1），而不是把判据的形状改回去迁就驱动。
这一轮还顺手修掉驱动自己的一处失明：TAP 会把用例名里的 `#` 转义成 `\#`（`评审#3` 在 `not ok` 行里是 `评审\#3`），不去掉反斜杠就让"指名红"永远匹配不上 —— 那读起来像"锁无牙"，实际是探针瞎了。

### 五、QM-6 双模型外部评审（自反条款生效的一片）

本片改动的是 `scripts/check-*.js` = 判据本体，命中自己刚登记的 `scripts/check-` 高危面。按 tasks 7.1，**不得**以 `self-play` 收口；按 tasks 7.2，**不自动合并**。

派发与现场（2026-10-19 实跑）：

- 后端轴 `claude`（`scripts/ccg-review-backends.list` 的 critic）：直呼 CLI 派发（`codeagent-wrapper` 丢载荷已在上一片实测确认），评审范围钉在 `git diff origin/main...HEAD -- <两个文件>`。
- 前端轴 `opencode`（同清单的 proposer）：**零交付**。stdout **0 字节**，stderr 原文是「OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address」⇒ 属"跑完但没交付"，按产物判就是不成立，不得记成通过。
- 改用 `codex` 作为跨家族第二轴（Anthropic 系 × OpenAI 系），同范围同提示词。第 1 轮交付 **11 条**可 `JSON.parse` 的 findings（codex session id `01a151a3-d4f2-7102-901d-0ed887722654`，产物落 `<TEMP>/qm6-codex-final.txt`）；后端轴 `claude` 交付 **6 条**（session `bc44397d-0f13-43f9-a814-82db03ed202c`，`--output-format json` 信封的 `result` 字段是散文 + 末尾一个 JSON 数组，取最外层方括号解析）。这两个 id 就是收口时写进产物 `evidence` 的**可核指针**（不是"我跑过了"这句话）。
- **纠正自己一处取证错误**：那条 opencode 命令写成 `opencode run … > out 2> err; echo "PROPOSER rc=$?"`，而后台任务汇总回显的 exit code 是末尾那句 **echo 自己的 0** ⇒ 我当时根本没量到 opencode 的真实 rc。第 2 轮用单独一条同形命令量得 **rc=1**、同一错误原文复现。这正是本仓反复点名的 `cmd | tail; echo $?` 那类失明换了个壳出现在**我自己的取证命令**里 —— 所以"零交付"的判据一直是 stdout 字节数与产物可否解析，不是 rc。
- 由此暴露一条与 tasks 3.5 直接相关的事实：判定产物里的 `backendAvailability` 记的是 `onPath=[claude, opencode] count=2/2`，也就是**只测「CLI 装没装」，不测「后端能不能应答」**。上一片刚把这张表修成读真实形状（#3927），而它现在把"IP 被服务方拒绝"记成就绪 ⇒ 3.5 的三档（不可达 / 可达但交付无效 / 证据不足）仍需落判据，本片登记而不假装闭合。

**第 1 轮逐条处置**（两轴共 17 条；处置一律先复测再定，不采信"看起来合理"）：

| 轴 | 编号 | 要旨 | 处置 | 落点 |
| --- | --- | --- | --- | --- |
| codex | #1 Critical | 红文案教用户「把 tier=external 写进产物」，而工具侧写入从未实现 ⇒ 门禁示范自家合同禁止的动作 | **接受**（我此前只在记录里承认缺口，没改文案 —— 文案是判据的面向用户那一面，同样要诚实） | 出口①改写为「跑真评审 + 此刻只能手写代用，必须同次声明『tier 由会话手写』」；用例 `评审#1` |
| codex | #2 / claude W5 | 同一条产物被矩阵与转变各 push 一次 ⇒ 抬头"N 条"虚高、报告里红两遍 | **接受** | `badClosureBy` 按产物合并；用例 `评审#2`；变异 P12 |
| codex | #3 | `readAtBase` 取 `--base` 的**最新内容**，而变更集取的是 merge-base ⇒ 两者不同源；main 期间前进会把"他人已闭环"读成"本来就闭环" | **接受**（我先写的注释自称"同源"，实现并不同源 —— 注释与代码互不认账） | 先解 `git merge-base` 再取 blob，解不出时出声并退回；用例 `评审#3`（真 git 夹具，工作树停在 PR）；变异 P8 |
| codex | #4 / #11 | 「清单只能缩小」没有执行体，`length>=6` 允许静默删 3 条 | **接受** | 用例 `评审#4` 按成员钉死 9 条前缀（增删都要同时改这份基线并给实测出处） |
| codex | #5 | `highRiskPrefixOf` 名为 prefix 实为子串匹配（`fingerprint` 会命中任何含该词的路径） | **部分接受**：不改成 `startsWith` —— 那会静默削掉实测 9 条 `fingerprint` 命中（含 `draft-fingerprint.js` 这类真目标），把"覆盖变窄"写成"精度提高"。接受的是可见性：红文案点名**是哪个文件**把变更集拉进高危域，误伤当场可归因 | 用例 `评审#6`；宽度取舍登记进 §六 遗留 |
| codex | #6 | `unresolved` 的补救文案还是旧出口（"写明原因并把 status 置为闭环值"），照它做会被新转变检测判红 ⇒ 门禁自己打架 | **接受** | 文案指名两个机械出口与字段名（非高危面 `closureNote` / 高危面 `tier=external + evidence`）；用例 `评审#6` |
| codex | #7 | 矩阵只作用于 `mode=dual` 的产物；与判定器 `RULES.sensitivePaths` 是两份独立清单且已分叉 | **接受为登记**：`single` 不要求闭环是缺陷G 的既有取舍（否则当场造出无法闭合的循环），本切片不扩；两条清单的交集/差集留人工裁决 | §六 遗留新增一条 |
| codex | #8 | 读数行 `转变=待判` 是**常量占位**，永远不会变成结论词；未证实不点名；无扫描域规模 | **接受** | 状态词由读数派生（通过/有疑/无转变）+ `扫描域=` + `未证实清单=`；用例 `评审#8`；变异 P14 |
| codex | #9 | 「单一实现」锁是静态 grep，换个写法即可绕过 | **接受**：另加一条**行为**锁 —— 逐输入要求 `isHighRiskSurface` / `highRiskPrefixOf` / `highRiskHits` 三者同结论（grep 锁保留，它测的是另一件事） | 用例 `评审#9` |
| codex | #10 | `R100`/`C75` 形态既不进 A/M 也不进 D ⇒ 未闭环产物可借改名静默逃逸 | **接受**（取源本来就同时给 `from` 与新路径，不需要新取源） | `expandRenames` 拆成「旧路径按 D + 新路径按 A」并单独成段点名"改名"；用例 `评审#10`；变异 P13 |
| codex | #11（后半） | 提示词里"只有两个文件"与实际差量含第三个文件（本 PR 自己的 pending 产物）不符 | **否证**：那句是评审**范围**的取范围说明（判据代码只有两个文件），产物是我正在收口的对象本身；但"本 PR 自身当前必红"这一点是对的 —— 它正是 7.1 要求人工过目的现场 | 不改代码；写进 §五 结论 |
| claude | C1 | `evidence` 的"可核指针"判据太松：`.md` 出现在任意位置即算（`evidence:"x.md"` 五字符过关），40 hex 无边界 | **接受**：形状判据改为整串锚定（路径形态或 ≥3 字符文件名）+ 40 hex 必须独立成串。同时**如实写下能力边界**：`'a'.repeat(40)` 作为整串仍是合法 sha1 形状，形状层判据无法证"这个对象存在"，只有 PR 引用/会话 id/uuid 这三类能被人事后核 | 用例 `评审C1`；变异 P10 |
| claude | C2 | 高危面上 `unknown` 被放过 ⇒ **删掉 `tier` 或写成 `external ` 即静默通过**，正是门禁文案自己承认的那条绕行 | **接受并拆分**：字段缺席（含生产方初始值 `unknown`）不拦；字段在而值不认识 ⇒ 新增 `unrecognized` 档，不分面一律拦。空白先归一。存量实测：142 篇已闭环里 139 篇缺席、野值 0 篇 ⇒ 只拦伪造不打历史 | 用例 `评审C2`、`评审C2/I6`、`丙 classifyEvidenceTier` 改写；变异 P9/P15 |
| claude | W3 | 转变检测不按高危面门控 ⇒ 非高危面上 `self-play` 收口被拦，与矩阵口径不一致，可能误伤历史/正常流 | **否证为"bug"，接受为"取舍必须显式"**：矩阵答"这条收口的存在性有没有出处"，转变答"这次把它翻成闭环值的**动作**有没有出处"，第二个问题本来就该更严，出口是 `closureNote`（非高危面够用 ⇒ 不是循环）。原实现只在注释里说，没锁住 —— 现在由 `评审W3` 钉住，防止下一个会话"顺手统一口径"把它削平 | 用例 `评审W3` + 代码内注释 |
| claude | W4 | `closureNote >= 20 字符` 可被 `'x'.repeat(20)` 满足 | **接受**：必须同时含轮次标记与逐条处置结论。仍是形态判据（挡"随手填一句话"，挡不住"认真编一段带轮次和处置词的话"）—— 这句限制写进注释与 §六 遗留 | `isStructuredClosureNote`；用例 `评审W4`；变异 P11 |
| claude | I6 | `tier:'external '`（尾随空格）掉进 unknown ⇒ 最廉价的注入变体 | **接受**（与 C2 同一处处置） | 同上；变异 P15 |

**第 2 轮**（对第 1 轮处置后的差量再审，113 tests / 0 failed 的状态上审）：

- 后端轴 `claude` 再次直呼 CLI 交付 **8 条**（session `7a4d7847-48e1-4480-9c7b-7c9d7c9c5b72`；2 Critical / 4 Warning / 2 Info），逐条处置如下。
- 跨家族轴 `codex` **第 2 轮未交付**：三次尝试的现场分别是 `429 Too Many Requests`（两次，上游限流）与 `503 Service Unavailable`（本地 CC Switch 代理的 upstream 报障）。清单里的 `opencode` 仍是 IP 级拒绝。**如实记：处置引入的那部分改动没有经过跨家族复审**，只有后端轴复审 + 自审 + 113 条用例 + 21 道变异。这一条写在 §六 遗留第 13 条，不靠"跑过一轮了"糊过去。

| 编号 | 要旨 | 处置 | 落点 |
| --- | --- | --- | --- |
| R2-1 Critical | `onHighRisk` 是变更集级布尔，套在每条产物上；建议改成按**记录自身路径**判 | **修法被否证，归属问题接受**：判定记录本来就是 PR 级的（pre-commit 按整笔暂存差量出一份），`.ccg/reviews/<hash>.json` 永远不落在任何高危前缀上 —— 照它改等于把这条门禁整条关掉（实测：按记录路径判 ⇒ `riskHits` 恒空 ⇒ 矩阵永不触发）。接受的是文案张冠李戴那一半：改成"本次变更集命中高危面 …（由 X 拉进来）"，并明写不得把高危面属性写在产物名下 | 用例 `第2轮R2-1`；变异 P21 |
| R2-2 Critical | 高危面上 **A 状态新增即写闭环值而 `tier` 缺席** ⇒ 矩阵因 unknown 放过、转变因非 M 不触发 ⇒ "给自己贴一张 cleared"是零成本绕行 | **接受**：这一档现在拦。它不造循环 —— 正常流在这里永远是 `pending`，只有"新增即闭环"才撞线；而"新增即闭环"除自述外无对象可核，正该按凭空收口处理 | 用例 `第2轮R2-2`（含非高危面仍不拦的对偶）；变异 P16；`2.3 边界` 那条用例同步去掉 RISK_GATE |
| R2-3 Warning | `merge-base` 解不出时退回 `baseRef` 继续按"已核对"判，等于把刚修的洞重新打开 | **接受**：改为 fail-closed（`blobBaseRef=''` ⇒ 一律「未证实」并出声）。另记可达性：CI 主路径上 `changedFileStatuses` 自己先解 merge-base，解不出早在取源层退出，所以那条兜底只有 `--statuses` 注入路径能走到 —— 用例 `第2轮R2-3b` 就是照这条注入路径构造的 | 用例 `第2轮R2-3` / `第2轮R2-3b`；变异 P19 |
| R2-4 Warning | `#\d{3,}` 与 `ses_…` 仍是无边界子串匹配 | **部分接受**：加左词边界（`noteses_X` 不再算会话 id）。**不**要求整串只有引用号 —— `PR #3900 后端轴` 这种"指针 + 一句话"是主干既有写法，收成整串会把合规出口削掉；而"提到一个 PR 号"与"指向一个 PR"在形状层不可分辨，这条限制写进注释而不是假装解决 | 用例 `第2轮R2-4`；变异 P18 |
| R2-5 Warning | `fingerprint` 裸子串把"讲到指纹的文档"也拉进高危域 | **接受并重新量**：条目加 `exts` 限定源码扩展名。实测该条 raw 命中 9、其中 2 份是 `01-docs/evidence/**.txt` 取证快照 ⇒ 收窄后归因 7 个真目标（含 `draft-fingerprint.js`）。清单规模与 2.1 的"命中 ≥1"改为**用判据自己的匹配器归因**，不再重抄一遍前缀规则 | 用例 `第2轮R2-5` + `2.1 高危面清单`；变异 P17 |
| R2-6 Warning | 改名带走"已闭环但无出处"的产物两头逃逸 | **否证**：高危面上这条新产物 A 已被 R2-2/矩阵拦住；非高危面上 `self-play` 收口本就是被承认的口径（§六 第 2 条），不是改名特有的漏洞。代码里加注释指明这条边界归属哪一档 | 注释 + §六 第 2 条 |
| R2-7 Info | `expandRenames` 两条分支返回类型不一致 | **接受**：无改名也返回 `slice()` 的新数组 | 用例 `第2轮R2-7`；变异 P20 |
| R2-8 Info | A 面伪造闭环是"被承认的残余"，别让下一个会话当已闭合 | **接受**：矩阵分支旁写明；且 R2-2 已把高危面那一半从"承认"变成"拦"，剩下的只有非高危面 | 代码注释 + §六 第 1 条改述 |

第 2 轮后驱动跑到 **21 条变异**，其中 P1/P5 第一次跑是 `ANCHOR_FAIL`（锚点随实现漂移：判据加了 `inScope`、`fingerprint` 加了 `exts`）—— 处置方式是**改驱动的锚点**而不是改判据的形状，改后重跑各 CAUGHT。最终 `escaped=0`、`anchorfail=0`（重跑轮）。

### 六、遗留（不假装已闭合）

1. **A 状态凭空伪造在判据层不可判**：一条本次新增（`A`）的产物，没有 base 版本可比，除自述外无对象可核 ⇒ 转变检测对它结构性失明。正解是 tasks 8.1 的另一半「闭环值只能由工具写」（`deep-review` 交付时才写 `tier=external` + 可核 `evidence` + `findings`）+ 事后抽查。**8.1 这条不勾**，因为本片只落了判据侧那一半；写入方那一半需要生产方改动，另立条目。**（2026-10-19 第 2 轮后收窄：高危面上「A 新增即闭环而 tier 缺席」现在拦 —— 见 §五 R2-2；剩下的只有非高危面那一半，而那一半与上面第 2 条是同一个欠账。）**
2. **非高危面上的 `self-play` 收口此刻仍算闭环**：这是刻意保留的（避免一刀把主干所有在飞 PR 判红），收紧它需要 tasks 4.x 的「机械对抗产物作为降级货币」。
3. **`closureNote >= 20 字符` 是形态阈值不是语义判据**：非高危面上随便一句长话就能满足。它承接的是主干既有约定（轮次 + 逐条处置），高危面上已确认不足以放行。
4. **`HIGH_RISK_SURFACES` 无「前缀指向的文件消失」检测**：清单只能缩小这条目前只由 `2.1` 那条「逐条命中 ≥1 个受管文件」的用例守住 —— 它会红，但红在测试里，不在 PR 判据里。改名/删除时是否要另立执行体属改「谁来守门」，留人工裁决。
5. **变异驱动未入库**：P1–P7 的驱动落在本机临时目录，复现方式是按 §四 表格逐条手工改回被禁形态再跑 `node --test scripts/check-pr-exec-record.test.js`。把它变成可被判据消费的产物正是 tasks 4.1–4.4；在那之前不假装它有货币地位。
6. **`--repo <目录>`（空格形式）会被解析成布尔 `true`**：本片实跑时踩到，症状是 `spawnSync git ENOENT` 形同门禁红。属既有取参缺陷，登记而不与本 PR 混改。
7. **本地预跑与 CI 的边界**：`.github/scripts/workflow-contract.test.js` 与 `.github/scripts/check-workflow-structure.js` 在本 worktree 因 `js-yaml` 未安装而**无法直接跑**（`Cannot find module`，不是回归）。本轮用共享根已安装的同一份库（`NODE_PATH` 指过去）跑通：`workflow-contract 43 passed / 0 failed`、`workflow-structure files=14 violations=0`。这两个数不代替 CI。
8. **跨面行为变更前缀抓不到（tasks 2.5 点名的 design §3 残余）**：判据只看「本次变更集里有没有文件路径落在高危面前缀上」。一次行为变更若发生在非高危路径、却改变了高危面的语义（改了共享工具函数而调用方是 `credential-*`），前缀匹配**结构性看不见**。design §3 那句「如实登记残余」指的就是这个形态。可收窄方向是按「被高危面文件 require 的模块」反查一跳，但那需要一张依赖图且会引入假阳 —— 属改「谁来守门」，留人工裁决，本片不假装闭合。
9. **`unknown`（字段缺席）那一档没有转拦**：产物整段没写结构化 `tier`（或写着生产方初始值 `unknown`）时，收口矩阵不插手 —— 由 `unrecognized` 档负责"写错/编造"那一半，缺席那一半仍不拦（负控用例 `2.3 边界（不可闭合循环负控）` 钉住，主干实测 142 篇已闭环里 139 篇属这一档）。这是**刻意的**，理由与代价都写在 §三 与 tasks 2.3；转拦前提是这一档占比降下来，而占比要降先得有写入方（tasks 8.1b，落点在仓外引擎）。在那之前，「不写 tier」仍是一条不需要出处的收口路径。
10. **矩阵只作用于 `mode=dual` 的产物**（codex #7）：判定器对非高危但敏感的改动多半只写 `single`，而 `single` 不要求闭环（缺陷G 的既有取舍，扩它就是那条无法闭合的循环）。所以「命中高危面前缀」与「被要求双模型评审」是两个集合，交集之外这一格无人守。同时 `HIGH_RISK_SURFACES` 与判定器的 `RULES.sensitivePaths` 是**两份独立清单、实测已分叉**（gate 有 `fingerprint`/`account-state-lock`/workflows，decider 有 db/migrations）—— 收敛成一份属改「谁来守门」，留人工裁决。
11. **高危面匹配是"路径里出现该词"而非"路径段前缀"**（codex #5 的取舍）：`fingerprint` 这类跨目录词会命中任何含该词的路径（含文档与夹具）。本片选择保留宽匹配 + **点名触发文件**（误伤当场可归因），而不是改窄 —— 改窄会静默削掉实测 9 条 `fingerprint` 命中（含 `draft-fingerprint.js` 这类真目标），那等于把覆盖变窄写成精度提高。要真的收窄，得先重新量每一词的命中域并逐词给出处。
12. **`closureNote` 仍是形态判据**（claude W4 的边界）：加了「轮次标记 + 逐条处置结论」之后，`'x'.repeat(20)` 不再过关，但"认真编一段带轮次和处置词的话"仍过得去 —— 它承接的是主干既有约定的**形状**，不是语义。语义那一面只能靠外部评审产物（`tier=external`）与事后抽查，也就是 §六 第 2 条与 8.1b。
13. **第 2 轮只有单轴复审**：跨家族轴 `codex` 三次未交付（`429` ×2 上游限流、`503` ×1 本地代理 upstream 报障），清单里的 `opencode` 仍是 IP 级拒绝 ⇒ 处置引入的那部分改动（约 +120/−35 判据、+95/−3 用例）**只经过后端轴复审**，没有第二家族交叉。这不满足 AGENTS「双模型并行」的字面要求，所以本 PR 的证据档里不写"第 2 轮双模型完成"；补法是要么等后端恢复再跑一次、要么由人工指定另一个可达家族。留在此处而不是藏进"跑过一轮"这句话里。

### 七、误伤测量：判据对既有先例是不是「事后判红」

上面第 9 条说 unknown 占比高，但「高到什么程度」「本片判据到底会打到谁」必须现量，不能靠推理。探针：`origin/main` 最近 **40 笔第一父提交**（squash 仓，逐笔 `git diff <sha>^ <sha>` 取差量），只看变更集内 `mode=dual` 且状态已闭环的产物，出处分级与高危面命中**都调用判据本体导出的 `closureCorroboration` / `highRiskHits`**，不在探针里重抄口径。

| 读数 | 值 |
| --- | --- |
| 能取到差量的提交 | 40/40 |
| 变更集内「已闭环的 dual 产物」 | 19 条（10:20 后在最终基线 `79f9c6cdd` 上重取；早先一次读的是 21 —— 窗口随主干前进而漂移，这正说明"数字必须现跑"） |
| 出处分级 | `unknown`（整条没有 tier 字段）**16** ／ `external` 1 ／ `note` 2 ／ `self-play` 0 ／ `none` 0 |
| 同变更集命中高危面的条数 | 4（同上重取；`fingerprint` 加 `exts` 之后归因面变窄，这条从 5 降到 4） |
| **本片矩阵会新判红** | **2 条**（`d65f0b76f` = PR **#3927** 的两条产物：`status=needs_revision`、`performedBy=claude`、只有 `closureNote`、无 `tier`，落 `.github/workflows/` 高危面） |
| **转变检测会新判红** | 0 条 |

三条结论，按可信度排：

1. **不会 retroactively 打红任何人**：判据只看「本 PR 自己的差量」，`d65f0b76f` 早已在 main 上、不会被重新求值；后续 PR 若不去动那些产物就碰不到它们。这 2 条是"如果重跑会红"，不是"现在有人红着"。
2. **但它确实把主干既有的一项惯例变成不够用了**：`closureNote`（轮次 + 逐条处置）在**高危面**上从此不足以收口，必须 `tier=external` + 可核 `evidence`。这是 tasks 2.2/2.3 的字面意图，不是副作用 —— 只是它意味着**下一个在 workflows 面上收口的人会当场红**，而他很可能已经真跑了外部评审（#3927 那两条现场就写着 `performedBy: claude`）。
3. **所以 2.x 与 8.1b 是耦合的，且顺序不能倒**：本仓现在**没有任何生产方会写 `tier`**（当场核实：仓外引擎 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js` 全文 `tier` 出现 0 次；`scripts/deep-review.sh` 同为 0）。矩阵要求的结构，工具造不出来 ⇒ 诚实的评审也只能靠**手写**来满足它。这正是 §六 第 2 条与 8.1b 的同一个洞，本片先落判据（并把这条测量留在记录里），**紧接着应该做 8.1b**，否则这条门禁的实际效果是「逼会话手写 tier」——那与本片想防的形态只差一层皮。

探针未入库（同 §六 第 6 条的理由）；复现方式：按上表定义逐笔取差量，出处分级与高危面命中调 `require('./scripts/check-pr-exec-record.js')` 的两个导出函数。数字随主干增长漂移，引用时现跑。

### 八、收口现场（本 PR 自己被自家判据量到的那一次）

两条 `mode=dual` 产物（`714b49f9…` 来自实现提交、`b141c006…` 来自处置提交）按 §五 的真实交付写成 `tier=external` + 可核 `evidence` + 25 条 `findings`。**写入方式仍由会话手写**（工具侧未落地 = tasks 8.1b），所以 `closureNote` 里明写了这一层，收口文案没有假装它是合规路径。

| 现场读数（最终基线 `79f9c6cdd` 上现取） | 值 |
| --- | --- |
| `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | **rc=0**，`OK: 本 PR 携带执行记录或带原因的豁免` |
| `TIER-COVERAGE dual-closed` | `total=2 external=2 external-unverified=0 self-play=0 none=0 unknown(字段缺席)=0 unrecognized(值不认识)=0` |
| `TRANSITION-CHECK` | `转变=无转变 扫描域=3 已核对=0 无出处=0 未证实=0` —— 两条产物在 PR 净差量里是 **A**（同 PR 内 pending→cleared 相互抵消），所以转变检测对本 PR 结构性无话可说；这正是 §六 第 1 条那个"A 面不可判"的残余在**我自己身上**的显形，不是"通过了所以没问题" |
| 变更集 | 8 个文件（A=4 M=4 D=0），新增记录 1 篇，`待清理豁免 1 条` |
| 用例 | `scripts/check-pr-exec-record.test.js` 113 passed / 0 failed；消费者并集 52+19+27+17 各 0 失败 |
| 变异 | 驱动 21 条、`escaped=0`（P1/P5 锚点漂移后改锚重跑各 CAUGHT） |
| numstat 两口径 | `--numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相等（判据 313/32、用例 507/5、记录 187/0） |
| 其余本地门禁 | `check-unwired-tests` / `check-step-failfast` / `check-workflow-structure`(files=14 violations=0) / `check-gate-record-debt` / `check-record-qm5-rows` / `check-visual-coverage` / `check-no-brand-residue` / `check-doc-abs-paths` / `check-changelog-growth` / `check-changelog-duplicate-entries` / `openspec-sync-check` / `openspec validate --strict` 逐条 rc=0 |

一句必须留下的对照：**这些本地读数不等于 CI 判定**。本仓 45 条 CI 判据与本地预跑几乎零重叠（既有记忆点名过这条边界），`QG Changes`/`QG Static` 的权威读数仍以 PR 侧与 main push 回读为准。

### 九、三个人工判断点的裁决与实测依据（2026-10-19，用户裁决「按你的建议处置」）

三个问题都是"该不该"，我给的是判据而不是结论；逐条现量如下。

**① R2-1「按记录自身路径判高危」的否证 —— 认（保持变更集级门槛）。**
两条现场事实决定这一点没有回旋：产物顶层**没有文件清单**（实测键集只有 `sha/layer/mode/reason/stats/stagedDiffHash/decidedAt/decidedBy/reviewBackends/backendAvailability/deepReview`，`stats` 是计数不是文件名），而产物路径永远是 `.ccg/reviews/<hash>.json` —— 9 条前缀全落在 `apps/ packages/ scripts/ .github/` 下，按记录自身路径归因 ⇒ `riskHits` 恒空 ⇒ **刚建立的矩阵整条失效**。
连带的排程结论：提交级归因是**可做但前提不在判据侧** —— 要先把文件清单落进产物（写入方改动），已登记进 tasks 8.1b 范围①。
误伤实测（同一窗口）：`已闭环 dual 产物 ∧ 命中高危面` = 4 条，来源全是真改了 workflow/门禁的 PR（#3934、#3927×2、#3941）⇒ "无关产物被连坐"的证据量是 0。

**② A 面凭空闭环改成"高危面拦" —— 认（保持拦）。**
增量成本单量了一次：40 笔里 R2-2 新增拦住 **1 条**，是 #3934（`b29a35add`）那条 `status=needs_revision`、`performedBy=null`、无 `tier`、无 note 的产物；并且我用 `judgeBackendMismatch` 实测它对这条返回 `null`（那条连 `reviewBackends` 都没有 ⇒ 署名规则前置条件不成立）。**所以这不是"本来就红"，而是一条真实存在过、当时无人能拦的零成本闭环路径。**
合法流不撞线：pre-commit 初始是 `pending`；真跑过评审会写 `external`；只有"新增即闭环且完全无出处"撞线。
风险如实保留：出口当前只能手写（8.1b 未落地），所以这条的实际效果包含"逼高危面 PR 手写 `tier`"——这正是把 8.1b 排成下一片、且顺序不能倒的理由（已写进 tasks 8.1b）。

**③ 是否立刻通知在飞会话 —— 不发广播，落到 tasks 6.3 的 AGENTS 改写，触发条件 = 本 PR 落 main。**
人群窄到可以直接点名：会撞线的只有 3 条红形态（`closureNote`-only 2 条 + 无出处 1 条），清一色是改 `.github/workflows/` 或门禁脚本的会话；普通代码 PR 不带已闭环产物根本不进矩阵。
渠道比较后选第三个：① PR 描述只有看 PR 的人知道；② 红文案本身（已落，两个出口写在里面）是唯一能在事故现场生效的渠道，已经建好；③ **AGENTS.md 是每个会话唯一自动注入的入口**，而它现在那句「本门禁未镜像它」从本片落地起就是**假陈述** —— 这条改写本来就是 tasks 6.3 欠着的。三条改写内容已逐字写进 6.3，合并后单开一个 docs-only PR 落，不塞进本片（那片已在改"谁来守门"，叠 AGENTS 会扩大过目面并加大冲突面）。

**新的盲区（附带发现，已登记）**：没有 `reviewBackends` 的闭环产物对署名判据是免检的 —— 见上 ② 的那条实测。登记在 tasks 8.1b 范围②，本 PR 不扩（扩它就是改豁免政策，须人工过目）。


