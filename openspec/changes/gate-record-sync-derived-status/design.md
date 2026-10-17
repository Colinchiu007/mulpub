# 设计：把「远程同步」收口判据从人工断言改为 git 现场推导

本文件是评审对象。每条决策都带**实测证据出处**与**被否证的替代方案**；没做对照实验的推断一律写在「未闭合风险」里，不混进决策正文。

## 0. 取证基线（所有数字的时点）

- worktree base：`origin/main` tip `44054389e`（测量期间 main 仍在前移，见 D9 的"活数"口径）。
- 真门禁改前权威读数：`node scripts/check-gate-record-debt.js` ⇒ **rc=0 / OK**，打印 `远程同步行 400 条 / 执行记录 605 篇 / 已登记欠账 23 条 / 记录文件 405 篇`，可见项 `213 篇旧载体执行记录整块没有 远程同步 行`、`跨源比对现场：配对 131 组 / 违例 0 / 承认 1`。
- 派生前置可行性探针：一次 `git log origin/main --diff-filter=A --name-only --no-renames --format=%H<TAB>%cI<TAB>%s` 扫 17217 行，**407/407 篇记录文件都能唯一解析到"哪次提交把它加进 main"**，歧义 0；端到端 **1.03 秒**（两次 git 调用 727ms）。
- 合并账本规模：origin/main 5202 个提交里可解析 **1926 个已合并 PR** 的 squash 尾注 `(#NNNN)$`，同尾注重复命中 4 次。

## D1 键换成「记录文件自己被哪次合并带进 main」，而不是让人写 PR 号

**决策**：收口证据 = `addedBy(记录文件路径)` ∈ `mergeLedger`。人不写任何状态字段。

**为什么**：merge SHA 只有合并后才知道（循环依赖的根），但"**这篇文件是哪次合并带进来的**"是 git 的一等事实，合并后自动可知、合并前必然不可知——语义正好等于「远程同步已收口」，且**无法被提前伪写**。

**替代方案与否证**：
- （否）在 frontmatter 写 `sync_pr: NNNN`，`gh pr create` 后回填：仍要人写、仍是一次提交；更关键的是它把"声明"重新变成判据输入，回到本设计要消灭的形态。保留为**可选的意图声明**（D4），不作为收口依据。
- （否）让 bot 在合并后自动提交回填到 main：需分支保护豁免，属改「谁来守门」，且与仓规"禁止直推 refs/heads/main"正面冲突，还会自触发新一轮 push。
- （否）按记录正文里出现过的 `#NNNN` 猜：实测 21 篇未闭合记录的**状态行内一个 PR 号都没有**（PR 号只在别处散文里），且 AGENTS.md 明令"噪声/合法性类判据不得用文本形态猜，必须记录来源意图"。

**代价**：判据要读 git 历史。实测成本 1.03s，且落点 `changes` job 已是 `fetch-depth: 0`（`.github/workflows/quality-gate.yml:52-54`）。

## D2 结构要求与状态判定解耦：缺行仍然即红

**决策**：`派生只替代"状态列文字"的判定，不豁免"行必须存在"。` 缺 `远程同步` 行 ⇒ 仍进 `missingRecordRows` 拦截面。

**证据**：探针曾把 `openspec/records/_exempt/backfill-2939-record.md` 读成"缺行 ⇒ 改前红、改后绿"，而真门禁 rc=0——该文件在 `_exempt/` 豁免目录内，不在门禁域。两条结论：① 派生判据的扫描域**必须复用 `listRecordFiles` 这一份实现**，禁止另写文件清单；② "缺行"绝不能被派生放过，否则把 Requirement「缺行即红」整条作废。

## D3 分类状态表（唯一判定口径）

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

## D4 意图声明 `sync_pr`（可选，存在即交叉核对）

若记录写了 `sync_pr: N` 而 `addedBy ≠ N` ⇒ **红 `intentMismatch`**。这条专门抓"把别人的记录夹带进我的 PR"：文件确实进了 main，但带它进来的 PR 与它声称的那次交付不是同一个。实测当前 0 篇写了该字段，故本判据上线时命中集合为空，属**新增防线而非存量清理**。

## D5 字段卫生只对 `blobClosed` 生效

实测：被派生收口的 22 篇里有 **21 篇仍带 legacy `sync_*` 字段**。若沿用既有 `staleRecordFields`（"已收口却仍留登记字段"）口径，这 21 篇当场变红 ⇒ 直接违反「存量不动」。

**决策**：`staleRecordFields` 的适用范围收窄为 `blobClosed`；`derivedClosed` 记录带 legacy 字段属兼容态，计入可见数并挂**只能缩小**的棘轮清单。新记录一律不写 `sync_status/sync_reason/sync_backfill_owner`。

## D6 跨源比对范围保持 `blobClosed`，派生矛盾改为可见项

实测：若把派生收口的记录并入 `closedRecordSlugs`，有 **2 篇**（`mime-stock-freeze`、`ops-ingress-correct`）会与旧载体 `.quality-gates.md` 里同 slug 的 `PENDING` 块构成矛盾 ⇒ 当场新增 2 条红。

**决策**：拦截面维持"blob 自己声称 PASS 才比对"；`derivedClosed × 旧载体未收口` 单列可见项并打印条数。理由：这 2 条属旧载体历史账，本仓纪律是不代他人改写其执行记录（既有 `CROSS_SRC_ALLOWED` 同因）。

## D7 单一实现与落点

