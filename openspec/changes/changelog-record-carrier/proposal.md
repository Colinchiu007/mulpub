# changelog-record-carrier：CHANGELOG 与 learnings 的条目真源收敛到执行记录，热写面改为聚合产物

## Why

### 现场问题（2026-10-20 实测，以下每个数都在本次会话当场取）

多 PR 并发修改 `CHANGELOG.md` 与 `01-docs/learnings.md` 时频繁撞车：CI 全绿却 `mergeable=CONFLICTING`，必须 rebase 再跑一轮，一轮 CI 实测 25–30 分钟。当场读数：

- 在飞 PR **35** 个，其中 `mergeable` 读数 **5 = CONFLICTING**、**22 = UNKNOWN**、其余 MERGEABLE。
- 对 4 个可判定的非 MERGEABLE PR 逐条跑 `git merge-tree --write-tree origin/main <pr-head>` 取冲突文件清单：#4089 / #4086 / #4095 **只**冲突在 `CHANGELOG.md`，#4083 冲突在 `CHANGELOG.md` + `01-docs/learnings.md`。**没有出现任何其他文件**。
- 最近 **30** 笔 `origin/main` 提交里 **20** 笔改了 `CHANGELOG.md`、**7** 笔改了 `01-docs/learnings.md`。

### 根因（第一性原因，不是"有人手滑"）

这两个文件都要求**在第 1 行插入新块**。于是任意两个同时在飞的 PR 必然对同一位置提出各自的插入 ⇒ git 三方合并结构上无法判定顺序 ⇒ 必冲突。这不是纪律问题，是写面形状问题。

`scripts/changelog-dedup-regen.js` 的头注释已经把这条写得很清楚，并且给出了它的代价：main 每约 **37 分钟**前进一次、一轮 CI **25–30 分钟** ⇒ 任何「按 base 算我的块再 prepend」的写法必然被 re-sync 撞上；而该文件存在的原因，正是撞上之后要在「一份 4.8 万行删除的文件上手解冲突」。主干上那批重复标题键（AGENTS.md 2026-10-17 记的读数为 `CHANGELOG.md` 3348 个重复行键、单键最多 286 份）就是同一个形状反复复利出来的产物。**该数是活数，引用前重取**：本次在 `HEAD` 上重取的是 `3,026,950` 字节 / **577** 条 / **577 种** / 冗余 **0** 份（判据 `check-changelog-growth` + `check-changelog-duplicate-entries` 首行读数）—— 那批副本**已被后续清理收掉**，所以本刀面对的不是历史污染，而是**仍在生产副本的那个形状**。

### 为什么现有机制没能收敛它

仓库已经把「执行记录」的唯一强制载体收敛成 `openspec/records/<分支名>.md`（change: `freeze-legacy-gate-carrier`）——**按分支名一份，路径唯一，天然零冲突**。但 `CHANGELOG.md` 与 `learnings.md` 没有跟着收敛：同一条变更的说明此刻仍要抄进（最多）三处——`CHANGELOG.md` 顶部、`01-docs/learnings.md` 顶部、`openspec/records/<分支>.md` 正文。两个共享写面保留着撞车形状，而唯一那份不会撞的载体里已经有同样的内容。

### 为什么之前没人处理

没有门禁要求「PR 必须改 CHANGELOG」，也没有门禁禁止「PR 改 CHANGELOG」。`Gate 2c3`（`check-changelog-growth.js`）只判**只可增长**，一条不动 CHANGELOG 的 PR 天然满足它。所以「不改」和「改」在机械上等价，人人按既有习惯继续改，撞车成本由下一个会话以 rebase 的形式重复支付。

## What Changes

条目真源移到 `openspec/records/<分支>.md` 的两个新增强制小节；`CHANGELOG.md` 与 `01-docs/learnings.md` 变成**只能由聚合器写入**的归档产物。

1. **records 携带两个可聚合小节**（能力：`quality-gate-execution-record`）
   - `## CHANGELOG 条目`：本 PR 那一条面向人的变更说明（标题 + bullets）。
   - `## learnings`：零到多条 `### lesson: <slug>` 块。
   - 缺 `## CHANGELOG 条目` 判红；`## learnings` 允许缺席（不是每次都有教训），但**存在即要求形状合法**。
2. **聚合器 `scripts/aggregate-changelog.js`**：扫已合并的 records，把两段逐字节搬运，分别追加到两个归档产物顶部。幂等键取 **record 名**（`openspec/records/` 的文件名 = 分支名，唯一），MUST NOT 用标题文本、MUST NOT 用位置或时间戳——主干上同一标题存在多份副本，用文本判「是否已落」会把该搬的那条判成已搬。
3. **热写面禁改门禁 `scripts/check-no-hot-carrier-edit.js`**：按 **PR 差量**（merge-base..head，而非文件现状）判定，差量里出现 `CHANGELOG.md` 或 `01-docs/learnings.md` 即点名。发版聚合 PR 与历史清理 PR 走**显式授权文件**出口（沿用 `changelog-dedup-authorization.json` 那条已验证的形态：授权必须本次差量新增、且核对坐标系，base 已存在不生效）。
4. **发版接入**：聚合动作接到 `scripts/release-gate.mjs` 之前——它已经在要求 CHANGELOG 含 `## [v<版本>]` 小节，正好是唯一需要"新条目已落进归档"的时刻。
5. **迁移两档**：禁改门禁先以 **advisory**（点名不拦）落地，给在飞 PR 一个消化窗口，再由独立一片转 **blocking**。两档都写进判据自己的输出首行，不得靠读文案猜。

