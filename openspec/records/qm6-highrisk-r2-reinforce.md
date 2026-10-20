---
# 用法：本记录由 openspec/records/_TEMPLATE.md 复制而来，文件名即键。
record: qm6-highrisk-r2-reinforce
task: PR #3987 合并后落地跨家族第 2 轮复审的真缺陷修复，并收敛取源/装配/读数三处口径
date: 2026-10-20
---

## 本次执行记录：高危面收口矩阵的跨家族第 2 轮修复（qm6-highrisk-r2-reinforce，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（判据脚本本体）：worktree `mp-ccg-review-degradation` + 裸分支 `qm6-highrisk-r2-reinforce`，经 PR 落地 |
| 第一性原因（QM-5 ①） | ✅ | 见下 §一 —— 规则本身对，**装配层不共源**（改名/C 与 R 混同、transition 没挂到被打印的对象、变更集与 base blob 两次 merge-base） |
| 逃逸分析（QM-5 ②） | ✅ | 见 §二，五层逐条给"为什么没拦住"，含夹具只构造 R100 从不构造 C75 这一结构性免疫 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `scripts/check-pr-exec-record.test.js` 118 → 125 用例，新增 7 条全部指名红；36 条变异反证 |
| 防止再次发生（QM-5 ⑤） | ✅ | 接线锁 X2-4/X2-12（扩锁）+ X2-14「why 里的实测数必须与归因对账」把"注释数字过期"变成当场红 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等（本轮实跑：判据 +145/−29、用例 +133/−0、tasks +4/−0）；插入一律走逐行 splice 保留原行尾，每步写盘前断言 `loneLF=0 loneCR=0` |
| 接线棘轮 | ✅ | 未新增测试文件（全部扩写既有 `check-pr-exec-record.test.js`，该文件已在 `quality-gate.yml` Gate 2b 点名）；`node scripts/check-unwired-tests.js` → `检查域内测试文件 111 个 / OK` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面：改动全在 `scripts/` 判据与文档，`apps/desktop/electron/`、`packages/rpa-engine/` 与前端文件均未改 |
| QM-6 CCG 双模型外部评审 | ✅ | 见 §五（判定 DUAL、变更 364 行 > 200 行阈值；后端对取自 `scripts/ccg-review-backends.list`，不在文档里写死模型名） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属；合并前把它写成 `PASS` 会被判 `prematureClaim` 红 |

### 一、第一性原因：不是"规则写错"，是"装配层不共源"

这片判据有三个消费点——收口矩阵、转变检测、覆盖率读数——它们各自读同一份 `.ccg/reviews/*.json`。第 1 轮两轴评审把**每条规则内部**修到正确了，
但跨家族轴（codex）打在的是规则**之间**：

1. `expandRenames` 把 `R`（改名）与 `C`（复制）一起合成「旧路径 = D」。复制时源文件仍在树里，合成 D 等于凭空制造一条"删除未闭环记录"⇒ 误红别人。
   用例名写着 `R100/C75`，夹具却只构造了 `R100` —— 这一格在测试里**根本不可表示**。
2. 改名这一支只看 base 侧的未闭环状态，不看新路径在 head 是否已合规收口。而红文案教人的出口恰恰是"把闭环状态与新路径一起带过去"
   —— **门禁给的出口被门禁自己判红**，这是"自己和自己打架"的第四种落点。
3. `transition` 挂在 `deepDebt` 上，而 `report()` 拿到的是 `evaluate()` 的结果对象；且判定行只在 `r.ok` 分支走 `verdictLine`。
   于是「未证实=7」与「一条都没核到」在末行逐字同形 —— 纯函数 `verdictLine` 单测全绿，装配处一次都没被经过。
4. `HIGH_RISK_SURFACES` 少了 `scripts/lib/ccg-review-`。那条是**评审后端对的真源**（决定"谁来评"），改它不触发任何收口要求；
   清单自称"逐条带实测出处"，却没有任何东西在核对 `why` 里那个数（`scripts/check-` 写 100，实测 106）。

同一个根因覆盖四条：**判据的规则、判据的装配、判据的文案出口三者分别由不同的人（会话）写，彼此没有一条对账**。

### 二、逃逸链：每一层为什么没拦住

