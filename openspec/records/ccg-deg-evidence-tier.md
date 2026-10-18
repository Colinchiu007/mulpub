---
record: ccg-deg-evidence-tier
task: QM-6 降级梯 切片B预备——用主干普查否证「按 performedBy 前缀分级」，把 tier 改成结构化字段并入库普查工具
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按「PR 自动合并」收尾清单 1–4 条回填，并整段删除本三个 sync_* 字段）
---

## 本次执行记录：证据分级的判据落点更正（ccg-deg-evidence-tier，2026-10-17）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-ccg-review-degradation`，裸分支 `ccg-deg-evidence-tier`（**叠加在 #3777 之上**，同一文件 `check-pr-exec-record.js` 不能并行改）。Step ⓪ 守卫：`pre-code-edit-guard.ps1` 在本 worktree 内未阻断（共享根才拒）。内容＝规格更正 + 普查工具入库 + `.gitignore` negation，**未动任何判据代码** |
| 判定（docs-only） | **false（不走快速通道）** | commit 后实测：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false files=14`（写在 #3777 首次推送后的基线上）→ **rebase 两轮后在 `1291614ff` 重取为 `docs-only=false files=21`**。成因不是本片自己——它叠在**未合并的 #3777** 之上，变更集含 #3777 的代码提交与 5 份 CCG 判定产物。本行初稿写的是 PENDING 并预期走 docs-only 快速通道，与实测相反 ⇒ 按事实改登记：**本分支不借快速通道豁免任何门禁**。待 #3777 合并后 rebase 到主干，本判据应重取一次（届时若转 true，说明叠加已解除，届时读数另记） |
| 第一性原因（QM-5 ①） | PASS | 规格里我原先写的分级判据是 `(status, performedBy)` 二元组、按 `self-play` 前缀分档。引入点＝我自己 2026-10-17 写的 `openspec/changes/ccg-review-degradation-ladder/design.md` §1——**错因不是抄错代码，是没普查就用**：动手前我只读了 decider 的初始化（`performedBy: null`）就假设它是枚举 |
| 逃逸分析（QM-5 ②） | PASS | 单元/集成/视觉层无关（这是规格判据）。逃逸在规格审查层：`design.md` 的 §1 当时读起来"有实测出处（`:444`/`:312-313`）"因而显得可信——**引用两处行号不等于量过全量分布**，而前缀判据的失败恰好只在分布里才看得见（`null` ×744 谁都过，问题在那 12 条散文） |
| 修复 + 回归保护（QM-5 ④） | PASS | ① `spec.md` 的判据句改写：`tier` 必须是**结构化来源字段**，MUST NOT 从 `performedBy` 自由文本推断，佐证复用既有口径「`findings` 是非空数组」（`shouldPreserveClosedRecord` 主判据同源，不造第二套词汇）。② `design.md` 新增 §9/§9.0，把普查数字与两条更硬的现场（12 条 self-play 开头却声明外部复核；`cleared`/`needs_revision` 配 `pb=null f=null` 的零出处闭环）写进去。③ 普查工具**入库** `scripts/ccg-artifact-shape-survey.js` + `.gitignore` 补 `!scripts/…` negation（实测 `check-ignore` 现命中 negation 行 117）⇒ 覆盖面数字可在仓库内一句话重取，不留孤立读数。④ `tasks.md` 1.1 改为 **blocked on decision**，并新增 1.0 已勾项 |
| 防止再次发生（QM-5 ⑤） | PENDING | 待 §9.1 合同裁决后落机械锁：`tier` 的闭集校验 + 覆盖率**可见不拦**先行、转拦需覆盖率读数（主干 `dual+pending` 存量 220 条，直接转拦＝一上线红两百条，正是该文件头部 forward-only 注释点名的失败形态）。本条不留成口号：判据与反证已写进 tasks 1.1/1.2 |
| 行尾与 diff 对账 | PASS | commit 后实测：`git diff --numstat <merge-base> HEAD` 与 `--ignore-cr-at-eol --numstat` **两口径逐文件同数**（merge-base `72a8639cd`）。既有文件为 CRLF 工作副本 / LF blob（`i/lf w/crlf attr/text=auto`）；新入库脚本 `scripts/ccg-artifact-shape-survey.js` 与本记录以 LF 写入，`.gitignore` 的 negation 按原档**单行插入**（不整份回写，避免幽灵改动） |
| 接线棘轮 | PENDING | 新增 `scripts/ccg-artifact-shape-survey.js`（非 `*.test.js`，不被 `check-unwired-tests.js` 收）⇒ 是否接进 CI 属"要不要每次跑"的预算决定，当前只在被引用时现跑；登记为待裁决，不假装它已被守 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与渲染层 |
| QM-6 CCG 双模型外部评审 | 未执行（如实登记，不借用他人交付） | 本片**不改任何判据代码**（只改规格 + 入库普查工具），但 `docs-only=false` ⇒ 不援引「纯文档豁免」。也不把 #3777 的后端单轴交付算成本片证据——两片的评审产物不互相顶替（同 [[review-artifact-parent-sha-vs-branch-scope]]）。真正的 QM-6 义务落在下一步「转拦」那一片：它改 required check 的判定面，必须外部评审 + 人工过目，且**不得以 `self-play` 收口**（自反条款） |
| 记录欠账 | PENDING | commit 后跑 `check-gate-record-debt.js` / `check-record-qm5-rows.js` / `check-pr-exec-record.js --mode=enforce` / `openspec validate --strict` 并补读数 |
| 远程同步 | PENDING | 合并后取 merge SHA 与 `(merge SHA, workflow)` 的 main push 读数（纯规格/工具改动预计 `NO_RUN(by design)`，须如实记而非当免检），同次删除本三字段 |

- 保留门禁：判定 docs-only **false（叠加所致）** ✅ | 行尾对账 ✅（两口径逐文件同数） | 品牌残留 ✅（9650 个 tracked 文件，计数随每笔提交自增故不作现状引用） | 文档同步 ✅（`openspec validate ccg-review-degradation-ladder --strict` = valid；`check-pr-exec-record --mode=enforce` OK：21 文件（构成 = 本片真实改动 + 未合并的 #3777 代码提交 + 各笔提交的 CCG 判定产物，产物数按笔数自增故不写死）、新增记录 2 篇） | 记录欠账 ✅（debt rc=0、qm5-rows rc=0） | QM-6 未执行（不豁免、不顶替）| 远程同步 PENDING

### 待你裁决（本片的唯一阻塞点）

`design.md` §9.1 三个候选合同，差别在「外部证据由谁声明、拿什么佐证」：甲=结构化 `tier`+`evidence`（自报路径，只验存在）；乙=只认 `findings` 非空数组（内容判据，但**干净通过的外部评审往往 findings 为空**，误红面需估算）；**丙（我的倾向）= 甲乙合取且只对新记录生效**，`tier=external` 必须带 `evidence`，`findings` 为空时不拦只点名（"无发现"是合法结论，"没跑"不是）。选错方向的代价不对称：选窄了会把真评审判成没评审（误红，逼人绕），选宽了就还是装饰（假绿）。

### 遗留（不假装已闭合）

- 普查工具未接进任何 CI job，数字要靠人现跑；是否值得每次跑（约 800 份 `git show`，本机能跑完）待裁决。
- §9.0 那条"闭环可以零出处"在裁决前不会有任何机械拦截——它现在只是**被记录下来了**，这一点必须说明白，否则下一个人会以为已经有人在看。

## 切片B 实现补记：`tier` 结构化字段 + 覆盖率可见不拦（2026-10-17，同分支后续提交）

| 项 | 读数 |
|---|---|
| 落码 | `ccg-review-decider.js`：`buildDeepReviewInit(mode)` 导出并在 `saveRecord` 里替换手写字面量（新记录天生带 `tier:"unknown"` / `evidence:null`）；`check-pr-exec-record.js`：`classifyEvidenceTier` / `summarizeTierCoverage` / `dualClosedDeepReviews` + `main` 打印 `TIER-COVERAGE` 行 |
| 外部档成立条件 | `tier==='external'` **合取** `evidence` 为非空字符串（`typeof==='string'` 且 `trim()!==''`）；只声明不附证据 ⇒ `external-unverified`，不享受外部放行 |
| 不读散文 | `performedBy` 完全不进判据；取值不在闭集 / 带前后空格 / 大小写不符一律 `unknown`（fail-closed，与「状态列只认闭合词表」同口径） |
| 测试 | 两文件合计 **108 passed / 0 failed**（gate 70、decider 38）；新用例含真跑 CLI 的行为锁（临时 git 仓库 + `--no-remote`，断言 `rc=0` 且 stdout 含 `TIER-COVERAGE`） |
| 变异 | 本片 5 条（M-T1 摘 tier 初始化 / M-T2 放宽闭集 / M-T3 evidence 判据退化 / M-T4 空集不打印 / M-T5 接入拦截）全部指名红；与切片A 合计 **12/12 CAUGHT、escaped=0、anchorfail=0**、每条还原 md5 一致 |
| 现场读数 | 本分支实跑 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` ⇒ `TIER-COVERAGE dual-closed total=0 …`（**0 是诚实值**：本分支的判定产物都是 `single`/`skip`，再次印证已知缺口「真缺口在被判 single 的产物」） |
| 未做（不假装） | 转拦（`unknown` 占比到阈值后让门禁生效）另起一片；高危面清单与 `HIGH_RISK_SURFACES` 机械实现、`backendAvailability` 落盘、`fallback_closed` 欠账棘轮（tasks 2.x/3.x/5.x）仍未开始 |

