---
record: changelog-carrier-aggregate
task: 台账热写面收敛第一步——聚合器落地并接进 changes 作业（changelog-record-carrier 片1+片2）
date: 2026-10-20
---

## 本次执行记录：CHANGELOG 聚合器与接线（changelog-carrier-aggregate，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档 PR（`.github/workflows/quality-gate.yml` + `scripts/` 判据 + `openspec/`）。走正规入口 `scripts/start-mp-task.ps1 -TaskName changelog-carrier-aggregate -NoDeps`；判据取产物不取 rc：`git worktree list` 命中 + `rev-parse --abbrev-ref HEAD` == 分支名。起点曾落后 `origin/main`（期间 main 前进了两笔），已 `merge --ff-only origin/main` 对齐后再动手 |
| TDD 顺序 | ✅ | 先写 `scripts/aggregate-changelog.test.js` 并**见证红**：模块不存在时是整片 LOADFAIL（`# tests 1 / fail 1`），不是 15 条指名红——这两种红的语义不同，登记时不混写 |
| 行为锁 | ✅ | 17 条全绿（`# tests 17 / pass 17 / fail 0`）。覆盖：小节逐字节取出、围栏/表格内的同名串不当边界、`##` 后多空格与行尾 CR、**同标题两条记录各落一次**、缺小节点名、重跑字节幂等且出声、混行尾原样保留、learnings 缺席合法/存在但形状非法、`_` 开头占位物不进候选、真仓规模下界、参数面严格 |
| 变异反证 | ✅ | 7 条变异各自让**指名**用例变红，红集互不相同：M1 幂等键退回标题文本→T4；M2 边界退回 substring→T2b+T13；M3 行尾统一回写（落盘态）→T7；M4 缺小节静默→T5+T13；M5 自带第二份条目标题正则→T8；M6 形状判据恒假→T9；M7 缺席也判非法→T9。驱动每次断言 `# tests >= 15`，否则 LOADFAIL 会被读成"已反证"。还原后 md5 与原值相同 |
| M3 第一次 NOT_CAUGHT（不是锁没牙） | ✅ | 第一版 M3 只改 `return rendered`，而真正落盘的 `fs.writeFileSync(file, rendered)` 一字未动 ⇒ "统一回写"这个缺陷**没有被实现出来**。正解是动落盘那一步，不是放宽 T7。变异必须取被禁形态本身，否则证不出它守哪一格 |
| 接线（新测试必须被执行） | ✅ | `KNOWN_UNWIRED` 实测为空对象 ⇒ 任何新 `*.test.js` 不同 PR 接线就红。本 PR 三处同改：`.gitignore` 反选本体（`scripts/*.js` 第 106 行会静默吞掉本体）、`quality-gate.yml` 新增 `Gate 2b8 - Changelog aggregator (changes job)`、`scripts/check-unwired-tests.js::MUST_LIVE_IN_UNGATED_JOB` 登记 + `resolveWhen`。`node scripts/check-unwired-tests.js` 读数：检查域 113 个测试文件，OK |
| 落点为什么必须是 changes 作业 | ✅ | 聚合器读的三类输入（`openspec/records/**`、`CHANGELOG.md`、`01-docs/learnings.md`）**全部**命中 `CI_IGNORED_PATHS`。接在被 `docs-only != 'true'` 门控的 job 里 = 只改记录/台账的 PR 可以让它一次都不跑，这是 AGENTS「进白名单的前提锁」记过的自关校验形态（实测事故 #3114） |
| 步骤 fail-fast | ✅ | `node scripts/check-step-failfast.js`：含 ≥2 条受管命令的 run 步骤 41 个，OK；Gate 2b8 用 `shell: bash`（默认 `-e -o pipefail`），两条命令任一非零即中止 |
| workflow 可被 GitHub 编译 | ✅ | `node .github/scripts/check-workflow-structure.js` → `files=15 violations=0` rc=0。**这条必须跑**：js-yaml 能解析 ≠ GitHub 能编译；首次跑它因 `-NoDeps` 缺 `js-yaml` 抛 MODULE_NOT_FOUND（本机环境缺口，非本 PR 缺陷），补 `pnpm install --frozen-lockfile` 后转绿 |
| CI 契约测试 | ✅ | `node --test .github/scripts/workflow-contract.test.js` → `# tests 44 / pass 44 / fail 0`（含 Gate 2c3 那条"CHANGELOG 两把锁同在 changes job"的结构锁，本次未动其语义） |
| 聚合器真仓读数 | ✅ | 见下「现场读数」；本 PR 的 CHANGELOG.md / 01-docs/learnings.md **零改动**，所以新形态下 `check-changelog-growth` 与副本棘轮天然满足 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | PENDING | 本片命中 `HIGH_RISK_SURFACES` 两类前缀（`scripts/check-`、`.github/workflows/`）⇒ 高危面只认 `tier=external` + 可核 `evidence`，`closureNote` 不够格。2026-10-20 本机实测后端存在「403 额度不足」档；未取到外部评审产物时**如实留欠账，不用自扮演冒充闭合** |
| 远程同步 | 由门禁推导 | 不事后改写，也不为这一行另开 PR |

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数写在 PR 正文（本 PR 含 workflow 与 scripts，预期 `docs-only=false`，属混合档 ⇒ 走完整质量节拍）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 绝对路径账本未放宽 ✅