| 层 | 结论 |
| --- | --- |
| 单元测试 | 夹具只构造 `R100`，`C75` 分支从未被喂进 `expandRenames` ⇒ 该缺陷对测试结构性免疫 |
| 判据自审（第 1 轮 claude 复审） | 单轴复审看的是"规则对不对"，四条里三条是"装配对不对"——同族复审看不见同族的盲区 |
| 变异驱动（21 条） | 每条变异都摘在**规则分支**上（`cor === 'none'`、` corroborated` 等），没有一条摘在赋值/传参上；`target.transition = …` 那行当时根本不存在，也就无从摘起 |
| 跨家族轴（codex） | 四条全部命中，另给出一条我原先写成"永不命中"的锁（见 §四） |
| CI | 本判据在 CI 是 `--mode=advisory`（打印理由后 `exit 0`），所以"QG Changes 绿"从来不是"QM-6 已闭合"的证据 —— 这条本身登记为 tasks 8.6 |

### 三、落了什么

1. **`expandRenames` 按语义拆 R 与 C**：只有 `R` 才合成旧路径 `D`；`C` 只合成新路径 `A`。用例 `X2-6`。
2. **改名带走闭环 ⇒ 回看新路径**：`renamedCarriesClosure(repo, 新路径)` 为真则不再计欠账；新路径仍不成立才点名。用例 `X2-7`。
3. **清单补 `scripts/lib/ccg-review-`（现 10 条）**，并把每条 `why` 里的"实测命中 N 个"变成机器可对账的数（见 8）。
4. **段起点匹配保留 + vendored 子树排除**：跨家族轴建议改成 `startsWith` 根锚定，**实测否证** ——
   `scripts/check-` 的非根位命中有 42 个真判据（`.github/scripts/` 40 + `apps/desktop/scripts/` 2），钉到仓库根等于给 CI 侧门禁脚本整体免检；
   而段起点唯一的实测误伤是 `.quality-rhythm/.github/workflows/mechanism-check.yml`（上游技能制品的嵌套 workflow，GitHub 只调度顶层那份、永不排队执行）
   ⇒ 正解是按 `VENDORED_SUBTREES` 排除子树，清单只能缩小。用例 `X2-8`，变异 P25（根锚定）/P34（退回子串）双向红。
5. **判定行接上装配**：`applyDeepDebt` 把 `transition` 挂到被打印的对象；`report()` 两支统一走 `verdictLine`，
   「未证实 + 无出处 > 0」时末行输出 `OK（但转变核对有 N 条没核到…）`。用例 `X2-11` + 接线锁 `X2-12`。
6. **`unrecognized` 的红文案公布闭集**：`external | self-play | none | unknown`。动因是现量的：
   主干最近 40 笔里已有 **3 条自造 tier 值**（`docs-false-positive` / `superseded` / `dual`，`closureNote` 全空）——
   发明词汇的人不是坏，是看不见清单。
7. **`evidence` 的路径形态改为注入式存在性探针**：`existsAtHead` 走 `git cat-file -e <head>:<path>`，验不到即降 `external-unverified`
   （高危面因此从"编个像样的路径就能收口"变成"必须真有其物"）。探针是**注入参数**：不注入时保持原形状语义，测试与仓外调用方不受影响。
   用例 `X2-5①②`；范围如实划出：只验"该 revision 里有这个对象"，不验内容。
8. **取源与读数同域**：`merge-base` 在判据里只算一次并同时喂变更集与 base 侧 blob（原注释写"真同源"而实现算了两次）；
   `TIER-COVERAGE` 与债务扫描同走 `expandRenames`。用例 `X2-4（接线锁）`、`X2-10`；对账用例 `X2-14`。

### 四、变异反证

驱动：本机临时目录下的 `qm6-risk-mutate.cjs`（**41 条**，最终态整跑一遍；未入库，同 §六 第 5 条的理由）。
口径不变：每条要求**指名红**（红集里出现预期用例名）+ 还原后 md5 与快照逐字节相同 + `collected` 有下界（防"整片 LOADFAIL 冒充指名红"）。

**读数**：`41/41 CAUGHT，escaped=0 anchorfail=0`，每条还原 md5 一致。

这一轮真正值得记的不是"41 条都红了"，而是**其中 4 条先是驱动与用例自己的失明**，被跑数当场暴露：