- 一条同族小缺陷登记（未夹带修）：`check-pr-exec-record.js` 的参数解析只认 `--repo=<dir>`，写成 `--repo <dir>` 会得到 `args.repo===true` 并抛出 `options.cwd ... type boolean (true)`，报错文案是「git 取证失败」——与 AGENTS.md 已点名的「`--limit 4` 被静默丢弃」同型。本片实测踩到（我的夹具先写错形式），修法应是未知/裸旗标一律非零码出声，另起一片。

## 切片C 实现补记：降级资格以物证为准（tasks 3.x，2026-10-17 同分支后续提交）

| 项 | 读数 |
|---|---|
| 落码 | `summarizeBackendAvailability(backends)` 纯函数（`count` 0/1/2 + `partial` + `wrapperReady` + 原样 `backends`）；`saveRecord` 第 5 参数可注入、缺省自探；`main` 把**判定时那一份** `backends` 传下去（不传则第二次探测与判定现场不是同一份） |
| 为什么现在做 | `detectBackends()`（`:641`）一直在算 `{wrapperExists, claude, opencode}` 却从不落盘 ⇒ 「CLI 不可用」只能靠自述。规格里 D6 的落点就是把这份现场钉进产物 |
| 测试 | `ccg-review-decider.test.js` **42 passed / 0 failed**（新增 4 条）；与 gate 侧合计 **112 passed**（旧基线 `72a8639cd`）→ **113 passed / 0 failed**（最终基线 `1291614ff` 重跑：gate 侧 71、decider 侧 42）。增量 1 条来自 main 侧 #3792 新增的派生锁用例，**不是**本片新增用例 |
| 变异 | 本片 4 条 M-B1…M-B4 全部指名红，`escaped=0 anchorfail=0`，逐条还原 md5 一致；累计 16 条（切片A 7 + B 5 + C 4）|
| 反真空留痕 | 丙3.3 断言默认路径等于**当场再探测一次**的结果，并打印现场：本轮 `count=2 wrapperReady=true claude=true opencode=true`。为什么必须打印：若某台机器两个后端都没装，该断言两边同为全 false ⇒ 恒真，锁会变真空 —— 打印是为了让读者看见它这一趟到底测到了什么 |
| 明确未做 | **3.2 判据侧尚未消费 `backendAvailability`**：目前它只是被记录，不构成降级资格判据。落盘≠接线到判据，这一格留给高危面矩阵那片（tasks 2.x）一起落。3.5 失败形态三档分档同样未做 |

