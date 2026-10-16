---
record: freeze-legacy-gate-carrier
task: 把 .quality-gates.md 冻结为只读存档（哈希+计数基线、加块/删块判红、顶部棘轮退役），新 PR 记录载体统一为 openspec/records/
date: 2026-10-15
---

## 本次执行记录：冻结旧载体为只读存档（freeze-legacy-gate-carrier，2026-10-15）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 动了 `scripts/` 判据本体 ⇒ 混合 PR ⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-freeze-legacy-gate-carrier`、裸分支 `freeze-legacy-gate-carrier`（`git rev-parse --abbrev-ref HEAD` 实证），起点 `5952d38c2`；依赖经 `-NoDeps` 跳过（本轮判据只 require node 内置 `fs/path/crypto`，`node --test` 实跑不依赖 node_modules） |
| 第一性原因（QM-5 ①） | PASS | 不是"某处写错"，而是**载体设计**：每个 PR 都被要求往两个全仓共用的追加型文件写一笔，而共享主工作区只有一份工作树/index/HEAD。判据源码实测（`check-gate-record-debt.js`）表明这一步对机器判定是冗余的：记录文件源的登记读**自身 frontmatter**（`source:'records'`，`:285` 一带），ledger 只服务旧载体（`source:'legacy'`，`:205`）；`check-pr-exec-record.js:43` 的 `CARRIER_RE` 三种载体任一即可且注释写明"只 M 载体不带记录是红的" |
| 逃逸分析（QM-5 ②） | PASS | ①**判据层**：既有门禁只审"已存在的行是否收口"，对"这些行根本不必存在"完全失明——它 measure 的是说谎，不是冗余；②**规范层**：AGENTS.md 把插旧载体写成硬要求（docs-only 精简模板 + 「⛔ 两种形态必须同写」），于是没有任何会话质疑其必要性；③**审查层**：本日先合入的 `hot-carrier-atomic-landing` 也接受该前提去做"加测量/加拦截"，直到 QM-6 CONFIRMED 暴露"pre-commit 抓不到目标形态"，才回过去问"这个写面为什么必须存在" |
| 修复 + 回归保护（QM-5 ④） | PASS | 判据：`carrierDrift`（sha256 + 条数，注入式基线，CLI 才读生产文件）；测试 57 条（新增 8 条：一致不报漂移 / 加块判红点名 / 删块判红 / **只改状态行不得判红** / 缺基线与零基线必须抛错 / 未注入不得静默读生产 + 接线锁「必须在库、不得被忽略、复用判据同一口径」 + 「基线自身不一致必须抛错，不得退化成只报计数」），`node --test scripts/check-gate-record-debt.test.js` → 55 passed / 0 failed；真仓 CLI `node scripts/check-gate-record-debt.js` rc=0 |
| 防止再次发生（QM-5 ⑤） | PASS | ①AGENTS.md 新增「旧载体冻结」小节（**新增段落用追加**：该文件多会话共改，新写段落整段改写会造整文件冲突；④那四处属同一条规矩的另一端，只能就地限定，与"追加"不矛盾）；②本 change 的 spec delta 把"新 PR 不再写旧载体"与"关闭历史欠账仍走旧载体"两条同时钉进 requirement；③按已合入规格自己的退场条件，把 `hot-carrier-atomic-landing` 的 (2) 一条命令收口 /(3) pre-commit 拦截标为不实现，只留 (1) 事后测量；④**自查补出四处「规范原文仍在命令会话去写旧载体」并就地限定**（docs-only 精简模板 / 「回填与销账必须同一次提交」/ 合并后收尾清单第 3 步 / QM-6 评审记录落点）——只追加新小节而不改这四处，等于留下"AGENTS.md 叫你去写、判据拦你别写"的矛盾指令，下一个照规范做的会话必然被本判据判红 |
| 反证（变异） | PASS | 对判据本体做 3 条变异，**各让不同指名字用例变红**、还原后 md5 与改前一致、`escaped=0`：M1 从 `hasBlocking` 摘掉 `carrierDrift` ⇒「加块判红」红；M2 `carrierSignature` 哈希改成常量 ⇒「真仓冻结自检」红；M3 缺基线时静默 `return null` ⇒「必须抛错」红。M2 特意证明规模下界那条不是装饰（识别退化会造出"零漂移"假绿）。**第二批 4 条（N1–N4）针对新加的接线锁与基线一致性校验**，先跑控制对照（未变异 56 passed / 0 failed）证明探针不恒红，再逐条：N1 摘掉 `.gitignore` 那条反选 ⇒「必须在库、不得被忽略」红；N2 把生成器**退回它真实出错过的写法**（自带 `/^## /`）⇒ 同一条红；N3 把生成器改名（不存在）⇒ 同一条红；N4 把基线一致性校验改成恒不触发 ⇒「冻结基线自身不一致」那条红（该用例自带正控：合法基线必须读得出来，否则三条负控只是"任何文件都抛错"的同形红）。四条各 `fails=1`、红集只含该用例、还原后 md5 一致、`escaped=0` |
| 行尾与 diff 对账 | PASS | 两口径 `numstat` 逐文件相同。**本轮另抓到并修掉自己两处行尾 bug**（同一族）：① 插入脚本按 `\n` 切 CRLF 文件后未剥行尾 `\r`，再用 `\r\n` join ⇒ 变 `\r\r\n` 双 CR，断言在 write 之前拦下（CR 2250 vs LF 1131）；② 早先给 ledger 手工拼 CRLF 留下不接 LF 的孤立 CR ⇒ git `text=auto` 对整份跳过归一化，1 行改动膨胀成 60/60 幽灵 diff，且**两口径一起爆**（所以那条对账只证膨胀、不证成因，必须另量 `git show :0:<path>` 的 CR/LF/CRLF 三者相等）。AGENTS.md 本轮全程纯行尾：工作副本 1150 行且 CR==LF==CRLF 三者相等，主干 blob 为 LF 1138 ⇒ 1138+12=1150 与"新增小节 12 行、就地限定 4 行不改行数"逐项对得上（净 diff 16 加 / 4 删，删除的 4 行逐条核对就是那四处被改写的原文） |
| 基线落地重取 | PASS | rebase 到 `origin/main` 后 `node scripts/check-gate-record-debt.js` 首次 rc=1 并点名新增两块（`fix-qm1-electron-run-as-node` / `publish-frequency-policy-v3`，均为**已合并的上游记录**、非违规）⇒ 按本 change 规格出路 ② 人工跑 `node scripts/freeze-gate-carrier.js` 重取：603/`5fed93f022ff…` → 605/`e47048f748ec…`；重取后 rc=0、测试 55/55。**这条红是判据第一次真实命中**。**第二次同因复发**：再次 rebase 后 origin/main 已到 607（`fix-newtab-home-slow` 一块由上游合入），CLI 又当场 rc=1 ⇒ 第二次人工重取到 607/`636b6e82cdf8…`，测试增至 57/57。⇒ 结论要如实写：**基线是一次会随主干漂移的读数**，本 change 落地前已重取两次；每条新 PR 若在冻结落地前又往旧载体插块，合并侧就得再重取一次（出路 ①「改写记录文件」在这里不适用——那是别人的已合并 PR） |
| 接线棘轮（CI 侧） | PASS | **本 PR 现在还动了 `.github/workflows/quality-gate.yml`**（`changes` job 的 `Detect docs-only changes` 步骤按事件名传 `--carrier-mode`）⇒ 属"改谁来守门"那一类，更不得自动合。该步骤 `shell: bash`，判据改动由 `check-step-failfast` / `check-workflow-structure` / `workflow-contract.test.js`(37 条) 三条实跑全绿把关 |
| 接线棘轮 | PASS | 本 PR 不新增测试文件（改的是既有 `check-gate-record-debt.test.js`，该文件已由 `quality-gate.yml` Gate 2c 点名），故 `check-unwired-tests.js` 无新增欠账；生成器 `scripts/freeze-gate-carrier.js` 非测试文件。**但它是 `.js` 且落在 `.gitignore:106` 的 `scripts/*.js` 忽略域内**，不显式反选则 `git status` 里根本不存在、本地在盘跑得通而 CI 看不见（同 #3011 家族，本仓已第四次踩同一处）⇒ 已在 `.gitignore:382` 加 `!scripts/freeze-gate-carrier.js`，产物证据：`git add scripts/freeze-gate-carrier.js` rc=0；忽略面判据一律用 `git check-ignore --no-index -v`（第一版这里写成裸 `git check-ignore -v`，会把复跑的人带坑里：文件一旦 tracked，裸命令返回 rc=1 且**无输出**，看着像"探针没工作"；只有 `--no-index` 才回显那条反选）；基线 JSON `scripts/gate-carrier-freeze.json` 不在该 glob 内，且**刻意不放进 `CI_IGNORED_PATHS`**——进白名单就得按「前提锁」另登记它的校验落点，而它已在不被 docs-only 短路的 `changes` job 里被校验，加进去只会多一道维护并把"重取基线的 PR"误判成纯文档 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面 |
| CI 实测暴露的分档缺陷（已修） | PASS | **PR #3672 的 CI 第一次跑就红了**（run `38781654774` / job `116583113972`，步骤 `Detect docs-only changes`，红的是「真仓：旧载体必须等于冻结基线」那条自检）。根因不是有人违规，而是**我把一条 main 态性质装到了 PR 档**：`pull_request` 事件 GitHub 检出的是 `main ⊕ 本分支` 的**合并预览**，主干每几分钟长一块 ⇒ "状态等于冻结基线"在 PR 档结构上必红（写在今天、红在明天的引信）。修法=按档分判：新增 `--carrier-mode=block|visible`（默认 block，**非法取值与裸旗标一律抛错**），workflow 在 `changes` job 里按 `GITHUB_EVENT_NAME` 传档，真仓自检同步换成两档（PR 档判"本分支没加块、没删块"，main/本地档判严格相等），并**打印本次走的是哪条支路**。实跑：CLI 三档各验（block rc=0 / visible rc=0 / 非法旗标抛错）；`GITHUB_EVENT_NAME=pull_request node --test` 全绿且打印 `branch=PR可见档`；变异 M8 摘掉模式开关 / M9 非法旗标静默回落 / M10 可见项退回 ❌ 形态，三条各让「carrier-mode」那条指名变红、还原 md5 一致、控制对照 58/0 |
| QM-6 双模型外部评审 | PARTIAL（不假装 PASS） | **后端 claude**：首跑 rc=0 但交付物是一行 `API Error: 503 system cpu overloaded`（本机 CPU 92% 超网关阈值）⇒ 属"跑完但零交付"，已重跑并**交付 14 条 findings**，逐条先取证再处置（采纳 6、不修 2、否证 2、升级人工 1），明细见「QM-6 评审处置」小节。**前端 opencode**：三次真跑 rc 全为 0，三次都只回 Objective/Work State 过程快照、没有 findings 载荷（第 3 次是我自己犯的引号嵌套把提示词打碎，不计入真跑）——按规格「3 次全败才跳过」计入跳过，**不得据此声称双模型已评审**。已从两份快照里取出它**自己验证过的事实**并逐条核对：①基线 JSON 不在 `CI_IGNORED_PATHS`（与自测一致）；②校验接在 `quality-gate.yml:65-66` 的 `changes` job、不被 docs-only 短路（与自测一致）；③**没有任何测试或门禁引用 `scripts/freeze-gate-carrier.js`** —— Critical 级真命中，已补接线锁 + N1–N3 变异反证。 |
| 远程同步 | PASS | PR #3672 已 squash 合并 = `4997c24fcbb8e01a6e61fc5a89252a077d58f5ba`（2026-10-16T11:12:57+08:00，取证 `git log origin/main --grep='(#3672)$' --format=%H|%cI` 恰 1 行）；远端分支已删（`git ls-remote --heads origin freeze-legacy-gate-carrier` = 0 行）。**合并由用户当次明确授权**（本 PR 属"改谁来守门"，不适用自动合并）。⚠ 合并后 main push run `38844395334` 的 `QG Changes` **按设计判红**（`not ok 17 - 真仓：旧载体必须等于冻结基线`，main 档严格自检）⇒ 冻结判据第一次真实咬合；已由本笔回填同次重取基线收口（见下行） |

