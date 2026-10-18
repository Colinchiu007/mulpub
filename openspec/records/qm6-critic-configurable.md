---
record: qm6-critic-configurable
task: QM-6 评审后端对收敛为单一真源，并把「设了没生效」变成判不闭合（含按外部评审四轮收紧判据）
date: 2026-10-18
---

## 本次执行记录：QM-6 评审后端可配置化与追责（qm6-critic-configurable，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（改 `scripts/` 门禁工具自身 ⇒ `classify-docs-only` 不成立，走完整质量节拍）。worktree `D:/Data/projects/mp-worktrees/mp-qm6-critic-configurable`（非 C 盘），裸分支 `qm6-critic-configurable`，由 `scripts/start-mp-task.ps1 -TaskName qm6-critic-configurable` 创建；`verify-worktree-deps` OK；`pre-code-edit-guard.ps1` rc=0 |
| 第一性原因（QM-5 ①） | ✅ | 不是"缺一个旗标"，而是**同一个决策被抄成六份字面量**：`ccg-review-decider.js`（可用性表 + 目标文案）、`deep-review.sh`（体检循环 + 裸名自检）、`plan-review.sh`、仓外驱动的 `cfgForMode()`。三种"换 critic"旋钮静默失效的现场坐标：驱动 `ccg-deep-review.js:508-535`（覆盖块只挂在 `objectType:"plan"` 分支）vs `:950`（验证层裸取 `cfgForMode`）；入口原 `deep-review.sh:754` = `exec node "$DRIVER" --sha "$SHA"`。复测判据：`grep -na 'in claude opencode' scripts/*.sh` 改前 3 处、改后 0 处 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：无 —— 没有任何测试断言"评审者是谁"。集成层：无 —— `check-pr-exec-record.js` 只看 `deepReview.status`（人写的词），不看 `performedBy`（跑出来的事实）。E2E/视觉：不适用。审查层：QM-6 审的是"有没有评审过"，从不审"被谁评审过" ⇒ 四种旋钮失效全部在全绿链路下通过。**共同逃逸原因**：门禁读断言而非测量（与本仓 `gate-record-debt` 那条同型，第三次复发） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一真源 `scripts/ccg-review-backends.list` + 两个读取方（`scripts/lib/ccg-review-backends.js` / `scripts/lib/ccg-backends.sh`；后者存在是因为 `--check-deps` 刻意不依赖 node），优先级 CLI > `MP_QM6_*` > 清单。decider 的名单/文案/记录字段全部派生；两个入口接受 `--critic/--proposer` 并**逐值加引号**转发；`judgeBackendMismatch` 做「请求值 × 实际执行者」对账 + 不分覆盖的署名义务。回归锁 6 个文件：`lib/ccg-review-backends.test.js`(17)、`ccg-review-decider.test.js`(43，其中 +7)、`deep-review-deps.test.js`(35，其中 +5)、`check-pr-exec-record.test.js`(73，其中 +5)、`plan-review-deps.test.js`(10)、`ccg-bash-entry.test.js`(9) |
| 防止再次发生（QM-5 ⑤） | ✅ | ① AGENTS.md QM-6「执行方式」两处更正：把"唯一真源是 `~/.claude/.ccg/config.toml`"改为**分两条路径**并点名改 config.toml 对评审链无效；② 新判据接进 `quality-gate.yml` Gate 2c6（changes 作业，无 job 级 `if`）；③ openspec change `qm6-review-backend-config`（proposal / design 六维度 / specs 三条 Requirement / tasks）；④ 本记录 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **逐文件相同**（无幽灵行）。行尾档当场量过并保持：`AGENTS.md`/`CHANGELOG.md`/各 `*.test.js`/`.ccg` 产物纯 CRLF（bareLF=0 loneCR=0），`deep-review.sh`/`plan-review.sh`/两个 lib 纯 LF。所有插入走"先校验 CR 守恒再落盘"的脚本（`D:/Temp/append-any.cjs`、`prepend-changelog.cjs`、`patch-*.cjs`），没有把 CRLF 文件整份写成 LF |
| 接线棘轮 | ✅ | 新测试 `scripts/lib/ccg-review-backends.test.js` 已显式点名进 `quality-gate.yml` Gate 2c6（`shell: bash`）。判据本体 rc=0：`check-workflow-structure.js`（files=14 violations=0）、`check-unwired-tests.js`（检查域 103 个测试文件，全部已接线）、`check-step-failfast.js`（39 个多命令步骤 OK）、`check-gate-record-debt.js`（OK，本记录已带 `远程同步` 行与 bullet 两形态）。新文件 `git check-ignore --no-index` 无回显 ⇒ 未被忽略 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式 ⇒ 打包与像素门禁不适用。改动集内新增用户可见（渲染层）文案为 0 ⇒ Gate 7 zh/en 成对与词典锁未触发；本刀文案全是终端输出，逐字清单见 change 的 design.md §5–§6 |
| QM-6 CCG 双模型外部评审 | ✅ 已跑四轮（见下） | 三份判定产物状态均已收口为 `needs_revision` 并带 `closureNote` 写明依据：`2b00469a…`(4b7ca65f)、`26d2bf7e…`(59fa21cf7)、`fa40e334…`(25a31c52)。裁决原文 `.adversarial/ccg-deep-{4b7ca65f,25a31c52}/adjudication.json`；高危域 i5 的外部复核原文 `D:/Temp/qm6-i5-external.txt`（codeagent-wrapper --backend claude，rc=0） |