- 一条同族小缺陷仍挂账未修：`check-pr-exec-record.js` 的参数解析只认 `--repo=<dir>`，写成 `--repo <dir>` 会得到 `args.repo===true` 并抛「git 取证失败（…options.cwd…type boolean (true)）」——与 AGENTS.md 点名的「`--limit 4` 被静默丢弃」同型；本片夹具踩过一次，改的是**夹具**不是判据。

## 追加一格：高危轴取证（design §9.2），并把读数搬进入库工具

- 动机：tasks 2.x 要把「高危面」实现成判据。先量了主干产物的两个候选字段，结论是**都不能直接当 §3 的实现**——`stats.sensitivePathHits` 非空仅 **2/877**（构造性零，用它当判据等于 `self-play` 在几乎所有产物上都能闭环），`sensitiveContentHits` 非空 **217/877** 会真触发，但它答的是「改了加密内容」而不是「改了守门人」，两条轴合成一条就会互相遮蔽。落点：清单由判据对 `changedFileStatuses` **现算**，内容命中轴只作旁证出声。
- **读数不再是我在会话里报的一次性数字**：把这三条读数做进入库普查工具 `scripts/ccg-artifact-shape-survey.js`（新增高危轴分布 + 三条结论锚点 + tier 缺席计数），任何会话一句话 `node scripts/ccg-artifact-shape-survey.js` 可重取。当场实跑输出：`pathHits 非空=2/877  contentHits 非空=217/877  content 最大值=217`、`deepReview.tier 缺席=877/877`。
- 顺带证实丙的前提：`tier` 在 877 份历史产物里**全部缺席** ⇒ 结构化分级只能对新记录生效，历史无源可回填；覆盖率棘轮的起点必须是「当前 dual 未闭环数」而不是「有 tier 的记录数」。
- 踩到并修掉的一条自家陷阱：追加脚本的**分隔空行**没补 CR ⇒ 两个文件各出 1 条裸 LF（`loneLF=1`）。先定位到「不接 CR 的行」逐条核是我的插入行还是他人既有混行尾（本仓这些文档历史上就是混行尾，禁止"探测多数派后统一回写"），确认是自己的产物才补 CR。修后 `loneLF=0 dblCR=0`，两口径 numstat 逐文件同数（design 12/0、tasks 1/0、工具 12/1）。
- `openspec validate ccg-review-degradation-ladder --strict` = valid；`check-no-brand-residue` PASS；受管文档内**未新增任何本机绝对路径**（取证命令一律写成仓内可重取的形式）。


