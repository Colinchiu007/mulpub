# 设计：把「远程同步」收口判据从人工断言改为 git 现场推导

本文件是评审对象。每条决策都带**实测证据出处**与**被否证的替代方案**；没做对照实验的推断一律写在「未闭合风险」里，不混进决策正文。

## 0. 取证基线（所有数字的时点）

- worktree base：`origin/main` tip `44054389e`（测量期间 main 仍在前移，见 D9 的"活数"口径）。
- 真门禁改前权威读数：`node scripts/check-gate-record-debt.js` ⇒ **rc=0 / OK**，打印 `远程同步行 400 条 / 执行记录 605 篇 / 已登记欠账 23 条 / 记录文件 405 篇`，可见项 `213 篇旧载体执行记录整块没有 远程同步 行`、`跨源比对现场：配对 131 组 / 违例 0 / 承认 1`。
- 派生前置可行性探针：一次 `git log origin/main --diff-filter=A --name-only --no-renames --format=%H<TAB>%cI<TAB>%s` 扫 17217 行，**407/407 篇记录文件都能唯一解析到"哪次提交把它加进 main"**，歧义 0；端到端 **1.03 秒**（两次 git 调用 727ms）。
- 合并账本规模：origin/main 5202 个提交里可解析 **1926 个已合并 PR** 的 squash 尾注 `(#NNNN)$`，同尾注重复命中 4 次。
- 门禁域（本轮核实，非推断）：`scripts/check-gate-record-debt.js:165-179` 的 `listRecordFiles` 是**非递归** `readdirSync` + `isFile() && endsWith('.md') && !name.startsWith('_')`。⇒ `openspec/records/_exempt/` 因是**目录**被排除，`_TEMPLATE.md` 因下划线前缀被排除。本设计改前用了 `git ls-tree -r` + 只看 basename 的自建过滤，误把 `_exempt/backfill-2939-record.md` 读成"1 篇缺行"，真门禁 rc=0 才是权威——见 D2。

**每条读数的复现命令**（评审意见 i5：不能只给数字。所有命令在本 worktree 根执行；`44054389e` 之后 main 仍在前移，命令重跑得到的是"当时值"，故一律按下界断言，见 D9）：

| 读数 | 复现命令 |
|---|---|
| 改前权威读数 rc=0 | `node scripts/check-gate-record-debt.js` |
| 归属唯一可解析 / 端到端 1.03s | `node .tmp-addby-probe.cjs`（探针，实现期由 tasks 2.6 的行为锁取代并入 CI） |
| 1926 个已合并 PR、5202 提交 | `git log origin/main --format=%s \| grep -cE '\(\#[0-9]{3,}\)$'`；`git rev-list --count origin/main` |
| 回填 PR 占 53%、lead time | `gh pr list --state merged --limit 60 --json number,title,mergedAt,createdAt` 后按标题正则筛（探针脚本，同上交 CI） |
| `fetch-depth: 0` 落点 | `sed -n '45,60p' .github/workflows/quality-gate.yml` |

## D1 键换成「记录文件自己被哪次合并带进 main」，而不是让人写 PR 号

**决策**：收口证据 = `addedBy(记录文件路径)` ∈ `mergeLedger`。人不写任何**登记字段**（`sync_status/sync_reason/sync_backfill_owner`）；注意这与"不写状态列"是两件事——`远程同步` **行仍然必须存在**（D2 缺行即红），只是它的状态列不再需要事后改写。用词必须区分「登记字段」与「状态列」，混称会让下一个会话以为可以省掉这一行。

**为什么**：merge SHA 只有合并后才知道（循环依赖的根），但"**这篇文件是哪次合并带进来的**"是 git 的一等事实，合并后自动可知、合并前必然不可知——语义正好等于「远程同步已收口」，且**无法被提前伪写**。