- `scripts/lib/merge-ledger.js`（新）导出 `buildMergeLedger({baseRef})` 与 `buildAddedByMap({baseRef})`，**两个判据（状态、归属）都从这里取**，禁止第二份 git 解析。`-c core.quotepath=off`、`--no-renames`、只认 `(#NNNN)$` 尾注三条口径都写进注释并各配一条测试（rename 检测会把 `A` 报成 `R`，导致归属解析不出）。
- 落点必须是 `quality-gate.yml` 的 `changes` job（无 job 级 `if:`，docs-only 不短路，`shell: bash` fail-fast）。**不得**放 `static-gates`：该 job 有 `if: needs.changes.outputs.docs-only != 'true'`，判据一旦进可跳过的 job，docs-only PR 就永远不跑它——本仓已有 `TEST_ONLY_IN_SKIPPABLE_JOB` 机械锁（`scripts/check-unwired-tests.js`）会直接拦。
- `--current-pr` 由 CI 注入 `github.event.pull_request.number`；本地跑不传 ⇒ `inThisChangeset` 改由"文件不在 base 上"单独判定，不依赖 PR 号（缺一会本地恒判 `debt`）。

## D8 存量与迁移：判据兼容读，文件一个字都不改

实测改前：`rc=0 / 0 拦截 / 23 条已登记欠账 / 21 篇未闭合记录全部带 legacy 登记字段`。
实测改后（按 D3–D6 口径建模）：**拦截集合为空、新增红 0 篇**；22 篇由"人写的 PENDING"转为"git 推导的收口"；2 篇派生×旧载体矛盾转可见；2 篇 add-commit 无尾注的记录（`publish-frequency-control.md`、`wechat-qr-stale-cookie.md`）继续走 `blobClosed`——**这就是兼容层不能一次砍掉的实证**。

> 上面的 407/22/2 是探针域（只排除 basename 带下划线），门禁域是 405 篇。实现期以 `listRecordFiles` 为准重测，并把"改前/改后拦截集合逐篇相同"写成**读真仓的行为锁**（见 tasks 片 2），设计文档里的这些数只作量级与方向，不作验收值。

## D9 活数一律写成下界，不写成常数

本仓 main 高频并发（测量期间 tip 从 `28f37b794` 走到 `44054389e`，记录数 406→407）。所有规模断言按**下界**写（`mergedPrs >= 1500`、`recordFiles >= 400`），禁止 `toEqual(407)` 这种把某次读数焊死的断言。

## D10 规格落点：一侧 MODIFY，一侧只用 ADDED

- `quality-gate-execution-record`：该 capability 的基线**尚未归档**（`grep -rl 远程同步 openspec/specs/` 为空，正文只在未归档 change `enforce-gate-record-presence` 里，剩 8 项未勾）。本 change 仍按 MODIFY 写它（要改的正是那条「状态按闭合词表判定」），但 **delta 自带完整 Requirement 正文**而非只写差异，使两种归档顺序下 `openspec/specs/` 都收敛到同一文本；顺序结论由 tasks 5.11 实跑 `openspec validate` 取证。
- `openspec-integration`：**只用 ADDED**。原因实测：`分层分支策略` 这一条 Requirement 已被 `freeze-legacy-gate-carrier` 与 `hot-carrier-atomic-landing` 两个未归档 change 同时 MODIFY（前者的 spec 里已自带一条"归档顺序依赖"警告）。再写第三条 MODIFY 会形成三方覆盖——`openspec archive` 以后归档的静默盖掉先归档的，正是那份警告描述的事故。新增一条独立 Requirement 承载"收口证据来自主干历史 + squash 尾注是契约"，与那两条不冲突。

## 失败模式与处置（逐条可执行）

| 失败模式 | 后果 | 处置 |
|---|---|---|
| CI 上 `refs/remotes/origin/main` 取不到（浅检出/事件差异） | 派生恒不可用 ⇒ 改造退化成装饰 | `ledgerUnavailable` 出声 + CI 步骤强制打印 `MERGE-LEDGER prs=<n>`；`prs=0` 视同不可用；验收要求**真 CI 日志**里出现该读数（不接受本机推断） |
| 非 gh-squash 合并（人工 merge/无尾注） | 该记录永不被派生收口 | 走 `blobClosed` 兼容层（D8 实测 2 篇即此类）；不扩词表、不加猜测 |
| 同一尾注出现在多个提交（实测 4 次） | 归属歧义 | `addedBy` 只保留首个新增提交（`--diff-filter=A` 天然按文件首加），歧义 PR 号计数打印；不静默择一 |
| 记录文件被后续 PR 改名/移动 | 归属解析不到 | `--no-renames` 是显式选择：改名即视为"未派生" ⇒ 落 `debt`/`blobClosed`，出声优于自动跟随（跟随会把归属指到改名 PR 而非交付 PR） |
| 有人在合并前把状态列写成 `PASS` | 现状：门禁放行（断言即事实） | 改造后：`prematureClaim` 红（D3）——本条是这次改造**净增**的拦截能力 |
| 账本可用但记录对应 PR 被关闭未合并 | 文件从未进 main ⇒ 不在门禁域 | 无需处置，如实说明：只有进了 main 的记录才被判定 |

## 反证计划（每条都必须实测变红，红集互不相同）

M1 摘掉 `derivedClosed` 分支 ⇒ 点名"未闭合记录应被派生收口"的用例变红。
M2 `addedBy` 恒返回 `null` ⇒ 派生全灭，兼容层用例仍绿、派生用例红（证明两档各测各的）。
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
