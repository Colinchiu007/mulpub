---
record: qm6-critic-configurable
task: QM-6 评审后端对收敛为单一真源，并把「设了没生效」变成判不闭合（含按外部评审收紧判据）
date: 2026-10-18
---

## 本次执行记录：QM-6 评审后端可配置化与追责（qm6-critic-configurable，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（改 `scripts/` 门禁工具自身 ⇒ `classify-docs-only` 不成立，走完整质量节拍）。worktree `D:/Data/projects/mp-worktrees/mp-qm6-critic-configurable`（非 C 盘），裸分支 `qm6-critic-configurable`，由 `scripts/start-mp-task.ps1 -TaskName qm6-critic-configurable` 创建；`verify-worktree-deps` OK；`pre-code-edit-guard.ps1` rc=0 |
| 第一性原因（QM-5 ①） | ✅ | 不是"缺一个旗标"。引入点是**把同一决策抄成六份字面量**的那几处：`ccg-review-decider.js:759-760`（可用性表 + 目标文案）、`deep-review.sh:334/354`（裸名自检 + 体检循环）、`plan-review.sh:321`、以及仓外驱动的 `cfgForMode()`。实测链条：`git log -S'双模型(claude + opencode)'` 命中该文案的引入提交；`grep -na 'in claude opencode' scripts/*.sh` 在改前 = 3 处、改后 = 0 处。三种"换 critic"旋钮静默失效的现场证据分别在 `~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js:508-535`（覆盖块只在 `objectType:"plan"` 分支）与 `:950`（验证层裸取 `cfgForMode`） |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试层：无 —— 本仓此前没有任何测试断言"评审者是谁"。集成层：无 —— `check-pr-exec-record.js` 只看 `deepReview.status`（一个手写的词），不看 `performedBy`。E2E/视觉层：不适用（工具链变更）。审查层：QM-6 本身失灵 —— 它审的是"有没有评审过"，而"被谁评审过"从未被对账，于是四种旋钮失效全部通过了全绿链路。**共同逃逸原因**：判据读的是断言而不是测量（与本仓 `gate-record-debt` 那条「门禁读人写的断言」同型，第三次复发） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一真源 `scripts/ccg-review-backends.list` + 两个读取方（`scripts/lib/ccg-review-backends.js` / `scripts/lib/ccg-backends.sh`）；decider 的名单/文案/记录字段全部派生；两个入口接受 `--critic/--proposer` 并逐值加引号转发；`check-pr-exec-record.js::judgeBackendMismatch` 做「请求值 × 实际执行者」对账。回归锁 6 处：`scripts/lib/ccg-review-backends.test.js`(17)、`ccg-review-decider.test.js`(+7)、`deep-review-deps.test.js`(+5)、`check-pr-exec-record.test.js`(+5)、`plan-review-deps.test.js`、`ccg-bash-entry.test.js` |
| 防止再次发生（QM-5 ⑤） | ✅ | ① AGENTS.md QM-6「执行方式」两处更正：把"唯一真源是 `~/.claude/.ccg/config.toml`"改写为**分两条路径**（直接调 wrapper 的旁路 vs 本仓评审链），并点名改 config.toml 对评审链无效；② 新判据接进 `quality-gate.yml` Gate 2c6（changes 作业，无 job 级 `if`）；③ openspec change `qm6-review-backend-config`（proposal/design/specs 三条 Requirement/tasks）；④ 本记录 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相同**（无幽灵行）。逐文件行尾档当场量过：`AGENTS.md`/`CHANGELOG.md`/各 `*.test.js`/`.ccg` 产物为纯 CRLF（bareLF=0 loneCR=0），`deep-review.sh`/`plan-review.sh`/两个 lib 为纯 LF。新增行一律按目标文件当场行尾档写回（`D:/Temp/append-any.cjs` 类脚本先校验 CR 守恒再落盘），未出现「把 CRLF 文件写成 LF」的整文件改写 |
| 接线棘轮 | ✅ | 新测试 `scripts/lib/ccg-review-backends.test.js` 已显式点名进 `quality-gate.yml` Gate 2c6（`shell: bash`）。三条判据本体 rc=0：`node .github/scripts/check-workflow-structure.js`（files=14 violations=0）、`node scripts/check-unwired-tests.js`（检查域 103 个测试文件，OK）、`node scripts/check-step-failfast.js`（39 个多命令步骤，OK）。新文件 `git check-ignore --no-index` 回显为空 ⇒ 未被 `.gitignore` 吞掉 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与 `packages/rpa-engine/`，未触任何 `.vue`/样式 ⇒ 打包与像素门禁不适用（本刀全在 `scripts/` + `.github/` + `openspec/`）。改动集内新增的用户可见文案为 0（终端文案不参与 locale 门禁），Gate 7 zh/en 成对义务未触发 |
| QM-6 CCG 双模型外部评审 | 进行中 | 见下「QM-6 现场」 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |
- 保留门禁：判定证据 ✅ | 行尾对账 ✅ | 接线棘轮 ✅ | QM-6 进行中 PENDING | 远程同步 由门禁推导

