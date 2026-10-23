# tasks: qm6-zero-human-closure

> 本片改 `scripts/check-pr-exec-record.js`（前缀 `scripts/check-`）、`scripts/ccg-review-decider.js`（`scripts/ccg-review-`）
> 与 `.github/workflows/quality-gate.yml`（`.github/workflows/`）⇒ **三条高危面同时命中**。
> 自反条款沿用 #3987/#4261：不得以 `self-play` 收口 QM-6，且**不自动合并**（改"谁来守门"），一律人工过目。
>
> **顺序是合同不是偏好**：§2（探测器 D3）必须先于 §3.4（D1 转拦）落地。§3.4 由顺序锁守着，
> 拿不到 D3 读数就维持出声档并点名 `probe-unverified`（spec 第 4 条 Requirement）。

## 0. 前提读数（不做这步，后面的设计全是猜）

- [ ] 0.1 **重取 §1 那批活数并写进执行记录**，每条带当场命令与 `origin/main@<9位>`：
  `HIGH_RISK_SURFACES` 条数、`node scripts/ccg-artifact-shape-survey.js --ref=origin/main` 的交叉表
  （现读 `closed=339 / tier=absent=202 / external=84 / self-play=40 / unrecognized=3`、`tier 缺席=1332/1975`）、
  已合并 `#4xxx` 段笔数、`openspec/records/` 篇数。
  **两个分母必须同时记**（普查工具 1975 与 `git ls-tree | grep -c '\.json$'` 1980），并**如实写"差 5 枚的成因本会话未取证"**——
  不得挑一个写进文档假装只有一个数。
- [ ] 0.2 **取证那 5 枚差异的成因**（普查工具的形状过滤到底排掉了什么）：读 `ccg-artifact-shape-survey.js` 的
  产物形状判据并与 `git ls-tree` 名单做集合差，逐条列名。**若结论是"工具漏读"而不是"目录里有非评审产物"，
  §2 的语料种子规模要按修正后的数重算**，D3 的选择集判据也得跟着改。
- [ ] 0.3 **重取 enforce 单次耗时**（proposal 成本表里唯一标着"待重取"的数）：
  `time node scripts/check-pr-exec-record.js --base=<某已合并 PR 的 merge^> --head=<merge> --mode=enforce` 跑 5 笔取中位数，
  连样本数一起写。不得引用"约 8 秒"那句未带样本量的旧话。
- [ ] 0.4 **确认 #4261 已合并**（D3 的守门面维度取其单源）。未合并即停在 §0，不开 §2——
  在旧基线上写 D3 会造出第二份守门面清单，正是本 change 要消灭的形状。

## 1. 示踪弹：先让"高危面 Critical 无机械出口"这件事变红

- [ ] 1.1 新文件 `scripts/qm6-machine-closure-tracer.test.js`（`node --test`，接进 Gate 2c8）：
  用**真判据**（`require('./check-pr-exec-record.js')`）跑一条构造的高危面变更集 + 一条 `severity=Critical`、
  `resolution.kind=unsupported` 的 dual 产物，断言**当前**判据给出的读数里
  ① 该条被点名 ② 没有任何一条出口能在不写 `tier` 的前提下把它转为通过。
  这条在 §3 落地前**必须是红的**（它断言的是"存在机械出口"），落地后转绿——
  先跑一次并把它当时的红/绿原样写进执行记录（不得等实现完成后补一句"示踪弹曾红"）。
- [ ] 1.2 同文件加一条**反向示踪弹**：同一输入去掉 `resolution` 整段 ⇒ MUST 落 `absent` 档且 MUST NOT 落 `unrecognized`。
  两档混起来是这个闭集最容易的形状错误（`EVIDENCE_TIERS` 那段注释就是为这件事写的）。

## 2. D3 判据回归语料差分（探测器——必须先于任何拆闸）

- [ ] 2.1 **给判据补结构化命中出口**（唯一一处为可重放而做的生产改动）：
  `check-pr-exec-record.js` 导出 `QJ_RULES`（封闭常量登记表，逐条带 `why`），`evaluate()` 与
  `evaluateDeepReviewDebt()` 各加**并行**出口 `hits: string[]`；`reasons` 文案逐字不动。
  测试目标：`check-pr-exec-record.test.js` 新增 describe —— ① `hits` 每项 MUST ∈ `QJ_RULES`；
  ② 每条现存 `reasons` 至少对应一个 `hits` 项（防"有文案无规则"）；③ 反向：每个 `QJ_RULES` 项
  MUST 至少被一条现存用例触发（防"登记了但从不产出的空规则"）。
  变异反证：M-D3a 让 `hits` 恒空 ⇒ 指名红；M-D3b 把某个 id 从 `QJ_RULES` 删掉但仍在产出 ⇒ 红；
  M-D3c 往 `QJ_RULES` 加一条从不产出的 id ⇒ 红。