| 编号 | 现场 | 归因与处置 |
| --- | --- | --- |
| P30 | 把 `main` 里的探针注入摘成 `undefined` ⇒ **133 条全绿** | 债务用例自己注入探针，`main` 的装配不在任何跑道上。补接线锁 `X2-5③`（含"探针构造必须晚于 `statuses`"的顺序断言 —— 早于它就会读 TDZ 里的 `statuses`，那是另一种崩法） |
| P34 | 把段起点判据摘成任意子串 ⇒ **全绿** | 上一版 `X2-8` 用的是 `vendor/scripts/…` 当判别串，而**本仓根本没有 `vendor/` 目录** ⇒ 那条断言对两种写法同真，等于用不存在的证据自证。补两条能真正区分的串（`xscripts/check-y.js`、`backup.github/workflows/ci.yml`） |
| P36 | `for...of` 版第二份匹配只红新写的扩锁，不红旧的 `2.1 单一匹配实现` | 这不是缺陷而是 i7 指控的正身：旧锁禁的是方法名，换个写法就绕过。把 `expect` 改为只红扩锁，并把"旧锁无牙"写进本节，不写成两条都红 |
| P35 | 「把 `why` 里的数改小」永不红 | **前提被实测否证后撤销该变异**：下界棘轮刻意只咬"覆盖变窄"这一个方向，而变窄要靠**删受管文件**才能模拟，改代码模拟不出来。它的牙由 P25（根锚定把 106 削到 64 ⇒ `X2-8` 与 `X2-14` 同时红）承担。撤销而不是硬凑一条红，是这条表存在的意义 |
| P32 / P40 | 两条 `ANCHOR_FAIL` / `NO_COLLECTION` | 都是**驱动自身**的缺陷：P32 的多行 needle 用 `\n` 拼，而判据工作副本是 CRLF ⇒ 永远命中 0 次；P40 的 `to` 只替换了行首片段，拼出一行语法不合法的代码 ⇒ `collected=1`（那不是反证，是把被测对象写坏了）。各自修正后重跑 CAUGHT |

两条方法论，按本仓既有口径记在这里：

1. **「摘掉它仍然全绿」就是这条锁没有跑道的证明**，与"它测的规则对不对"无关。装配类判据（谁把参数传给谁、谁在什么之后构造）只能用接线锁 + 顺序断言钉，纯函数用例对它天然失明。
2. **判别串必须在被测域里真实存在**。用 `vendor/` 这种"本仓没有的目录"做负控，会让一条看起来最严格的断言永远为真 —— 这是"装饰性门禁"的第五种落点（前四种：断言恒真、`run:` 不 fail-fast、永不命中的禁词、夹具替对方剥壳）。


### 五、QM-6 双模型外部评审（本片自己）

**判定**（pre-commit 按提交差量各自落产物，模型名一律读自 `scripts/ccg-review-backends.list`，不写进文档）：

| 提交 | 判定 | 产物 | 是否要求闭环 |
| --- | --- | --- | --- |
| `f1997e518`（364 行） | **DUAL** | `2cabfe8e….json` | 是 |
| `b5de74d5f`（73 行） | single | `0366d63c….json` | 否（缺陷G 的既有取舍，`2.3 边界` 钉住） |
| `124bc0438`（251 行） | **DUAL** | `d39db947….json` | 是 |

**交付过程里的两次真实形态，都不按"跑完了"记账**：

1. 第一趟 critic 轴 `ETIMEDOUT`（约 13 分钟），驱动把产物写成 `status:"error"`。按产物判 ⇒ **零交付**，
   而不是"等久了算失败"。重试同一后端对才拿到第一批 7 条。
2. 第二趟（对 `b5de74d5f` 之后的状态）交付 7 条，minScore=4 ⇒ 引擎转第三档自扮演，生成 5 条待裁决模板。

**两轮合计 14 条**：upheld（接受并改）6 ／ dismissed（否证且带产物）3 ／ not-disputed（引擎判其无需裁决，多为 Info）5。
逐条 prosecution / defense / verdict / rationale 落在 `.adversarial/ccg-deep-{f1997e51,b5de74d5}/adjudication.json`
（该目录被 `.gitignore` 收录，所以**产物不在仓里可审** —— 这本身就是下面"跨家族轴未获得"那条的一部分原因）。