**替代方案与否证**：
- （否）在 frontmatter 写 `sync_pr: NNNN`，`gh pr create` 后回填：仍要人写、仍是一次提交；更关键的是它把"声明"重新变成判据输入，回到本设计要消灭的形态。保留为**可选的意图声明**（D4），不作为收口依据。
- （否）让 bot 在合并后自动提交回填到 main：需分支保护豁免，属改「谁来守门」，且与仓规"禁止直推 refs/heads/main"正面冲突，还会自触发新一轮 push。
- （否）按记录正文里出现过的 `#NNNN` 猜：实测 21 篇未闭合记录的**状态行内一个 PR 号都没有**（PR 号只在别处散文里），且 AGENTS.md 明令"噪声/合法性类判据不得用文本形态猜，必须记录来源意图"。

**代价**：判据要读 git 历史。实测成本 1.03s，且落点 `changes` job 已是 `fetch-depth: 0`（`.github/workflows/quality-gate.yml:52-54`）。

## D2 结构要求与状态判定解耦：缺行仍然即红

**决策**：`派生只替代"状态列文字"的判定，不豁免"行必须存在"。` 缺 `远程同步` 行 ⇒ 仍进 `missingRecordRows` 拦截面。

**证据**：探针曾把 `openspec/records/_exempt/backfill-2939-record.md` 读成"缺行 ⇒ 改前红、改后绿"，而真门禁 rc=0——该文件在 `_exempt/` 豁免目录内，不在门禁域。两条结论：① 派生判据的扫描域**必须复用 `listRecordFiles` 这一份实现**，禁止另写文件清单；② "缺行"绝不能被派生放过，否则把 Requirement「缺行即红」整条作废。

**域一致必须是可执行断言**（评审意见 i8）：加一条锁——派生档遍历的文件集合 SHALL **逐等于** `listRecordFiles(recordsRoot)` 的返回值，不得有任何额外排除或包含（改名过滤、`_exempt` 过滤、子目录过滤都必须来自那一份实现）。把 `derivedClosed` 的输入换成第二份清单，本条当场红。

## D3 分类状态表（唯一判定口径）

**先定义归属取值本身是三态，不是布尔**（评审意见 i1：`addedBy` 为 null 与"文件不在映射里"是两回事，混写会让状态表不自洽）：

- `NOT_IN_BASE` —— 该路径在 `addedBy` 映射里没有。**唯一真实来源是"本次变更集刚写的记录"**（尚未合并）。原写"或改名后的旧路径"已被实现期实测否证：旧名的创建提交本身就是一次 `A`，它**永远留在映射里**（测试夹具实测 `alpha.md → delta.md` 后 `addedBy(alpha.md)=100` 仍存在），只是那条路径不再存在于工作树、判据永不会去查询它。把这条写错会让下一个会话以为"改名 = 该记录失去收口能力"，方向恰好相反。
- `NO_FOOTER` —— 在映射里但归属提交没有 `(#NNNN)` 尾注 ⇒ 派生不可用（实测 2 篇，D8）。
- `PR(n)` —— 在映射里且解析出 PR 号；`n ∈ mergeLedger` 时派生成立。`PR(n)` 但 `n` 不在账本（异常态）按未收口处理，**不**算 `ledgerUnavailable`。

| 状态 | 条件 | 判定 | 备注 |
|---|---|---|---|
| `missingRow` | 行不存在 | **红** | 与现状一致，派生不豁免（D2） |
| `derivedClosed` | 行存在 ∧ `addedBy(file) ∈ mergeLedger` | **收口** | 不看状态列文字；不触发字段卫生红（D5） |
| `blobClosed` | 行存在 ∧ 状态列命中闭合词表 ∧ 无派生证据 | **收口** | 兼容读，服务存量与 D8 |
| `inThisChangeset` | 行存在 ∧ 该文件是**本次变更集**新增 ∧ base 上无此文件 | **byDesign 不红** | 自己不能证明自己已合并；合并后自动转 `derivedClosed` |
| `prematureClaim` | `inThisChangeset` ∧ 状态列写了闭合词 | **红** | 堵"合并前预写 PASS"，正是现状无能为力的那一格 |
| `debt` | 以上皆非 | **红**（或走既有登记通道） | 未收口且无登记 |
| `ledgerUnavailable` | git 取证失败 / ref 取不到 / 账本规模读数为 0 | **派生整体停用并出声**，退回纯 `blobClosed` 口径 | 绝不把"看不见账本"读成"已合并" |