- [ ] 2.2 **语料录制脚本** `scripts/qm6-judgment-corpus-record.js`：从 `origin/main` 的已合并 PR 批量回灌，
  逐条取 `merge-base..merge` 的 porcelain 作 `input.statuses`、产物 json 作 `input.artifacts`、
  base blob 判据的 `hits` 作 `recorded.hits`，并写 `recordedBy`（命令 + ref）。
  **只录真实变更集，禁止手造夹具**；命中守门面为 0 的 PR 也录（它们提供"不误报"的负控样本）。
  规模与选择判据 MUST 打印（`RECORDED prs=<n> cases=<n> skipped-no-evidence=<n>`），`cases=0` MUST 非零退出。
  测试目标：新文件 `qm6-judgment-corpus-record.test.js`，夹具用 `os.tmpdir()` 自建**最小 git 仓**
  （两个提交 + 一条产物），断言录出的条目形状逐字合法；MUST NOT 打真实网络。
  变异反证：M-D3d 让 `recordedBy` 缺 `ref` ⇒ 红；M-D3e 把 `cases=0` 的出口改成 exit 0 ⇒ 红。
- [ ] 2.3 **差分判据** `scripts/check-qm6-judgment-regression.js`：`hits_new ⊇ hits_old`；
  读不到 ⇒ `unverified` 单列；`registered=0 || corpus-cases=0` ⇒ rc=2（**自身故障档与发现变宽档 rc=1 必须分档**）；
  首行打印 `JUDGMENT-RULES registered=<n> corpus-cases=<n> checked=<n> widened=<n> unverified=<n>`。
  旧版实现取法：`git show <base>:<file>` → 剥末尾 `process.exit` → `_compile` 注入 `module.exports`
  （先例见 `ccg-review-decider.test.js:1269` 那段注释）。
  测试目标：新文件 `check-qm6-judgment-regression.test.js` —— ① 正控：喂一份"把某前缀改窄"的判据副本 MUST 红并点名语料 id 与 `source.pr`；
  ② 收紧 MUST 绿；③ 语料缺失/为空 MUST rc=2 且 MUST 仍打印那行；④ 一条产物不可读 ⇒ 落 `unverified` 不落 `widened`。
  变异反证：M-D3f 把超集判据改成"集合相等" ⇒ 收紧被误红、指名红；M-D3g 把 `unverified` 并进 `widened` ⇒ 红；
  M-D3h 让空语料返回 rc=0 ⇒ 红。
- [ ] 2.4 **覆盖计数棘轮** `scripts/qm6-judgment-coverage-ratchet.js`：三判据（维度覆盖数不降 / 新维度初始 > 0 / 总条数不降）
  各一条独立红文案。键**不得**含判定记录名（§0/#4297 约束）。
  测试目标：同文件加 describe，含一条"删除唯一覆盖某维度的案例但总条数仍达标 ⇒ MUST 因维度而非条数变红"的
  **区分性用例**（这条是这个 Requirement 的全部意义，缺它则三条判据里两条是装饰）。
  变异反证：M-D3i 删掉维度判据只留条数判据 ⇒ 该区分用例红；M-D3j 允许零覆盖新维度 ⇒ 红。
- [ ] 2.5 **接线**：`.github/workflows/quality-gate.yml` 新增 `Gate 2c8 - QM6 judgment regression (changes job)`，
  门控在"变更集命中守门面"（选择集，非全量）；同时把 2.1/2.3/2.4 的测试接进 Gate 2b（秒级档）。
  **两个档都要接**：只接重放不接锁，判据本体就会变成"只有手动跑过"的装饰存量（AGENTS「测试文件必须显接进 CI」那条 MUST）。
  新测试文件名 MUST 先 `git check-ignore --no-index` 证明不被 `.gitignore` 的 `scripts/*.js` 吞掉（既有 negation 惯例）。
  **接线前置两条硬条件，缺一条就是装饰门禁**：
  ① `changes` 作业**不装依赖**，故重放器 MUST 只 require node 内置 + 仓内 lib
     （已实测满足：`check-pr-exec-record.js:32-38`、`ccg-review-decider.js:30-36` 零第三方依赖）；
  ② 检出 MUST 能看到 PR base 的 blob——浅检出下 `git show <base>:<file>` 取不到，
     而"取不到"在超集判据里长得完全像"没有变宽"。MUST 先自证可读、取不到即全量落 `unverified` 并 rc=2，
     并在 CI 上**实跑一次**打印 `base-blob-readable=<yes|no>` 留现场（不得只在本机验证过就当作成立）。

## 3. D1 处置凭证（先出声，转拦交给顺序锁）

