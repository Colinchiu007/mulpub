---
record: feat-spec-delta-coverage-gate
task: 新增 CI 门禁——主规格不得因本次合并而丢失基线 Requirement/Scenario（把 openspec「Preserve scenarios not mentioned in the delta」这句散文约定变成会红的东西）
date: 2026-10-24
branch: feat-spec-delta-coverage-gate
---

## 本次执行记录：主规格基线零覆盖门禁（feat-spec-delta-coverage-gate，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 代码变更（1 个新判据 + 1 个新测试 + 1 处 workflow 接线 + 1 条 .gitignore 反选）。分支 `feat-spec-delta-coverage-gate`（**裸 task 名，无斜杠**），经 PR 落地，未直推 main |
| 第一性原因（QM-5 ①） | PASS | openspec 的 delta 语义是**增量补丁**，权威出处 `.opencode/skills/openspec-sync-specs/SKILL.md` 的「MODIFIED Requirements」一节末行：「**Preserve scenarios/content not mentioned in the delta**」。这句约定此前**没有任何机器消费者**（全仓 grep 只命中该文档自身）⇒ 属本仓反复出现的「注册≠注入≠生效」家族。后果：一次 delta 合并若把基线里的某条 Scenario 抹掉，**全仓没有任何门禁会红** |
| 逃逸分析（QM-5 ②） | PASS | 见下「逃逸分析」 |
| 修复 + 回归保护（QM-5 ④） | PASS | 判据本体 `scripts/check-spec-delta-coverage.js`（326 行）+ 测试（21 例，含夹具仓库端到端 + 3 类变异验证）+ 3 条接线锁。**变异反证**：抹掉 1 条基线 Scenario ⇒ rc=1 且点名该条；删掉整个 Requirement ⇒ rc=1 且点名；合法正文改动 ⇒ rc=0（无误报） |
| 防止再次发生（QM-5 ⑤） | PASS | ① 判据本体自测（含**负控**：合法改动必须绿）；② 三条接线锁钉住「挂在 QG Changes」「排在 classify 之后」「带 pull_request 事件条件」；③ 补一条**本地锁**：工作区里被 gitignore 吞掉的 `scripts/*.js` ⇒ 红（见「顺带修掉的家族缺陷」） |
| 行尾与 diff 对账 | PASS | 两口径 numstat 相等 |
| 接线棘轮 | N/A | 未新增 `*.test.js` 到棘轮清单；新增测试文件已由 `check-unwired-tests.js` 覆盖（rc=0） |
| QM-1 打包 | PASS | 运行时代码变更 ⇒ 适用，证据取自 CI `build` job |
| QM-4 视觉 | N/A（已确认非跳过） | **未触碰任何 `.vue` / `.css`**；纯 Node 脚本 + YAML 接线 |
| QM-6 CCG 双模型外部评审 | **未执行（环境不具备）** | 本仓 REST API 对当前 token 全 404（git 通 ≠ API 通），`claude` / `opencode` / `codeagent-wrapper` 三后端均不可用。如实记录 |
| 远程同步 | 由门禁推导 | 合并后由门禁按主干历史推导，不手工回填 |

## 判据设计：为什么是「事后对账」而不是「事前查 delta」

**第一版我写错了，实测把它推翻**：初版判据是「delta 的 MODIFIED 块必须自包含基线全部 Scenario」。
在真实仓库上实测**误报 3 处**，其中 2 处是**本仓自己按增量语义写的 change**。

查权威约定才明白：openspec 的 MODIFIED 是**增量补丁**语义，delta 不自包含是**合法写法**。

⇒ 正确判据是**事后**：合并后（base ⊕ head）的主规格必须包含基线里的每一个 Requirement 与每一条 Scenario。
**它直接对着"合并结果"断言，不依赖作者怎么组织 delta。**

## 三条口径