- 保留门禁：变更类型与隔离 PASS（混合 PR 走 worktree）| 行尾对账 PASS（两口径逐文件相同）| 品牌残留 PASS（`check-no-brand-residue.js` rc=0，扫描 9214 个 tracked 文件）| 文档同步 PASS（被 CI 收编的 `node --test scripts/openspec-sync-check.test.js` 见下条；`openspec-sync-check.js` 本身的 14 条与干净 main 控制对照逐条同集 ⇒ 本 PR 净增 0）| 变异反证 PASS（3 条指名红、escaped=0、还原 md5 一致）| 载体自证 PASS（变更集不含 `.quality-gates.md` 与 ledger，见下节命令）| 远程同步 PASS
- 两个 change 的 validate 均 rc=0（`hot-carrier-atomic-landing` 勾账后复跑 + `freeze-legacy-gate-carrier` 新建）
- 顶部棘轮退役后「最新一篇必须有收口」由谁承担（一条在拦截面上、一条是 advisory —— 后者见「QM-6 评审处置」③W1）：`check-pr-exec-record.js` 要求每个 PR **携带新增执行记录 ≥1 篇**（本 PR 现场打印 `新增记录 1 篇 / 载体M=0`），键就是 `openspec/records/<分支名>.md` 的文件名——**但它在 CI 上是 `--mode=advisory`（`quality-gate.yml:139`），只出声不拦**，所以"整篇记录缺席"目前无人阻断（QM-6 后端轴命中；转 enforce 属改谁来守门，留给人工裁决）；旧载体不再增长 ⇒ "顶部"这个概念测量对象消失，而非把判据降级成约定。缺行/矛盾另有 `missingRecordRows`、`statusContradictions` 两条在拦截面上兜记录文件源
- 静态门禁按 **CI 点名的原样路径**逐个跑过（不是按目录猜）：`check-unwired-tests`(88 个测试文件) / `check-no-brand-residue`(9254 个受管文件) / `check-no-conflict-markers` / `check-record-qm5-rows` / `check-spec-purpose`(153 份主规格) / `check-step-failfast`(35 个多命令步骤) / `check-changelog-growth` / `check-changelog-duplicate-entries` / `check-text-encoding-integrity` / `check-renderer-cjs-boundary` / `check-visual-coverage` / `check-gate4-selection` / `.github/scripts/check-workflow-structure` / `.github/scripts/check-ps1-bom` 均 rc=0；`check-baseline-freshness` / `check-clock-shift-oracle` / `check-desktop-shard-forwarding` 本机不可复现，点名交给 CI（不得当成通过）
- **`check-doc-abs-paths` 本机 rc=1，不认领，附对照证据**：它报「超出存量基线 15 个文件」，15 个全是他人文件（`01-docs/DEEP-ANALYSIS-KNOWLEDGE-BASE.md`、`openspec/records/blanket-fs-mock-ratchet.md` 等），我的 13 个改动文件 0 命中。对照：把 diff 取成空（`--base=origin/main --head=origin/main`，扫 435 个文件）报的是**同样那 15 个**、同样是 103 个待收紧 ⇒ 与本 PR 无关。维度在该判据把「绝对路径在磁盘上是否存在」算进计数，本机 worktree 清单位与 runner 不同（如 `D:\Data\projects\mp-worktrees\mp-fix-newtab-home-slow` 在我机器上不存在）——属本机不可复现那一档：不代他人收口，也**不得**为让它变绿去动它的基线