- [ ] 3.1 `check-pr-exec-record.js` 加 `resolution` 形状判据与**三态**分档（`absent` / 闭集内 / `unrecognized`），
  以及四档各自的凭证判据（`code-fix` 的绿侧**当场重跑**、`false-positive` 的 `rebuttalRef` 命中 `rebuttals[]`、
  `deferred` 的逐字行 + 未勾、`unsupported`/`accepted-risk` 出声）。首批全部只出声。
  读数行 `RESOLUTION-CENSUS closed=<n> absent=<n> unrecognized=<n> dangling-ref=<n> manual-fields=<n>`，
  **五个数一个都不能省**——省掉任何一个，"没跑"与"跑了且零命中"就同形。
  测试目标：`check-pr-exec-record.test.js` 新增 describe（每档一正一负 + 三态各一 + 绿侧重跑行为锁）；
  `false-positive` 那条 MUST 注入**真 `rebuttals[]` 判据**（由 #4297 提供）而非手搓形状——拿不到即 fail-loud，不得 skip。
  变异反证：M-D1a 把 `unrecognized` 并进 `absent` ⇒ 红；M-D1b 让绿侧采信记录里的 `rc` ⇒ 指名红；
  M-D1c 允许 `deferred` 指向已勾行 ⇒ 红；M-D1d 悬空 `rebuttalRef` 放行 ⇒ 红。
- [ ] 3.2 **普查侧可见**：`ccg-artifact-shape-survey.js` 增 `resolution` 分档交叉表
  （`kind × 是否高危面`），并保留一条"该表为空 ⇒ 出声"的判据。锁：`ccg-artifact-shape-survey.test.js` 扩展。
- [ ] 3.3 **禁止跨档互转**：同一 `finding.id` 在两版记录间从 `code-fix` 变 `false-positive`（或反）⇒ 点名并进覆盖差分。
  测试目标：新增 `qm6-resolution-kind-transition.test.js`，用真判据跑两版产物；
  变异反证：M-D1e 只查 `kind` 合法不查跃迁 ⇒ 该用例红。
- [ ] 3.4 **转拦（受顺序锁）**：高危面上 `unsupported`/`accepted-risk` 由出声改为拦；
  生效前 MUST 读 `openspec/changes/<change>/judgment-replay-runs.json`，取不到 ⇒ 维持出声并打印 `probe-unverified`。
  顺序锁本身要有锁：M-D1f 把该读数删掉 ⇒ MUST 红在"未证实仍出声"那条断言上，
  MUST NOT 出现"没有读数也没有拦截"的安静态。
- [ ] 3.5 **enforce 现场自证**：在本片自己的分支上跑 `check-pr-exec-record.js --mode=enforce`，
  把读数原样写进执行记录（含 RC）。本片命中三条高危面，预期它**自己先撞线**——
  撞线是判据在工作的证据，不是需要绕过的障碍；⛔ 不得靠写 `tier` 或 `closureNote` 让它不红（#4261 已示范过一次合法处置）。

## 4. 文档与账的交界

- [ ] 4.1 `AGENTS.md` 的 QM-6 段补一句**指针**（不复述判据）："高危面 Critical 的机械出口见
  `openspec/changes/qm6-zero-human-closure/specs/*/spec.md`"。复述就是造第三份事实。
- [ ] 4.2 与 tasks **11.7** 的关系写清：本 change 是它的第 (d) 个候选（前三条已在 #4261 tasks 里逐条否证）。
  **11.7 的勾不在本片**——要等 §3.4 真转拦且 #4261 合并后才算闭合。
- [ ] 4.3 与 tasks **11.6** 的边界：本 change 明确**不做**那四个库文件的扩表（spec 第 5 条 Requirement）。
  若实现期有人"顺手"加进去，按越界处理并退回。

## 5. 刻意不做（登记在这里是为了不让它被读成"已闭合"）

- [ ] 5.1 跨家族共识自动组装（原第 4 刀）。**三个数没量到、拒绝写进文档当依据**：
  ① 单轮各后端真实墙钟分布；② 语料规模—时长曲线（5 分钟是 40 条单点，不外推）；
  ③ 跨家族对同一 finding 的不一致率。没有 ③ 就无法判断"共识"是否退化成"两个都不否决"。
- [ ] 5.2 严重度标尺 / 夹具集（原第 5 刀）：LLM 输出不可重放，进不了 §5.3 超集判据，需另一套判据，属独立 change。
- [ ] 5.3 统计异常自动收紧（原第 6 刀）：依赖 5.1/5.2 的数据面。
- [ ] 5.4 `#4148` 的 QM-6 收口：本 change 不为它开后门，交人工的裁决保持有效（proposal §边界表第 2 行）。