### 现场读数（都在本次基线 `merge-base = 87f8de7ba` 上取；这些是活数，rebase 后会漂，引用前重取）

| 判据 | 读数 |
| --- | --- |
| `node --test scripts/aggregate-changelog.test.js` | `# tests 17 / pass 17 / fail 0` |
| 变异驱动（一次性，落 `%TEMP%`，不入库） | 7/7 CAUGHT，红集互不相同；还原后 md5 == 原值 |
| `node scripts/aggregate-changelog.js --dry-run` | `records=592 missing=591 malformed=0 learningsShape=0 landed=1 skipped=0 learningsLanded=1 mode=dry`（`landed=1` 就是本篇 —— 真仓端到端，不是夹具） |
| `node scripts/check-unwired-tests.js` | 检查域 113 个测试文件，`OK: 全部测试均已接线或按欠账登记` |
| `node scripts/check-step-failfast.js` | 含 ≥2 条受管命令的 run 步骤 41 个，OK |
| `node .github/scripts/check-workflow-structure.js` | `files=15 violations=0` |
| `node --test .github/scripts/workflow-contract.test.js` | `# tests 44 / pass 44 / fail 0` |
| `node scripts/check-changelog-growth.js --base=<merge-base>` | `PASS：base 577 条（577 种标题）全部在 head 577 条（577 种）里，字节 3026950 -> 3026950`（本 PR 未触碰台账） |
| `node scripts/check-changelog-duplicate-entries.js` | `冗余份数 0 -> 0；本 PR 新增副本=0` |
| `node scripts/check-gate-record-debt.js` | rc=0；`MERGE-LEDGER prs=2172 … 派生收口=589 byDesign=1`、`HAND-CLOSURE 人工改写=0` |
| `node scripts/check-doc-abs-paths.js` | `counts=1161 domain=4797 files=561 canJudge=true` ⇒ PASS（账本未放宽） |
| `node scripts/check-no-brand-residue.js` | PASS（扫描 11172 个 tracked 文件） |
| `bash scripts/check-docs-sync.sh --base=main --head=HEAD` | rc=0（该脚本要**分支名**不是 ref，写 `origin/main` 会被内部再前缀成 `fetch origin/origin/main`） |
| `openspec validate changelog-record-carrier --strict` | rc=0「valid」—— 但它对「Scenario 缺 THEN」「Requirement 空标题」两格照样判 valid，所以这条只证明格式下限 |

### 一条只能由实测得出的设计依据：learnings 那侧为什么不能复用标题键