| 口径 | 选择 | 理由 |
|---|---|---|
| 基线取什么 | **merge-base**，不是 base 分支当前 HEAD | base 在 PR 打开期间前进时，拿 base 当前 HEAD 当基线会把**别人的**新 Scenario 误判成"本次丢失"⇒ 假红。与 `build.yml` package-relevant、`classify-docs-only.changedFileStatuses` 同一口径 |
| 扫描域 | **变更集**决定，不按目录遍历 | 扫描域不会塌缩（目录改名可能读到空集）；且"本次动了哪些主规格"是关键信息，不该被全量扫描冲淡 |
| head 侧内容 | `git show <head>:<path>` | 验的是**提交/合并后的树**，不是工作区。CI 上 pull_request 检出 HEAD = merge commit（父 = base.sha 与 head.sha）⇒ `merge-base(base.sha, HEAD) = base.sha` ⇒ **基线就是"这次 PR 的起点"、head 侧就是"合并结果"** |

**不传 `--head` 是硬要求**：fork PR 的 head 对象可能不在本地对象库，传 `head.sha` 会让 merge-base 取不到 ⇒ 全仓 fork PR 被 exit 2 打红。

## 逃逸分析（QM-5 ②）

**这次有两条逃逸路径，都是我自己踩的：**

1. **判据本身写错（已推翻）** —— 事前判据误报 3 处。
2. **判据本体被 gitignore 吞掉（已修）** —— `.gitignore` 有 `scripts/*.js`，
   新增的 `scripts/check-spec-delta-coverage.js` 被**静默忽略** ⇒ 文件在工作区跑得通（本地全绿）
   但**没进仓** ⇒ CI 上 workflow 点名它时 Cannot find module。
   本仓已因此栽过三次（`.gitignore` 里逐条记着 #3011 / Gate 2c3 同族）。

**判据**：新增 `scripts/*.js` 必须在 `.gitignore` 加 `!scripts/<name>.js` 反选。
**配套**：本次补了一条**本地锁**（工作区里被 gitignore 吞掉的 `scripts/*.js` ⇒ 红），
把这一族一次性堵住。CI 上不需要它兜底 —— workflow 点名不存在的脚本，job 本来就会红，
危害是"浪费一轮 CI"而不是"静默通过"。

**另一个自伤形态**：我写的那条「workflow 点名的 scripts/*.js 必须在仓里」锁，
**第一版正则一次跑出 8 条假阳性**（`packages/x/scripts/y.js`、`.github/scripts/y.js`、
`working-directory` 下的相对路径、以及 `[A-Za-z0-9._-]+` 贪婪吃掉 `.json`）。
**逐条查证才发现全是匹配器自己的错** —— 若直接采信，就会去"修"一个不存在的缺陷。
⇒ **判据**：锁报出来的东西必须逐条查证来源，匹配器出错的概率与被测对象出错的概率同级。

## 顺带修掉的家族缺陷

`.gitignore` 补 `!scripts/check-spec-delta-coverage.js`（否则判据本体不进仓）。
这是该家族的**第四次**，前三次的注释都还在 `.gitignore` 里。

## 遗留

- **Scenario 的删除没有声明机制**：openspec 的 delta 只表达 Requirement 级的 REMOVED/RENAMED，
  表达不了"删掉某条 Scenario"。本门禁把这种删除判为违规（要求作者先从基线显式移出），
  但**表达力缺口本身在 openspec 侧**，未解决。实测当前仓库 0 处此类删除 ⇒ 落地不红。
- **Requirement 标题改名会被判红**（除非在 delta 里用 `## RENAMED Requirements` 声明 FROM/TO）。
  这是**有意的**：把"改名必须显式声明"从口头约定变成会红的东西。首次遇到会有作者被挡，
  门禁输出里已给出修法指引。
- 本门禁**只覆盖主规格**（`openspec/specs/**/spec.md`），不覆盖 change 的 delta 自身。
- `QG Changes` job 的 `timeout-minutes: 5` 未被触碰（本次实测 job 137–151 s，余量 50%）。