`ledgerUnavailable` 与"账本里没有这个 PR"是两回事：后者是真未收口。

**求值优先级必须是声明式的一条链**（评审意见 i2：原表并列写 `derivedClosed` 与 `prematureClaim`，没说谁先，实现会各自默认）：

```
missingRow → (NOT_IN_BASE ? inThisChangeset / prematureClaim : —) → derivedClosed → blobClosed → debt
```

即：缺行先判；不在基线上的记录只可能是 byDesign 或预写红；在基线上的先看派生，派生不成立才看断言词表，都不成立才是欠账。

**卫生约束跟"是否做了断言"走，不跟最终归类走**（i2 的派生问题，本条把它关死）：一条记录若**同时**满足 `derivedClosed` 与"状态列写了闭合词"，它仍受 `staleRecordFields` 与跨源比对约束——因为 blob 里那句 `PASS` 是一次人工断言，断言就得自洽。只有"状态列没写闭合词、纯靠派生收口"的记录才豁免字段卫生（D5）。判据口径：**谁做了断言，谁受断言档的卫生约束**。

## D4 意图声明 `delivered_by_pr`（可选，存在即交叉核对）——键名是实测改的

**原设计用 `sync_pr`，实现期实测否决**：真仓已有 **6 篇**记录写了 `sync_pr`，形态是 `0`(×2) / `pending`(×3) / 完整 URL(×1)，**没有一篇**是整数。也就是说这个键名已被别的会话按"回填状态"的语义占用；若新判据复用它，要么把 6 篇存量当场判红（违反存量不动），要么静默无视它们的值（等于键名歧义永久长存）。所以规范键改为零存量用户的 `delivered_by_pr`；旧键 `sync_pr` 不参与判定，但**必须可见**（打印条数与逐篇值，实测改前 6 篇），随顺路清理收敛。

交叉核对规则：记录写了 `delivered_by_pr` 而 git 推出的"把它带进基线的 PR"与之不同 ⇒ 红 `intentMismatch`；写了但**读不出整数**（如 `PR-123`）⇒ 同样判红，不许静默当成"没声明"（参数不得静默忽略的同族）。缺省 ⇒ 本条不参与判定，故新增拦截面对存量零命中（实测真仓 `intentMismatch=0`、`prematureClaims=0`）。

## D4b `collect()` 不得默认读生产仓库——一条"备用路径"实测是死分支

原实现留了 `mergeLedger || buildLedger({baseRef, cwd: root})` 这条默认分支，理由是"与 carrierFreeze 同规"。**结果恰好相反**：`main()` 自己构造后注入、所有用例也注入，那条默认分支永不被走到；变异 N8（把默认 baseRef 写成坏值）72 条全绿——未走过的分支不是备用路径，是藏起来的第二口径。

现在 `collect()` 只接受注入，缺注入即 `{ok:false, reason:'not-injected'}` 并让 CI 档非零退出；账本构造只住在 `main()` 一处。补的锁是**行为级**的（真起子进程跑 CLI，断言首行含 `MERGE-LEDGER prs=<数字>` 且不是 `n/a`），N8a/N8b/N8c 三条变异各自 CAUGHT。

## D5 字段卫生只对 `blobClosed` 生效

实测：被派生收口的 22 篇里有 **21 篇仍带 legacy `sync_*` 字段**。若沿用既有 `staleRecordFields`（"已收口却仍留登记字段"）口径，这 21 篇当场变红 ⇒ 直接违反「存量不动」。

**决策**：`staleRecordFields` 的适用范围 = **blob 做过闭合断言的记录**（`blobClosed`，以及 `derivedClosed ∧ 状态列写了闭合词` 那一格，见 D3 末段），不含"纯派生收口、状态列没写闭合词"的记录。后者带 legacy 字段属兼容态，计入可见数并挂**只能缩小**的棘轮清单。新记录一律不写 `sync_status/sync_reason/sync_backfill_owner`。

**这 21 篇由谁清理**（评审意见 i7，原设计只说了不红，没说尽头）：不专门开 PR 清（那正是本 change 要消灭的形态）。规则定为——**任何 PR 本来就要改到某篇记录时，顺手删掉它的三个 legacy 字段**；可见数字段只允许因这类顺路清理而下降，判据用「可见数不得上升」拦（上升说明有新记录写了 legacy 字段，即新形态被写旧了），不拦"存量还挂着"。彻底清零属后续独立 change，本 change 显式不做。