### QM-6 评审处置（后端轴交付 14 条，逐条先取证再处置）

| 评审条目 | 处置 | 取证 / 落点 |
| --- | --- | --- |
| ①W1 基线只对分支成立，origin/main 已到 607 | **采纳并已修** | 实测 `git show origin/main:.quality-gates.md` 与 `\| grep -c "^## "` = 607，基线是 605 ⇒ 第二次 rebase 后 CLI 当场 rc=1，人工重取到 607/`636b6e82cdf8…`（tasks 1.1 演进链 603→605→607） |
| ①W2 `loadCarrierFreeze` 不校验基线自身一致性 | **采纳并已修** | 新增校验（`headings` 一旦出现必须是数组且长度 == `headingCount`；缺席仍允许，夹具就这么用）+ 用例「冻结基线自身不一致…」，其中带**正控**（合法基线必须读得出来，否则三条负控只是"任何文件都抛错"的同形红）；变异 N4 把校验改成恒不触发 ⇒ 该用例指名变红、还原 md5 一致 |
| ①I3 标题集合口径不区分「记录块」与「结构性章节标题」 | **采纳为已承认的残余，不修** | 绕过需刻意把整块记录挪进 `## 固定强制门禁` 一类标题下且不改文字。已写进 proposal 残留风险 ①b；判据与规格措辞保持"标题集合"，**不假装它量的是记录块** |
| ①I4 条数与 sha256 两级带宽各漏什么 | **不修（评审自己已判非漏洞）** | 评审原文即写"sha 是冗余带宽而非漏洞"；无行动 |
| ② 就地关账通道是否被误拦 | **评审独立复算通过，无需行动** | `carrierSignature` 只吃 `## ` 标题集合、不读状态行 ⇒ `PENDING→PASS` 不触发漂移；另有正向用例钉住 |
| ③W1 `check-pr-exec-record.js` 在 CI 是 `--mode=advisory` ⇒「整篇记录缺席」无人拦 | **升级为人工决策，不自作主张** | 实测 `quality-gate.yml:139` 确为 `--mode=advisory`。**我先前那句"两条仍在拦截面上"对它不成立**，已改写成本节这条。转 enforce 属"改谁来守门"（会让每个缺记录的 open PR 当场红），不夹带进本 PR |
| ③I3 退役规则的可见项"既不打印也不算" | **否证** | `check-gate-record-debt.js:505-506` 就是 `if (r.topRecordMissingRow && r.topRecord) out.push('（可见项，不拦截：…）')`——**条件打印**；本轮真仓顶部记录带行所以不出现。用例「不得再打 `❌ 最顶部`」与「必须可见」两条都在跑 |
| ④W1 delta 里仍写"可就地编辑 …… `.quality-gates.md`" | **采纳（加交叉引用）** | delta 的 THEN 句补一句"就地编辑的**许可** ≠ 往旧载体**新增**记录块"；`openspec/specs/**` 基线同步仍按 tasks 2.2/2.3 留给归档 |
| ④W2「变更集实际含旧载体，示范自证必败」 | **采纳其观察、否证其结论** | 现象为真但 base 站错：main 前进后 `git diff origin/main..HEAD` 会把**主干自己的新增行**显示成本分支的差异。正解取 merge-base——实测 `git diff --name-only $(git merge-base origin/main HEAD) HEAD` 对这两个文件 **0 命中**。已把记录里的自证命令改成 merge-base 形态，免得下一个会话复现出假阳并据此判本 PR 违约 |
| ④I「AGENTS.md 把 25 条写死成常数」 | **采纳** | 改成"现读数以 `scripts/gate-record-debt-ledger.json` 键数为准（本轮实测 25）"——这个数会随每次关账收缩，写死就是给下一个人留假数 |