### 本片只落哪几件、哪几件**尚未实现**

本 change 的规格 delta 描述的是**整个 change 的目标合同**，不是本 PR 的交付清单。以下三条此刻**在仓库里不存在实现**，读规格的人不要把"写在 spec 里"当成"已经守着"：

- `scripts/check-no-hot-carrier-edit.js`（禁改热写面门禁）—— 片3
- `scripts/hot-carrier-write-authorization.json`（发版/清理 PR 的授权出口）—— 片3，与其判据同片落地
- records 两个小节的**强制校验**（缺 `## CHANGELOG 条目` 判红）与 `release-gate` 接线、advisory→blocking 转档 —— 片4

本片交付的是：`scripts/aggregate-changelog.js` + 它自己的 21 条行为锁 + `Gate 2b8` 接线。也就是说聚合器已经能跑、且真仓读数已证明链路通，但**还没有任何东西强制 PR 去写那个小节**——所以 `missing=591` 是当前的真实状态，不是缺陷。

### 明确不做（不做就是不做，不写成"以后注意"）

- **不动存量历史**（实测 `3,026,950` 字节 / 577 条），不拆成 `changelog.d/` 分片。那批重复标题键的清理**已在本刀之前发生**（当场重取冗余 = 0 份），因此本刀不欠这笔；冻结成归档要做的是**消掉新增来源**。
- **不改** `check-changelog-growth.js` 的判据语义（只可增长）与 `check-changelog-duplicate-entries.js` 的副本棘轮——它们在新形态下仍然有意义：前者由聚合 PR 天然满足，后者继续守归档不被改写。
- **本片不摘** `check-branch-merged.js` 的「多会话共用写面」登记。那两行必须等两个文件**真的不再被业务 PR 改动之后**才摘；提前摘会让收尾判据退回"整文件比较"，那是已实测过的假阳性来源。

## Impact

- **文件**：`openspec/records/` 模板与判据（`scripts/check-pr-exec-record.js`）、新增 `scripts/aggregate-changelog.js`、新增 `scripts/check-no-hot-carrier-edit.js`、`.github/workflows/quality-gate.yml`（`changes` job 接线）、`scripts/release-gate.mjs`、`AGENTS.md`、`.github/scripts/workflow-contract.test.js`（Gate 2c3 结构锁随接线同步，不同 PR 改必红）。
- **风险面**：本刀同时命中 `check-pr-exec-record.js::HIGH_RISK_SURFACES` 的两类前缀（`scripts/check-`，判据自指；`.github/workflows/`）。按 QM-6 收口矩阵，高危面**只认 `tier=external` + 可核 `evidence`**，`closureNote` 不再够格。2026-10-20 本机实测后端存在 403 额度不足档 ⇒ 片3/片4 的外部评审有真实前置；探不到就如实记欠账，MUST NOT 用自扮演冒充闭合。
- **落点约束**：新判据必须接在 `changes` job（非 docs-only 短路位），且该 job 无 `Install deps` ⇒ 判据只能 require node 内置模块（`scripts/quality-rhythm-spec-mirror.test.js` 已锁这一族）。
- **收益可测**：撞车面从「2 个全员共享写面」收敛为「按分支名一份」；收尾链上那两个最热的行级多重集判据在迁移完成后可以降级为普通逐字节比较（这条留作片4 之后的独立观察，不在本片承诺）。

## 残余风险（不假装已闭合）

1. **聚合器成为唯一写者之后，写串行点转移但没有消失**：发版 PR 仍是单点，两个发版撞在一起照样冲突。本片把它从「每天 20 次」降到「每次发版 1 次」，没做到零。
2. **`## learnings` 的形状约束只能判到形态，判不到内容**：可以拦「写成表格 / 超长 / 缺 `### lesson:`」，拦不住「把取证流水账抄进来」。这条只能靠模板 + 审查，MUST NOT 在实现里假装它是机械可判的。
3. **advisory → blocking 之间的窗口是新条目的空档**：窗口内既有旧写法（手改 CHANGELOG）又有新载体（records 小节），聚合器必须能识别并跳过手改的那批，否则发版时会把同一条搬两遍。幂等键按 record 名是为此准备的，但**窗口的长度本身是一个欠账**，转 blocking 的那片要带当场重取的在飞 PR 数。
4. **本片自己也在高风险面上改判据**：`check-pr-exec-record.js` 若因新增小节校验而出错，影响面是全部 PR 的提交。片3 落地时必须带「把新校验改成恒通过 ⇒ 指名用例变红」的变异反证，不得只证"业务改动会红"。