## D6 跨源比对范围保持 `blobClosed`，派生矛盾改为可见项

实测：若把派生收口的记录并入 `closedRecordSlugs`，有 **2 篇**（`mime-stock-freeze`、`ops-ingress-correct`）会与旧载体 `.quality-gates.md` 里同 slug 的 `PENDING` 块构成矛盾 ⇒ 当场新增 2 条红。

**决策**：拦截面维持"blob 自己声称 PASS 才比对"；`derivedClosed × 旧载体未收口` 单列可见项并打印条数。理由：这 2 条属旧载体历史账，本仓纪律是不代他人改写其执行记录（既有 `CROSS_SRC_ALLOWED` 同因）。

## D7 单一实现与落点

- `scripts/lib/merge-ledger.js`（新）导出 `buildLedger({baseRef, cwd})` 与 `classifyAttribution(ledger, relPath)`（名字以实现为准，本节旧稿写的 `buildMergeLedger` / `buildAddedByMap` 从未存在过），**两个判据（状态、归属）都从这里取**，禁止第二份 git 解析。`-c core.quotepath=off`、`--no-renames`、只认 `(#NNNN)$` 尾注三条口径都写进注释并各配一条测试（打开 rename 检测会把归属**重指**到改名提交，而不是"解析不出"——见 D3 与 tasks 2.10）。
- 落点必须是 `quality-gate.yml` 的 `changes` job（无 job 级 `if:`，docs-only 不短路，`shell: bash` fail-fast）。**不得**放 `static-gates`：该 job 有 `if: needs.changes.outputs.docs-only != 'true'`，判据一旦进可跳过的 job，docs-only PR 就永远不跑它——本仓已有 `TEST_ONLY_IN_SKIPPABLE_JOB` 机械锁（`scripts/check-unwired-tests.js`）会直接拦。
- `--current-pr` **不实现**（落片 5 外部评审 F2 的裁决）：`inThisChangeset` 的判据是"该路径不在 base 的归属映射里"，不需要 PR 号；而旗标一旦被白名单接受又没有消费者，在 CI 日志里就读起来像"某一档生效了"——与"拼错了被静默忽略"是同一条反模式的两端。因此 `parseFlags` 现在对它**抛未知旗标**，并有用例钉住这条抛错。同一评审还确认：本文件原先写的导出名 `buildMergeLedger` / `buildAddedByMap` 与实现不符，实际是 `buildLedger`（返回 `{ok, mergedPrs, addedBy, stats}`）与 `classifyAttribution`，已按实现改名本节。

**共享实现必须自带自检，且自检要能被证明在跑**（评审意见 i3）：`buildLedger` 在 baseRef 可解析而账本为空时 MUST 产出"账本不可用"信号，而不是返回空 Map（空 Map 会被上层读成"一个已合并 PR 都没有"，方向上安全但会让派生档静默退化成装饰）；解析中途抛错 MUST 被捕获并落 `unavailable()` 出声。配一条**隔离测试**：把归属解析改成恒读不出 PR ⇒ 必须红，且红的是派生档用例而非全量（证明派生档不是搭在断言档上的顺风车）——这条就是变异反证 M2 的实跑形态。

**CI 打印必须自证，不能靠人事后 grep**（评审意见 i4）：`MERGE-LEDGER prs=<n>` 不是日志装饰。判据在 CI 环境（`process.env.CI` 为真）下若 `n === 0` ⇒ MUST 非零退出并点名"派生档未生效"；本地非 CI 允许打印 `n/a` 后按 `ledgerUnavailable` 出声降级。另配 `workflow-contract.test.js` 结构锁：该步骤 MUST 存在于 `changes` job，且 MUST NOT 出现在任何带 job 级 `if:` 的 job 里。

## D8 存量与迁移：判据兼容读，文件一个字都不改