三条 dismissed 都不是"读代码看起来没事"，而是**新写的可跑用例**（i1+i2 用 `expandRenames` 的行为断言钉住
「C 不产生 D」「D 侧 viaRename 严格等于新路径」；i3 用无共同祖先的孤立分支使 merge-base 必然失败，断言现场读数
`未证实=1 / 已核对=0` —— 若真按指控那样读了暂存区，这两句同时不成立）。**否证也要有产物**，否则驳回与偷懒无法区分。

一条本轮自己撞出来的**互不认账**（不来自任何评审轴，来自我按引擎模板写证据的那一次）：
`.adversarial/*/adjudication.json` 的 instructions 要求 `externalReview.evidenceRef` 写成
`https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>`，而本判据此前**一种形态都不认**
（`#` 后不是数字、串里没有 `.md/.json`）⇒ 照引擎模板写证据的人会被自家门禁判 `external-unverified`。
现新增 `url` 形态（只认 `github.com/<owner>/<repo>/pull/<数字>`，五个形似串做负控），且 URL 不被存在性探针伸手。

**跨家族第二家族本轮未获得**，所以本片不声称"双模型完成"：

- `codex` 直呼一次：产出 **0 条 JSON**（全文只有工具报错与 `unsupported call: spawn_agent`），
  且在被停止前执行了 `stopped <pid>` **三次**（终止了本机进程，归属无法核实）⇒ 我按安全边界直接停掉该后台任务，
  不再复跑。这条不是"评审没跑好"，是**外部代理在用户机器上执行了破坏性动作**，已单独报用户。
- `gemini`：不在 PATH（`gemini command not found`）。
- `opencode`：清单里的 proposer，服务方按 IP 拒绝 free 模型，本轮未复测其可达性（不写"已确认不可达"以外的结论）。

因此本片的外部证据是**单一家族、两趟独立交付**（与上一片 §六 第 13 条同形态），收口按 `tier=external` 写，
但在 `closureNote` 与本节明写"第二家族未获得"，不把它写成"双模型评审通过"。

### 六、遗留（不假装已闭合）

1. **高危面上的 `single` 记录仍无人守**（跨家族轴 X2-2，Critical）：`mode !== 'dual'` 直接 `continue`，而判定器的 `RULES.sensitivePaths` 与本清单是两份独立清单、实测已分叉。
   两种评审修法都不采纳且各有实测理由（① 复现缺陷G 的无法闭合循环；② 把刚建的门禁整条关掉），正解在写入方 ⇒ 登记为 tasks 8.5，属"谁来守门"，须人工过目。
2. **CI 侧仍是 advisory**（X2-16）：本片的真实拦截发生在 enforce 与测试里，不在 required check 上。登记为 tasks 8.6。
3. **高危面 + `M` + `tier` 缺席 + base 读不到**这一格仍放过：只计入转变读数的"未证实"。攻击形态存在（让 merge-base 解不出即可免检），
   但 base/head 由 CI 注入、会话不可控这一前提**没有做过否证实验**，所以只能说"未观察到可利用"，不能说"不可利用"。
4. **存在性探针只到"对象存在"**：不验那份证据的内容与本次评审相关 ⇒ `'a'.repeat(40)` 那类形状问题在 oid/uuid 两档仍在（它们无法在本仓上下文里验）。
5. **`why` 的对账只覆盖"写了数的条目"**：没写数的条目（如 `scripts/ccg-review-` 那条已补，但将来新增可不写）不被强制带数 ——
   强制格式属另一刀，先不造"必须匹配某种文案"的脆判据。
6. **上一片 §六 第 13 条（第 2 轮只有单轴复审）由本片解除，但只解除到它指的那一格**：那条说的是"#3987 处置引入的改动没经第二家族"——本片的第 1～3 节实现正是那批改动，它们现在有了跨家族复审（codex 16 条，逐条处置见 §三 与 §五），所以那条欠账是**证据补齐**而非措辞修订。**但本片自己的改动是新一个同形态实例**（只有 claude 单一家族两趟），记在 §五，不因上一片被解除而顺带算闭合。

### 七、现场读数（在 follow-up 的最终态现取：基线 `3e69148d7` + 本分支 3 笔提交；引用时须重跑）