## QM-6 两轴交付与逐条处置（2026-10-17，本分支 tip `0cff41eec` 为被评审树）

**先记一条通道事实，否则下一个会话会把这份交付读成"自扮演"**：同一提示词经 `codeagent-wrapper` 派发 **5 次全部 rc=0、载荷里零 findings**（后端两次交回"我输出了 8 条数组"的散文、`grep severity` 唯一命中是头部 `Command:` 行里我自己写的提示词；前端三次交回 Work State 快照）。**绕开 wrapper 直呼 CLI** 后两轴都拿到可 `JSON.parse` 的数组 ⇒ 根因是 **wrapper 丢载荷，不是模型没产出**。后端 `claude` 8 条、前端 `opencode` 7 条（session `ses_eb6c3040dffeD2qBGFR70X0QGc`），字段形状 `{severity,file,issue,fix}`。

| # | 轴/级别 | 判据 | 处置 |
|---|---|---|---|
| B0 | 后端 Critical：伪造 `cleared` 被判已闭环 | **成立**——我先用独立探针量到同一现场（四种伪造全部 `reasons=0/checked=1`，含 `evidence:"x"` 判 external） | 可判的一半本轮落：A/M 产物解析不动即点名（N1）。**「凭空新增一条 A 状态且 status=cleared」在判据层不可判**（除自述外无任何对象可核），正解是把「谁有权写闭环值」收到工具侧 + 事后抽查，已登记 tasks 5.x，不假装这条已闭合 |
| B1 | 后端 Critical：`evidence` 非空即判 external | **成立**（`x` 通过） | 已修：`isResolvableEvidence` 只认 `#<≥3 位数字>` / `ses_…` / uuid / 40hex / 带扩展名的日志路径；不认则降 `external-unverified`。变异 N3 指名红 |
| B2 | 后端 Warning：D 方向 base 解析失败静默 | **成立**（`catch { continue }` 既不计 `unreadable` 也不计 `removedUnclosed`） | 已修：计入 `unreadable` 并带后缀「base 内容解析不动」，与"读不到"区分。变异 N2 指名红 |
| B3 | 后端 Warning：覆盖率统计静默剔除损坏项 ⇒ 虚低 | **内核成立、修法不采纳**（同一文件已被 B1 的出声点名，再加一个计数是重复信号） | 落 N1 的出声即闭合归因；`corrupt=N` 独立计数登记遗留，不做 |
| B4 | 后端 Warning：`required` 未被消费 | **拒绝修法，采纳观察**：把 `required` 纳入判据会让「引擎对 mode≠skip 一律置 true」的既有形态变成**永久不可闭环**（与缺陷G 同一形态）；已按「只查 dual」收口 | 记此明说不重复讨论 |
| B5 | 后端 Info：`summarizeTierCoverage` 空集不出声 | **否证**：空集打印 `total=0`，且既有用例断言行内含 `total=0`（"没接锁"与"接了但没记录"可区分） | 无需动作 |
| B6 | 后端 Info：`performedBy`/`findings` 无消费方 | **否证**：`findings` 被 `shouldPreserveClosedRecord`（decider:468）消费，`performedBy` 被普查工具消费——后者正是「前缀分级不可用」那条结论的证据来源 | 无需动作 |
| F0 | 前端 Critical：alt 时间戳形态 | **成立且后果比命中本身更硬**：实测主干真件 `-again-<40hex>-2026-10-17T025039620Z` 对 `AUDIT_ARTIFACT_RE` **返回 false**，而判据期望 `20261017T091333.123Z` ⇒ alt 产物从未参与欠账判定 | 最初按"改生产者"方向落了一版，rebase 时发现**上游 #3906 已按另一方向修**（放宽扫描域去接真实投影，覆盖面更大：它同时认主干已存的那个 dashed 真件）⇒ **撤回生产者改动**，只保留**跨模块命名对齐锁**（拿真实产物名问 `AUDIT_ARTIFACT_RE`，而 #3906 自己的锁是在测试里重算投影、永远不会发现生产者变了）；那条把旧写法钉成受保护形态的结构锁改写成"只锁字面写法，同源性由命名对齐锁判"。变异 N5b（摘掉扫描域 dashed 分支）指名红，证明这把锁不是装饰。详见本节末「与上游 #3906 撞车后的收敛」 |
| F1 | 前端 Warning：`tier` 恒 unknown、无生产者升级路径 | **成立**，登记 tasks 5.x：闭环值应由 `deep-review` 交付时写入，而不是会话手工改 JSON。本分支这条 13049a50 的收口正是**先真跑了评审再改**（范围覆盖：评审对象含该提交全部内容），不是绕过 |
| F2 | 前端 Warning：`backendAvailability` 零消费 | **成立**，且正是 tasks 3.2 明文未做的那一格（不认领为新缺陷）；下一个消费者就是 tasks 2.x 的收口矩阵 |
| F3 | 前端 Warning：闭环集合「三份真源」 | **核实为两份定义 + 一把 parity 锁**（`ccg-review-decider.test.js:679-682` 解析对方源码并 `sort()` 后 deep-equal）——这是仓内既有的「不能互相 require 就各存一份 + parity 锁」形态 | 拒绝合并修法（单向 require 会把 gate 依赖拉进 pre-commit 钩子链）；观察记此 |
| F4 | 前端 Info：`main()` 不处理 `saveRecord` 的 null 返回 ⇒ 裸栈 | **成立**（报错文本已先打印，属 fail-loud 不是假绿，但退出码与副作用不一致） | 登记不夹带（本片已含 5 处修复，Info 级另片） |
| F5 | 前端 Info：普查工具无 `require.main` 守卫、`parseFail` 混计两种语义 | **成立**，与我自己的现场一致（早前我把「读不到 ref 上的文件」和「读到但解析失败」混成一个数，导致 json=0 被读成探针失明） | 登记 tasks |