### QM-6 现场（不写"PASS"，只写跑到哪一步）

- **轮 1（对 `4b7ca65f`，判定 `mode=dual`）**：真实调用 `critic=claude`，产出 7 条 findings、四个维度分、最低分 4。
  引擎按出口进入自扮演裁决（`置信权重 0.6`），我逐条填了 `prosecution/defense/verdict/rationale` 六份：
  **4 条 upheld**（i1 默认路径不追责、i3 无引号展开把安全性单点押在正则上、i4 `performedBy` 为空即不判、
  i5 整记号相等对复合名假红）、**2 条 dismissed**（i2 两份读取方、i7 打印模式数必须为 1），
  裁决理由与处置都写进 `.adversarial/ccg-deep-4b7ca65f/adjudication.json`。
  产物状态：`.ccg/reviews/2b00469a….json` = `self_play_blocked`（其中 i5 属高危域 `auth`，
  引擎拒绝以自扮演豁免 —— 这是引擎设计，不是我的遗漏）。
- **i5 的高危域要求已由外部模型满足**：`codeagent-wrapper --backend claude`（rc=0）就"整记号相等 vs 拆词族 vs 第三种口径"
  给出可执行结论 —— 采纳第三种（有界子串），原始答复留证于 `D:/Temp/qm6-i5-external.txt`。
  实现与两条负控（碎片 `clau`/`laude` 不得点着 `claude`；请求 `claude-agent` 而实际 `claude` 必须仍判不符）已落 `59fa21cf7`。
- **轮 2（对 `59fa21cf7`）**：`critic=claude` 真实调用后 **critique 契约校验失败**
  （`issues[5].finding 为空`），产物状态记为 `error`（`.ccg/reviews/26d2bf7e….json`）。
  该轮的原始返回里有一条 Critical（"不要依赖正则做唯一安全边界，逐个引用参数"）**已被采纳并实现**
  ——`exec` 改为逐值加引号的两条分支，并补一条 `doesNotMatch(/BACKEND_ARGS/)` 的禁词锁把它钉住。
  判据本体没有因为契约失败而被放宽：`error` 就是 `error`，不得读成"评审通过"。
- **轮 3（对本 PR 的最终 tip）**：见下条更新。收尾提交后在此行写实际读数。
- **实测到的两个"看起来坏了"其实是既有 flaky**：`scripts/deep-review-deps.test.js` 的第 6 条
  （只剩单后端 ⇒ 非零）与第 9 条（`dirname` 不可用时 `--check-deps` 仍须成功）在同一条命令、同一份工作树上
  两次跑分别红/绿（红一次 ⇒ 重跑 34/34 全绿）。这不是本刀引入的判据变化，但它是 required 链上的
  间歇红，**按欠账登记**：归因需要一次「同 sha 连续 N 次跑 + 记录环境读数」的专项，本刀不做。

### 遗留（不假装已闭合）

- 驱动**验证层**仍不应用 `--proposer/--critic`（代码在仓外 `~/.claude/skills/…`）。因此本刀交付后，
  对 diff 评审指定后端的实际效果是"被对账判未闭合"，不是"换成功"。两条出口留人工裁决：
  修上游那一分支；或按驱动自身注释把引擎 vendor 进 `scripts/`（vendor 后本仓即对该驱动行为负责，属改"谁来守门"）。
- `INSTALL_HINT`（node）与 `backend_pkg` 的 `case` 表（sh）是两张同义表，只能靠对账锁成对抓；
  新增后端必须两处同改。
- 抖音开放平台资质相关（另一条线）：`hot-topics-viral-items` 的 tasks 2.1 O-1 取证仍未做，等资质。
- `deep-review-deps.test.js` 的两条间歇红（见上）。