| 读数 | 值 |
| --- | --- |
| 高危面条目 / 归因到的受管文件总数 | 10 条 / 158 个文件 |
| 逐条归因（`highRiskPrefixOf` 本体算） | credential- 3 / account-state-lock 1 / api-publish-engine/src/auth 18 / login-state 1 / fingerprint 7（raw 9，`exts` 吃掉 2 份取证 txt）/ .github/workflows 15（raw 16，vendored 排除 1）/ scripts/check- 106 / scripts/ccg-review- 3 / scripts/lib/ccg-review- 2 / scripts/deep-review 2 |
| 40 笔第一父提交窗口内 dual 产物 | A/M **40** 条，其中状态已闭环 **22** 条（在 follow-up 的最终态上重取；早先一次读的是 37/19 —— 窗口随主干前进漂移，这两个数会一直变） |
| 按五条分支算"会红条数" | `c1 none`=0 / `c2 unrecognized`=**3** / `c3 高危面+A+无 tier`=**3** / `c4 高危面非 external`=0 / `c5 转变无出处`=0（合计 6 条，同一产物可命中两格） |
| 自造 tier 值的实测清单 | `docs-false-positive`、`superseded`、`dual`（均在 4832662e9 / 2f438f857，`closureNote` 全空） |

探针（本机临时目录下的 `r2-blast-union.cjs`）未入库。**它替代了第一轮那份 `qm6-blast-radius.cjs` 的"矩阵新红=0"** ——
那份写于 `unrecognized` / `external-unverified` 两档存在之前，只打印四个桶（2+5+0+6=13 ≠ 19），
对另外 6 条完全失明；同一窗口按五条分支重算得 6 条会红。
**结论修正的代价要如实记**：第一轮的"0 误伤"里有一部分是探针失明，不是判据温和。

### 八、收口现场

两条 `dual` 产物（`2cabfe8e…` 来自实现提交、`d39db947…` 来自第 3 轮处置提交）按上面两趟真实交付写成
`tier=external` + `evidence` = 承载处置结论那个提交的 40 位对象 id + `findings` = 14 条逐条处置 + `closureNote` 带轮次与归属。

三条要如实写的：

1. **写入方式仍是会话手写**（tasks 8.1b 未落地：仓外引擎全文 `tier` 出现 0 次），所以 `closureNote` 里明写这一层。
   本片的红文案现在会把闭集念出来 —— 动因是实测到主干 40 笔里已有 3 条**自造** tier 值，
   而"手写"与"自造词汇"是同一格洞的两种表现。
2. **evidence 用的是提交对象 id，不是 PR 评论链接**：因为收口发生在开 PR 之前。开完 PR 后评审全文贴在
   PR 评论里（AGENTS：回读与证据写 PR 评论，不写回受扫描的文件），产物不再二次改写 ——
   二次改写会让同一条产物出现"closed→closed"的无意义转换，且把 `findings` 复制第二遍。
3. **`.adversarial/` 被 `.gitignore` 收录**：裁决原文不在仓内可审，产物里的 `findings` 是它的投影。
   这一点与 §五 那条"外部代理执行破坏性动作"合起来，就是 tasks 8.1b「写入方指纹」真正要解决的东西。
4. **本片自己踩到了「形状 ≠ 存在」**：产物 `evidence` 原本写的是承载处置结论那个提交的 40 位对象 id，而分支 rebase 之后那个 sha 已被重写、不再存在 —— `isResolvableEvidence` 对 40 hex 只判形状，于是它照样判 `external`、门禁照样绿，但人点开是一个不存在的对象。
   处置不是把 40-hex 那一档也拿去 `cat-file`（对象 id 可以指向 commit / blob / tree，验"存在"不等于验"是评审"，只会再造一条装饰性判据），而是**把出处改指本 PR 的评论 URL** —— 本片刚新增的 `url` 形态认它，`closureCorroboration=external` 当场量得；写之前先用判据自己的 `evidenceForm` 与 `closureCorroboration` 验过，不验就写正是本片要防的动作。
   这条同时给出 §六 第 4 条那句"只验对象存在，不验内容与相关性"的上界：**连存在性都没覆盖到的那一档，靠的是"公开可点开"与人工抽查，不是机器可验。** 真正能判"谁真跑了"的仍是 tasks 8.1b 的写入方指纹。