**新增锁与反证**：`check-pr-exec-record.test.js` **74 passed / 0 failed**（新增 3 条，改 1 条老契约），`ccg-review-decider.test.js` **44 passed / 0 failed**（新增 2 条，改 1 条结构锁）；变异 **N1–N5 全部 CAUGHT、各自指名红**、`escaped=0 anchorfail=0`、每条还原后与变异前 md5 一致。
**一处流程自纠**：这批锁**没有先见证红**（代码先行），补偿证据是 N1–N5 五条对判据本体的变异——摘掉守卫必须变红才算锁在住；把这点写出来是因为「TDD 两段实跑」的措辞如果照抄上一片，就成了没做却声称。


## 与上游 #3906 撞车后的收敛（2026-10-17 rebase 到 `origin/main` 时发现）

- 前端 F0（alt 命名与扫描域不同源）**上游已独立修掉**：`7ac37d016`（#3906）把 `AUDIT_ARTIFACT_RE` 的 alt 段放宽成同时接受紧凑式与 `\d{4}-\d{2}-\d{2}T\d{9}Z`，方向是**放宽扫描域去接生产方真实投影**。我这边原先选的是另一头（改生产者成紧凑式），两条路并存会让 #3906 那条「投影现算」的锁与真实生产者**再次不同源**——正是它要消灭的形状。
- 处置：**撤回生产者改动**（`ccg-review-decider.js` 的 alt 时间戳回到 `[:.]`），保留我那把**跨模块命名对齐锁**——它拿真实产物名去问 `AUDIT_ARTIFACT_RE`，比"在测试里自己重算一遍投影"强：重算的那份永远不会发现生产者变了。结构锁文案同步改成"本条只锁字面写法，同源性由命名对齐锁判"。
- 时间线（既不把别人的成果认领成自己的，也不把一次合规操作读成无视新规）：我的回填 PR #3826 合并于 **17:56 +08:00**，取消回填链路的 #3879 合并于 **21:43 +08:00**（`b49510794`）⇒ 回填当时仍是现行 SOP，不是明知故犯；自本分支起不再开回填 PR，收口由 merge-ledger 推导。本分支记录仍带 `sync_*` 与 `PENDING` 行，属**存量旧行**，`check-gate-record-debt.js` 在含 #3879 的基线上实测 rc=0（未报登记字段残留）。
- rebase 跨了 **104 笔**主干推进：唯一冲突在 `check-pr-exec-record.test.js` 的尾部插入点，两侧各自以 `})` 闭合 ⇒ 只删三行标记、两侧块都保留（`刀A §7.4-A/B` 与 `丙 …` 均可 grep 到）。
- **用例归属实测**（剥 CR 后按名比对，第一版探针没剥 CR，把 68×76 全判成"两侧互斥"＝探针失明）：`origin/main` 侧 **68** 条 test，本分支 **76** 条；只在 main 侧出现的 **1** 条 = 我有意改名的旧契约（`缺陷D：损坏的 JSON 记录不抛异常（由别的门禁负责）` → `…，但必须点名出声（实测没有任何别的门禁在校验它可解析）`）；只在本分支出现的 **9** 条 = 那 1 条改名后的新版 + 5 条丙分级用例 + 3 条本轮命中锁。⇒ **main 侧一条测试都没被丢掉**，#3906 新增的两条形态用例在本分支照样在跑。
- rebase 后重测：gate **76 passed / 0 failed**、decider **44 passed / 0 failed**；变异反证重跑：N1–N4 仍各指名红、**N5 随生产者撤回而撤销**（它锁的正是我撤回的那处改动，留着就是锁一个已不存在的方向）；另加 **N5b**——把扫描域的 dashed alt 分支摘掉，命名锁必须红。实跑结果 **5/5 CAUGHT、`escaped=0 anchorfail=0`、还原 md5 一致**，这条同时证明保留下来的命名锁不是装饰（它真在问生产方的投影，而不是复述一遍判据）。