实测改前：`rc=0 / 0 拦截 / 23 条已登记欠账 / 21 篇未闭合记录全部带 legacy 登记字段`。
实测改后（按 D3–D6 口径建模）：**拦截集合为空、新增红 0 篇**；22 篇由"人写的 PENDING"转为"git 推导的收口"；2 篇派生×旧载体矛盾转可见；2 篇 add-commit 无尾注的记录（`publish-frequency-control.md`、`wechat-qr-stale-cookie.md`）继续走 `blobClosed`——**这就是兼容层不能一次砍掉的实证**。

> 上面的 407/22/2 是探针域（只排除 basename 带下划线），门禁域是 405 篇。实现期以 `listRecordFiles` 为准重测，并把"改前/改后拦截集合逐篇相同"写成**读真仓的行为锁**（见 tasks 片 2），设计文档里的这些数只作量级与方向，不作验收值。

## D9 活数一律写成下界，不写成常数

本仓 main 高频并发（测量期间 tip 从 `28f37b794` 走到 `44054389e`，记录数 406→407）。所有规模断言按**下界**写（`mergedPrs >= 1500`、`recordFiles >= 400`），禁止 `toEqual(407)` 这种把某次读数焊死的断言。

## D10 规格落点：两侧都只能用 ADDED（结论由 spike 决定，不是推理）

`quality-gate-execution-record`：**已实测否证"写 MODIFY"这条路**。该 capability 的基线尚未归档（`grep -rl 远程同步 openspec/specs/` 为空，正文只在未归档 change `enforce-gate-record-presence` 里，且它那一条本身是 `## ADDED Requirements` 下的一条，不是已存在的基线 Requirement）。在临时副本 `<os.tmpdir>/osx-spike-b` 里跑的三条读数：

| # | 动作 | 实测结果 |
|---|---|---|
| S1 | 本 change 以 MODIFIED 归档 | **失败**：`code=archive_spec_update_failed`，`target spec does not exist; only ADDED requirements are allowed for new specs`，`"archive": null`、`No files were changed` |
| S2 | 同一 delta 改成 ADDED 后归档 | **成功**：`archivedAs=2026-10-17-gate-record-sync-derived-status`、`specsUpdated=true`、`totals.added=3`，`openspec/specs/quality-gate-execution-record/spec.md` 被创建 |
| S3 | 在 S2 之后归档 `enforce-gate-record-presence` | **成功**：`totals.added=5`，仅一条 warning：`delta Purpose ignored; … already has one`（⇒ Purpose 只认第一份，后归档那方的 Purpose 被丢弃，属已知无害行为，但要如实记） |

**结论**：本 change 该条写成 **ADDED**，并在正文里显式声明它取代旧条的"状态如何算收口"那一半（缺行的结构要求不变）。**遗留的语义重复**（如实记，不假装已闭合）：若 `enforce-gate-record-presence` 后归档，基线里会同时存在「状态按闭合词表判定」与本条「派生通道优先、断言通道兜底」，先后顺序不确定、靠本条正文的取代声明消歧。彻底收敛要求对方那条 Requirement 改写，属**别人的未归档工件**，本 change 不代改；后续独立 change 处理，编号在此留空待补。

`openspec-integration`：**只用 ADDED**。原因实测：`分层分支策略` 这一条 Requirement 已被 `freeze-legacy-gate-carrier` 与 `hot-carrier-atomic-landing` 两个未归档 change 同时 MODIFY（前者的 spec 里已自带一条"归档顺序依赖"警告）。再写第三条 MODIFY 会形成三方覆盖——`openspec archive` 以后归档的静默盖掉先归档的，正是那份警告描述的事故。新增一条独立 Requirement 承载"收口证据来自主干历史 + squash 尾注是契约"，与那两条不冲突。

## 失败模式与处置（逐条可执行）