- 后端轴首跑交付物是一行 `API Error: 503 system cpu overloaded` 而 rc=0，属"跑完但零交付"；重跑交付 14 条，上表逐条**先取证后处置**。
- 前端轴三次真跑 rc 均 0、均只回过程快照（零 findings 交付），按规格计入跳过。**所以双模型里前端这一路没有结论，本 PR 不声称 QM-6 全绿。**


- **第四次基线重取（回填时当场）**：合并落主干后，main 的记录块集合已从基线 607 涨到 613；差集实测 `removed=0 / added=6`（6 块全是冻结落地前按旧惯例插入的上游 PR：`podcast-voice-source-spec`、`podcast-compliance-badge`、`fix-worktree-remove-dirty-gate`、`fix-article-paragraph-*`、`tech-debt-dep-audit-alias`、`dev-http-cache-guard`）⇒ 人工重取 `613 / 27eebfa9ff6c…`，重取后 CLI rc=0、测试 58/58。**这条红不是回归，是判据第一次在 main 档真实生效**。
- **合并前 CI 的两条 desktop 红（归因写在这里，免得下一个会话重新猜）**：attempt 1 里 `QG Desktop Shards (2/2)` 报 `local-cover-generator.test.js:37` 60s 超时（本仓已记录该形态见 `01-docs/PRD.md:19414`「sharp 原生模块 CI 首载超时」）、`QG Coverage` 报 `windows-file-lock.test.js` 两条「真跑（仅 Windows）」红。三条证据判它非本 PR 引入：本 PR 净变更集含 `apps/desktop/**` 文件数 = 0；两条都属文档明列的运行态敏感族；只重跑失败 job 后同轮全绿（同期 #3675/#3676 一直绿，所以也**不能**说成"仓库常量红"——这一点我一开始判错过一次，被重跑结果纠正）。
- **QM-6 后端轴对最终状态的复审在合并时才刚起跑**（不是跑完）：最后两笔实现（分档 + 基线一致性）晚于上一轮 14 条评审，用户授权合并在先。结论到达后逐条处置并入本文件，不拿旧结论冒充新复审。