## 第二轮 rebase（→ `d65f0b76f`）：与 #3927 撞在同一批文件上，现值重取

- **为什么必然冲突**：main 合了 `d65f0b76f`（#3927，change `qm6-review-backend-config`）——把 QM-6 评审后端对收敛成单一真源 `scripts/ccg-review-backends.list`，并把判定请求写进产物的新字段 `reviewBackends`，由 `check-pr-exec-record.js` 与驱动回填的 `deepReview.performedBy` 对账，**不符即判不闭合**。它改的正是我这条线在改的两个文件。4 个文件各出 1–2 处冲突，形态两种，处置不同：
  1. **`module.exports` 行两侧各写子集** ⇒ 按键拆并集（合并后 22 键，我方仅多出 `isResolvableEvidence`），不是整行取一侧。
  2. **两侧在同一位置各插字段 / 各插 reasons 块**：`decider` 里保留 #3927 的 `reviewBackends: RB.resolveBackends()` **同时**用我方的 `buildDeepReviewInit(result.mode)` 承载 `tier/evidence`（若取 HEAD 的内联对象，新字段会在下一次被漏掉——这正是那条锁的理由）；`gate` 里 `backendMismatch` 与 `unparsed` 两块**都要**，但冲突区尾部那两行 `    )` / `  }` 是**共享尾行**，所以把 `=======` 换成 `    )` + `  }` 而不是删标记（删了就是少一层闭合，肉眼看不出，`node --check` 当场报）。