### QM-6 现场（四轮，逐轮读数；不写 PASS，写跑到哪一步）

1. **轮 1（`4b7ca65f`，mode=dual）**：`critic=claude` 真实调用，7 条 findings、四维分、minScore=4 ⇒ 引擎进入自扮演裁决（置信权重 0.6）。逐条填 `prosecution/defense/verdict/rationale`：**4 upheld**（i1 默认路径不追责、i3 拼串无引号把安全性单点押在正则上、i4 `performedBy` 空即不判、i5 整记号相等对复合名假红）、**2 dismissed**（i2 两份读取方、i7 打印模式数必须为 1）。产物状态 `self_play_blocked` —— 成因为 i5 属高危域 `auth`，引擎拒绝以自扮演豁免（设计如此，非遗漏）。
2. **i5 的高危域由真实外部调用满足**：`codeagent-wrapper --backend claude`（rc=0）就"整记号相等 / 拆词族 / 第三种口径"给出可执行结论，采纳第三种（**有界子串**）。实现与两条负控（碎片 `clau`/`laude` 点不着 `claude`；请求 `claude-agent` 而实际 `claude` 必须仍判不符）落在 `59fa21cf7`。
3. **轮 2（`59fa21cf7`）**：`critic=claude` 调用后 **critique 契约校验失败**（`issues[5].finding 为空`）⇒ 产物记 `error`。该轮原始返回里的一条 Critical（逐个引用参数）被采纳并实现于 `25a31c52`：exec 改为逐值加引号的两条分支，旧形态被一条 `doesNotMatch(/BACKEND_ARGS/)` 禁词锁钉死。判据没有因契约失败而被放宽 —— `error` 当时就是 `error`。
4. **轮 3/4（tip `25a31c52`，mode=single，审查 origin/main..HEAD 全量 2576 行）**：5 条 findings，逐条裁决 3 upheld（error 产物无说明 / 引号形态不可测 / `$0` 定位兄弟依赖不可靠）+ 1 dismissed（要求新产物必带 `reviewBackends`：见下条"实测后撤销"）。upheld 三条均已实现。
5. **一条被自己实测否证的加严**（按"方案被取证否证要如实写"的规矩登记）：试过「本次变更集中 status=A 的 dual 产物必须带 `reviewBackends`」，实测打红 7 条既有回归锁；且现场不是假想 —— 任何在本刀之前生成、仍在飞的 PR 其 dual 产物都没有这个字段，他们会因别人落地而被 required check 判红。爆炸半径超出本刀应得范围 ⇒ 撤销，理由写进 `check-pr-exec-record.js` 的源码注释，避免下一个会话再试一遍。剩余风险：绕过通道是"生成后手动删掉已入库 JSON 里的该字段"，由「判定器恒写该字段」的行为锁 + 本判据的比对共同限制在刻意伪造范围内。
6. **既有 flaky（不认领、也不掩盖）**：`scripts/deep-review-deps.test.js` 的第 6 条（只剩单后端 ⇒ 非零）与第 9 条（`dirname` 不可用时 `--check-deps` 仍须成功）在同一条命令、同一份工作树上两次连跑出现"一次红 / 一次 34-35 全绿"。归因需要「同 sha 连续 N 跑 + 环境读数」的专项，本刀不做，登记为欠账。

### 遗留（不假装已闭合）

- 驱动**验证层**（评审 diff）仍不应用 `--proposer/--critic`（代码在仓外 `~/.claude/skills/…`）。所以本刀交付后，对 diff 评审指定后端的实际效果是"被对账判未闭合"，不是"换成功"；决策层 `plan-review.sh` 那条路径今天生效。两条出口需人工裁决：修上游那一分支；或按驱动自身注释把引擎 vendor 进 `scripts/`（vendor 后本仓即对该驱动行为负责，属改"谁来守门"）。
- `INSTALL_HINT`（node）与 `backend_pkg` 的 `case` 表（sh）是两张同义表，只能靠逐字对账锁成对抓；新增后端必须两处同改。
- 三份判定产物按 `needs_revision` 收口：引擎没有"已修"字段，任何 upheld 都会记 `self_play_blocked`，而 upheld 的结论都已在同一分支内改完。`closureNote` 逐份写明了依据，不写 `cleared`。
- `deep-review-deps.test.js` 两条间歇红（见 QM-6 现场第 6 条）。
- 另一条线：`hot-topics-viral-items` 的 tasks 2.1（O-1 取证）仍未做，等抖音开放平台资质；PR #3904 的 QM-6 阻塞在本刀交付后可用默认后端重跑，另见该 PR。