`CHANGELOG.md` 的条目是 H1（`# ...`），而 `01-docs/learnings.md` 用 `scripts/changelog-entries.js` 的同一把 `headingsOf` 量，实测只数到 **12** 个 H1（且 7 种），它的条目实际是 `## <标题>` / `### lesson: <slug>`。所以「标题末尾括号带 record 名」这套键在 learnings 上根本不成立 —— 那侧改用 HTML 注释标记 `<!-- aggregate:record=<name> -->`。两处机制不同是刻意的，各自的判重实现只有一处。**若不实测就照抄 CHANGELOG 的键，learnings 的幂等会静默失效**（第二趟照搬，因为"标题里没有 record 名"永远判不出已落）。

### 遗留（不假装已闭合）

1. **本片只是聚合器，不是"已迁移"**。当场真仓 dry-run 读数 `records=592 missing=591 landed=1`——591 篇记录还没有 `## CHANGELOG 条目` 小节，唯一有小节的是本篇自己。真正让 PR 写小节、让台账禁改，是片3（禁改门禁 advisory）与片4（模板 + AGENTS + release-gate 接线 + 转 blocking）。
2. **advisory → blocking 之间的窗口是本刀自己制造的欠账**：窗口内既有人手改 CHANGELOG、也有人写 records 小节，聚合器靠"标题末尾 record 名"判重能跳过已手搬的条目，但这个窗口长度没人守。转 blocking 那片必须带当场重取的在飞冲突数作为前置条件。
3. **高危面外部评审未闭合**（见上表 QM-6 行）。若后端整轮不可得，本 PR 属「机械闸门全绿但第 5 条判据有争议」，按 AGENTS 不得自动合并，须报人。
4. **`startsAsEntry` 用首个非空行判"是不是一条条目标题"**，判不了"这条标题写得好不好"。规格里那条「learnings 形状只能判形态、判不了内容」的残余同样适用于这里。

## CHANGELOG 条目

# feat(gates): CHANGELOG 与 learnings 的热写面收敛第一步——条目真源移向执行记录，台账改由聚合器写入（changelog-carrier-aggregate）

> 标题末尾按合同写 **record 名（= 分支名）**，不是 change slug。本 PR 两者不同（分支 `changelog-carrier-aggregate`，规格 `changelog-record-carrier`），正说明键只能有一个来源：取 record 名，因为它是"每 PR 一份、路径唯一"的那个保证；change slug 会被人在 PR 中途改名，键跟着漂就会把已落条目重搬一遍。

- **动因是实测而不是印象**：当场对 4 个可判定的非 MERGEABLE PR 跑 `git merge-tree --write-tree origin/main <pr-head>`，冲突文件**只有** `CHANGELOG.md`（其中一个外加 `01-docs/learnings.md`），没有第三类文件；在飞 35 个 PR 里 5 个 CONFLICTING、22 个 UNKNOWN；最近 30 笔 main 提交有 20 笔动了 CHANGELOG。根因是形状——两个文件都要求在第 1 行插入，任意两个在飞 PR 必然抢同一位置。
- **`scripts/aggregate-changelog.js`**：把台账写入者收敛成一个。幂等键刻意取 **record 名**而不是标题文本——主干上同一标题存在多份历史副本，按标题判"已落"会把该搬的一条误判成已搬，症状是**静默少一条**，比多搬一条更难发现。现存 CHANGELOG 标题末尾括号本来就写着 change slug，与 `openspec/records/<slug>.md` 同名 ⇒ 键对存量现状直接生效，不会把已合并条目搬第二遍。
- **逐行保留行尾，禁止统一回写**（AGENTS 实测：统一回写一次改写 26 行，且此后任何并发合并都变成整文件冲突）。变异反证 7 条各自让指名的用例变红；其中 M3 第一版 NOT_CAUGHT，原因是它只改了返回值而没改落盘那一步——**那我的锁就没被验过，不是锁没牙**，改正后重跑。
- **接线三处同改**：`.gitignore` 反选本体（`scripts/*.js` 会静默忽略新建脚本）、`quality-gate.yml` 新增 `Gate 2b8`、`check-unwired-tests.js` 的 `MUST_LIVE_IN_UNGATED_JOB` 登记。落点必须是 `changes` 作业，因为聚合器读的三类输入全部命中 docs-only 白名单——接在会被 docs-only 短路的 job 里等于给自己关掉校验。
- **本 PR 自己就是第一个用户**：`CHANGELOG.md` 与 `01-docs/learnings.md` 零改动，条目原文就写在本篇这个小节里；CI 上 `--dry-run` 会把自己列进 `LAND`，这是"链路通"的现场证据而不是靠读代码相信。
- **刻意不做**：不拆存量历史（实测 `3,026,950` 字节 / 577 条）、不提前摘 `check-branch-merged.js` 的共用写面登记（顺序错了会让收尾判据退回整文件比较，是已实测的假阳性来源）。原计划里"不在本次清那批重复标题键"这条**已被现场否证**：本次重取冗余为 **0 份**，那批副本在本刀之前就被清理收掉了，所以这里没有欠账可还。
- **QM-6 高危面外部评审未闭合**（本片同时命中 `scripts/check-` 与 `.github/workflows/` 两类高危前缀，`closureNote` 在高危面不够格）；如实留 PENDING，不用自扮演冒充。