- **现值（在 `d65f0b76f` 基线重跑，不是引用旧数）**：`check-pr-exec-record.test.js` **76 → 81 passed / 0 failed**、`ccg-review-decider.test.js` **44 → 51 / 0**、qm5-rows **19 / 0**、classify-docs-only **27 / 0**。增量来自 #3927 自己新增的用例，不是本片新增。
- **变异反证重跑 12 条、全部指名红、`escaped=0 anchorfail=0`、还原 md5 一致**：本片 5 条（N1 损坏静默 / N2 D 方向静默 / N3 evidence 非空即可 / N4 摘 `unreadablePrev` / N5b 摘 dashed 分支）+ **已合入主干的切片A 7 条（M-A…M-G）也重跑了一遍**——因为我这次编辑的正是切片A 那同一个函数，不重跑就不知道有没有把上游的锁拆掉（M-A 红集=9 里指名 1 条，其余是邻近用例被连带，仍按「指名」口径单独计）。
- **一条不能混着报的读数**：`enforce` 对本分支打 OK，但 **#3927 的新对账对本片产物是「不适用」而不是「通过」**——`judgeBackendMismatch` 在 `reviewBackends` 缺席时 `return null`，而变更集里两条产物（`13049a50`、`c0b69a3f`）都由 #3927 落地前的 decider 写出，**没有这个字段**。所以「后端对账绿」这句话在本片没有证据支撑；它从下一次提交起才开始积累（本分支的 decider 现在两个字段都写）。
- 行尾与 diff：两口径 numstat 逐文件同数（19 个文件全等），解冲突未改写行尾（`loneLF=0 dblCR=0`）。