### 示范自证（本 PR 必须自己守自己提的规矩）

判据 `carrierDrift` 生效时，`.quality-gates.md` 有 613 个记录块（读数演进 **603 → 605 → 607 → 613**：每次主干前进后判据当场报红、由人工重取；见 tasks 1.1 与本文件「QM-6 评审处置」①W1）。本 PR **刻意不碰它**：若本 PR 按旧惯例往顶部插一块，就会立刻被自己刚加的判据判红。合并前用一条命令自证：

```
MB=$(git merge-base origin/main HEAD); git diff --name-only "$MB" HEAD | grep -E '^(\.quality-gates\.md|scripts/gate-record-debt-ledger\.json)$'
```

期望输出为空。**base 必须取 merge-base，不能取 `origin/main..HEAD` 那种两点式**：主干一旦前进，两点式会把主干自己新增的行显示成本分支的差异，读起来像"本 PR 违背了自己的规矩"（QM-6 后端轴就这么误判过一次，本条命令已按实测改正）。这条同时是 tasks 2.4 的证据。

### 遗留（不假装已闭合）

- **分档代价要写清**：冻结的状态相等判据只在 **main 档**拦。PR 档它拦不住（合并预览必然含上游新增块），所以"本 PR 没往旧载体加/删块"这条在 PR 侧靠 `check-pr-exec-record.js` 的 `载体M`，而**那条目前是 advisory**（见「QM-6 评审处置」③W1）⇒ 转 enforce 与否是本 PR 留给人工的第四条。
- 主规格尚未同步：`openspec/specs/openspec-integration/spec.md:123/:131` 仍写着"可就地编辑 …… `.quality-gates.md`"，要等本 change 归档时才落基线（tasks 2.2/2.3 未勾）。在归档前，判据比规范严——这是安全方向（判据拦住、规范滞后），但必须留痕，否则下一个会话会拿规范当豁免理由。
- 归档顺序与 `hot-carrier-atomic-landing` 冲突：两条 delta 都 MODIFY 同一个 requirement，本 change 应先归档，另一条再按新基线重述（已在 delta 里写明）。
- (1) 事后测量（守卫侧开窗/收窗读数）未实现 ⇒ 当前只有"拦住"，没有"是否还有人试图改"的读数（tasks 3.2）。
- **本机钩子会改写主干上已存在的同名判定产物**（2026-10-15 rebase 时实测）：pre-commit 的 `ccg-gate.js` 把这次 DUAL 判定写进 `.ccg/reviews/<提交前 HEAD 的父 SHA>.json`，而该路径在 origin/main 上已由 #3649 落过一份（记的是别人的 `mode: skip`）。rebase 表现为 **add/add 冲突**（不是静默改写——因为我的基线早于那份提交），正解取主干那份（`git checkout --ours`），md5 与主干逐字节相同、PR 净 diff 不含该路径。**不得**用自己这次的判定覆盖他人历史判定。
- **一处潜在的写面复活源（本 PR 未拦、也未修）**：`.quality-rhythm/installer/husky/pre-commit.js:56` 带 `gatesFile: ".quality-gates.md"` + `recordMarker: "## 本次执行记录"`，即那份 vendored 安装器一旦在别处被真的装进钩子，就会自动往旧载体插块 ⇒ 立刻被本判据判红。当前**不在活动路径**：已安装的 `.git/hooks/pre-commit` 是 `scripts/hooks/pre-commit`（bash 版，不写旧载体），全仓对那份 JS 的引用只有 `scripts/ccg-gate.js:9` 的一句注释（"门禁力度与之保持一致"），不执行它。留待有人真要去装 husky 钩子时再收口——届时正确动作是改那份 installer 的落点，不是放宽冻结判据。
- 25 条历史欠账仍需各自会话关闭，本 PR 不代改他人记录。