## learnings

### lesson: 热写面的撞车是形状问题，不是纪律问题（changelog-carrier-aggregate）

**现场**：多会话并发往 `CHANGELOG.md` 与 `01-docs/learnings.md` 的**第 1 行**插块，导致 CI 全绿却 `mergeable=CONFLICTING`，必须 rebase 再跑一轮（一轮 25–30 分钟）。当场对 4 个可判定的非 MERGEABLE PR 做 `git merge-tree`，冲突文件只有这两个；另有 22 个 PR 报 UNKNOWN（GitHub 算不出合并基线，同因）。

**根因**：不是谁写错了。两个文件都要求在同一位置插入 ⇒ git 三方合并无法判定顺序 ⇒ 结构上必撞。`scripts/changelog-dedup-regen.js` 的头注释早就写了这个机制（main 每约 37 分钟前进、CI 一轮 25–30 分钟，所以"按 base 算我的块再 prepend"不可能成功），而它自己就是为了收拾这个后果而存在的。

**可复用的三条**：
1. 判"为什么老撞车"时，先问**插入点是否唯一**，再问谁写得不对。全员共用的追加型写面（顶部插、底部插都算）在并发会话下必然撞，任何"写规范"都修不了它。
2. 正解不是更仔细的合并技巧，而是**把写面换成路径唯一的那份**（本项目已经是 `openspec/records/<分支>.md`），共享文件降级成聚合产物。
3. 已经有人在无制度授权下自发这么干了（`openspec/records/member-tier-contract.md:130` 写着「## CHANGELOG 条目（暂移到执行记录：热文件冲突说明）」）。**遇到这种"民间形态"要当需求读，不要当污染读**——它给出的合同比我凭空设计的更贴合真实用法。

### lesson: 变异反证必须先自问"这个缺陷被实现出来了吗"（changelog-carrier-aggregate）

**现场**：给"行尾统一回写"写变异 M3 时，改的是 `return rendered.replace(/\r\n/g,'\n')`，而真正落盘的是上一行的 `fs.writeFileSync(file, rendered)`。结果 M3 报 NOT_CAUGHT——不是 T7 失明，是**变异根本没把缺陷做出来**。

**根因**：把"返回值"当成了"效果"。锁测的是文件字节，变异就得动文件字节。

**可复用的三条**：
1. 一条变异报 NOT_CAUGHT 时，第一动作是检查变异本身实现的是不是被禁形态，**不是**放宽被验证的断言。
2. 判据要盯**副作用发生的那一步**：写盘 / 发请求 / 改全局态。改它上游的中间变量常常什么都改变不了。
3. 驱动必须同时断言"跑了多少条测试"和"红了哪几条"。只断言"有红"会把整片 LOADFAIL 读成"已反证"（本仓已记过多次同型）。