| 失败模式 | 后果 | 处置 |
|---|---|---|
| CI 上 `refs/remotes/origin/main` 取不到（浅检出/事件差异） | 派生恒不可用 ⇒ 改造退化成装饰 | `ledgerUnavailable` 出声 + CI 步骤强制打印 `MERGE-LEDGER prs=<n>`；`prs=0` 视同不可用；验收要求**真 CI 日志**里出现该读数（不接受本机推断） |
| 非 gh-squash 合并（人工 merge/无尾注） | 该记录永不被派生收口 | 走 `blobClosed` 兼容层（D8 实测 2 篇即此类）；不扩词表、不加猜测 |
| 同一尾注出现在多个提交（实测 4 次）；同名文件被删后重新加入 | 归属可能有多个候选 | **取"最近一次新增"而非"首次新增"**（实测口径：`git log` 默认新→旧，遍历时**后到的不加**，即保留最先遇到的那条 = 最近一次 A）。理由：main 上现存的这份内容就是最近那次 A 带进来的，取首次会把"删掉又重新加回来"的内容归给一个已经不存在于主干历史的交付。歧义计数照打印，不静默择一 |
| 记录文件被后续 PR 改名/移动 | **归属被静默重指到改名那次提交**（不是"解析不到"） | 本行原写"解析不到"，属事实错误，已用实验否证：临时仓库 `a.md (#100)` → `git mv a.md b.md` → `b.md (#200)`，`git log --diff-filter=A --no-renames -- b.md` 输出的是 **#200**。后果如实接受：closure 仍成立（文件确在 main、改名 PR 也已合并），但"哪次交付带它进来"变成改名 PR，`--no-renames` 下无从回溯。缓解有两条且各有其用：① 记录文件名即分支名，改名本身就违反「每 PR 一篇」约定，属可禁止操作；② 声明了 `sync_pr` 的记录会被 `intentMismatch` 当场抓到（D4）；未声明者只能接受重指，**不得假装检测得到** |
| 有人在合并前把状态列写成 `PASS` | 现状：门禁放行（断言即事实） | 改造后：`prematureClaim` 红（D3）——本条是这次改造**净增**的拦截能力 |
| 账本可用但记录对应 PR 被关闭未合并 | 文件从未进 main ⇒ 不在门禁域 | 无需处置，如实说明：只有进了 main 的记录才被判定 |

## D11 QM-6 后端轴（claude）22 条 findings 的处置摘要

后端轴交回 9 Critical / 7 Warning / 6 Info（原件入库 `reviews/r2-findings-backend-claude.json`）。逐条核对后的分类，**不笼统接受也不笼统驳回**：

- **命中且是事实错误（已改）**：`GIT-1` 改名语义——本设计原写"改名 ⇒ 归属解析不到"，临时仓库实验否证（改名提交带出 `A`），失败模式表与 D3 的 `NOT_IN_BASE` 定义均已按实测重写。`GIT-3/GIT-4` 归属候选歧义——原文写"保留首个新增"，与探针实现（newest-wins）相反，已改为显式声明取**最近一次 A** 并给理由。
- **命中但已被前轮修订覆盖（不重复改）**：`LEDGER-2`（空账本必须出声，已由 i3 落 tasks 1.7）、`GIT-2`（quotepath 口径已有 tasks 1.3）、`D2-1` 的"自建清单"风险（已补 Scenario「集合必须来自同一份枚举」）。
- **两条互相打脸，按实验裁决**：`D3-1` 的取证写"改名后 `--diff-filter=A -- <新名>` 无输出"，`GIT-1` 写"输出改名提交"。实验取 `#200` ⇒ **D3-1 的取证描述错误**，其担忧的实际形态由 GIT-1 承接（身份重指），已落规格。
- **接受并补强（判据可机械执行的收口）**：`D5-1` 优先级反转会打开预写通道 ⇒ 加不变式「`NOT_IN_BASE` 的记录永不进入 `blobClosed`」（它不在基线上，断言档对它没有意义）；`D6-1` 可见项若没打印就是永久静默 ⇒ 可见计数必须被断言而非只打印；`LEDGER-1` 要求补「浅检出模拟」——`baseRef` 不可解析时未闭合记录**必须红**且 `MERGE-LEDGER prs=0` 必须出现，两件事各一条用例。
- **驳回（不是设计缺陷）**：`TASKS-1/2` 说 QM-6 与 PR 自查无法机械化——本就把它们列为人工卡点（仓规「判据第 5 条是 agent 自查而非机械闸门」），设计不假装相反。`TASKS-4` 部分成立：见下。
- **`TASKS-4` 成立的部分（活主干上对账不可复现）**：2.6 的"改前/改后逐篇相同"在并发前移的 main 上不是确定命题（实测同一会话内记录数 406→407）。改口径：**对账必须钉死一个 `baseRef` SHA**（由参数传入并回写进执行记录），两侧同 SHA 才可比；不传即判"未证实"，不得用"当前 HEAD"默认值蒙混。

## 反证计划（每条都必须实测变红，红集互不相同）

M1 摘掉 `derivedClosed` 分支 ⇒ 点名"未闭合记录应被派生收口"的用例变红。
M2 `addedBy` 恒返回 `null`（即所有文件都解析不到归属 PR）⇒ 派生档全灭；**预期红的是"状态列未闭合、原本靠派生收口"那批用例（它们落到 `debt`），预期仍绿的是"状态列写了闭合词"的兼容档用例**（i1 的口径修正：`null ∉ mergeLedger` 走的是欠账分支，不是"派生分支自己红"，措辞必须点名落点）。
M2b 把 `addedBy` 从 `NOT_IN_BASE` 与 `NO_FOOTER` 混成同一个值 ⇒ 必须红（i1 的第二半：三态塌两态会让"改名导致归属丢失"被读成"本次新增"，方向相反的两种误判共用一个出口）。
M9 把求值优先级改成 `blobClosed` 先于 `derivedClosed`（或反过来不做约束）⇒ 必须红在"派生与断言同时成立 + 带 legacy 字段"那条组合用例（i2：不写优先级，实现会各自默认，测试也就各测各的）。
M10 把派生档的输入文件集合换成自建清单（不再调用 `listRecordFiles`）⇒ 必须红在域一致锁（i8）。
M11 把归属解析改成"首次新增优先"（与 newest-wins 相反）⇒ 必须红在"删后重新加入"那条用例（GIT-4：两种取向给出不同 PR 号，不测就是任一种都能过）。
M12 把改名用例的期望改成"解析不到"（即照本设计**修订前**的错误文本写断言）⇒ 必须红（GIT-1 的回归保护：防止下一个会话把这行改回去）。
M13 去掉 `baseRef` 钉死、改回"读当前 HEAD"⇒ 必须红在改前/改后对账锁（TASKS-4：不钉 SHA 的对账在并发主干上不可复现）。
M3 把 `ledgerUnavailable` 的 fail-closed 改成"当已合并放行" ⇒ 必须红（这条是在拆最危险的洞）。
M4 打开 rename 检测 / 去掉 `core.quotepath=off` ⇒ 归属解析用例红。
M5 把 `staleRecordFields` 作用域改回全量 ⇒ 21 篇真仓对账锁红（D5 的代价可见化）。
M6 把跨源范围并集扩到 `derivedClosed` ⇒ 2 篇真仓红（D6）。
M7 摘掉 `prematureClaim` ⇒ "合并前预写 PASS 必须红"那条红。
M8 把落点从 `changes` job 移到 `static-gates` ⇒ `check-unwired-tests.js` 的 `TEST_ONLY_IN_SKIPPABLE_JOB` 红。

## 残留风险（不假装已闭合）

1. **CI 侧 ref 可用性未实测**。本机按 D1 探针证明了 git 侧可行，但 GitHub runner 的 `changes` job 是否真有 `origin/main` 引用，只能等一次真 CI 跑（M8 之后）。验收必须回读该步骤日志的 `MERGE-LEDGER prs=` 行；拿不到就如实记"派生档未在 CI 生效"，不得按本机读数宣布成功。
2. **squash 尾注是本仓惯例不是 git 保证**。若未来改用 rebase-merge 或平台默认合并（不写 `(#N)`），派生档会整体退到兼容层——这条依赖必须写进 `openspec-integration` 的规格，不能只留在脚本注释。
3. **改造后仍不校验"记录内容与那次交付是否相配"**。`addedBy` 只证归属，不证门禁表里各行的真实性；那属 QM-6 与执行记录存在性判据的范围。
4. **旧载体与 ledger 的 23 条自指欠账原样保留**（存量不动）。等它们被自然消化后再谈是否废弃旧通道；本 change 不碰。
